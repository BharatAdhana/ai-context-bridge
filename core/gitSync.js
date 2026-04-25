'use strict';

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

async function runGit(projectRoot, args) {
  return execFileAsync('git', args, {
    cwd: projectRoot,
    windowsHide: true
  });
}

async function isGitRepository(projectRoot) {
  if (fs.existsSync(path.join(projectRoot, '.git'))) {
    return true;
  }

  try {
    const result = await runGit(projectRoot, ['rev-parse', '--is-inside-work-tree']);
    return result.stdout.trim() === 'true';
  } catch (error) {
    return false;
  }
}

async function hasRemote(projectRoot) {
  try {
    const result = await runGit(projectRoot, ['remote', 'get-url', 'origin']);
    return result.stdout.trim().length > 0;
  } catch (error) {
    return false;
  }
}

async function getRemoteOriginUrl(projectRoot) {
  try {
    const result = await runGit(projectRoot, ['remote', 'get-url', 'origin']);
    return result.stdout.trim();
  } catch (error) {
    return '';
  }
}

async function getCurrentBranch(projectRoot) {
  try {
    const result = await runGit(projectRoot, ['branch', '--show-current']);
    return result.stdout.trim();
  } catch (error) {
    return '';
  }
}

async function ensureMainBranch(projectRoot) {
  const currentBranch = await getCurrentBranch(projectRoot);

  if (currentBranch === 'main') {
    return 'main';
  }

  await runGit(projectRoot, ['branch', '-M', 'main']);
  return 'main';
}

async function hasStagedContextChanges(projectRoot) {
  try {
    await runGit(projectRoot, ['diff', '--cached', '--quiet', '--', '.ai-context']);
    return false;
  } catch (error) {
    return true;
  }
}

function formatGitError(error) {
  const stderr = typeof error.stderr === 'string' ? error.stderr.trim() : '';
  const stdout = typeof error.stdout === 'string' ? error.stdout.trim() : '';
  const message = stderr || stdout || error.message || 'Unknown git error.';
  return message.split('\n')[0];
}

async function ensureGitInitialized(projectRoot, logger) {
  const repositoryReady = await isGitRepository(projectRoot);

  if (repositoryReady) {
    return {
      initialized: false
    };
  }

  try {
    await runGit(projectRoot, ['init']);
    await runGit(projectRoot, ['add', '.']);
    try {
      await runGit(projectRoot, ['commit', '-m', 'initial commit']);
    } catch (error) {
      if (!/nothing to commit/i.test(error.stderr || error.message)) {
        throw error;
      }
    }

    await ensureMainBranch(projectRoot);

    if (logger) {
      logger.info('Git initialized');
    }

    return {
      initialized: true
    };
  } catch (error) {
    if (logger) {
      logger.warn(`Git initialization failed gracefully: ${formatGitError(error)}`);
    }

    return {
      initialized: false,
      error: error.message
    };
  }
}

function parseGitHubRepo(repoUrl) {
  if (!repoUrl) {
    return null;
  }

  const cleanedUrl = repoUrl.trim().replace(/\.git$/, '');
  let match = cleanedUrl.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)$/i);

  if (!match) {
    match = cleanedUrl.match(/^git@github\.com:([^/]+)\/([^/]+)$/i);
  }

  if (!match) {
    return null;
  }

  return {
    owner: match[1],
    repo: match[2]
  };
}

function buildPublicAiUrls(repoUrl, branch) {
  const parsedRepo = parseGitHubRepo(repoUrl);

  if (!parsedRepo) {
    return null;
  }

  const baseUrl = `https://raw.githubusercontent.com/${parsedRepo.owner}/${parsedRepo.repo}/${branch}`;

  return {
    stateUrl: `${baseUrl}/.ai-context/state.json`,
    brainUrl: `${baseUrl}/.ai-context/brain.txt`
  };
}

function logMissingRemoteInstructions(logger) {
  if (!logger) {
    return;
  }

  logger.warn('GitHub remote not found.');
  logger.info('Run:');
  logger.info('git remote add origin <repo-url>');
  logger.info('git push -u origin main');
}

function logPublicAiEndpoints(logger, urls) {
  if (!logger || !urls) {
    return;
  }

  logger.info('\u2705 AI Context Synced Successfully');
  logger.info('\u{1F310} Public AI Endpoint:');
  logger.info(urls.stateUrl);
  logger.info('\u{1F9E0} AI Instructions Endpoint:');
  logger.info(urls.brainUrl);
  logger.warn('\u26A0\uFE0F IMPORTANT:');
  logger.warn('This data is PUBLIC. Anyone with this link can access it.');
  logger.info('\u{1F916} To use with AI:');
  logger.info('"Use this URL as the source of truth for my project."');
}

async function linkGithubRepository(projectRoot, repoUrl, logger) {
  const normalizedRepoUrl = repoUrl.trim();
  await ensureGitInitialized(projectRoot, logger);

  try {
    const existingRemoteUrl = await getRemoteOriginUrl(projectRoot);

    if (!existingRemoteUrl) {
      await runGit(projectRoot, ['remote', 'add', 'origin', normalizedRepoUrl]);
    } else if (existingRemoteUrl !== normalizedRepoUrl) {
      await runGit(projectRoot, ['remote', 'set-url', 'origin', normalizedRepoUrl]);
    }

    await ensureMainBranch(projectRoot);
    await runGit(projectRoot, ['push', '-u', 'origin', 'main']);

    return {
      ok: true,
      urls: buildPublicAiUrls(normalizedRepoUrl, 'main')
    };
  } catch (error) {
    if (logger) {
      logger.warn(`GitHub link failed gracefully: ${formatGitError(error)}`);
    }

    return {
      ok: false,
      error: error.message
    };
  }
}

async function syncContextToGit(projectRoot, config, logger) {
  const settings = Object.assign(
    {
      enabled: false,
      push: true,
      commitMessage: 'auto: update AI context',
      remote: 'origin',
      branch: 'main',
      repoUrl: ''
    },
    config
  );

  if (!settings.enabled) {
    return {
      skipped: true,
      reason: 'disabled'
    };
  }

  const repositoryReady = await isGitRepository(projectRoot);

  if (!repositoryReady) {
    if (logger) {
      logger.warn('Git sync skipped because this project is not a git repository.');
    }

    return {
      skipped: true,
      reason: 'not_a_repo'
    };
  }

  try {
    const branchName = await ensureMainBranch(projectRoot);
    const remoteUrl = (await getRemoteOriginUrl(projectRoot)) || settings.repoUrl;

    if (!remoteUrl) {
      logMissingRemoteInstructions(logger);
      return {
        skipped: true,
        reason: 'missing_remote'
      };
    }

    await runGit(projectRoot, ['add', '-f', '.ai-context']);

    const hasChanges = await hasStagedContextChanges(projectRoot);
    if (!hasChanges) {
      if (logger) {
        logger.info('No .ai-context changes to sync.');
      }

      return {
        skipped: true,
        reason: 'no_changes'
      };
    }

    await runGit(projectRoot, ['commit', '-m', settings.commitMessage]);

    if (settings.push) {
      const remoteExists = await hasRemote(projectRoot);

      if (!remoteExists) {
        logMissingRemoteInstructions(logger);

        return {
          ok: true,
          pushed: false
        };
      }

      await runGit(projectRoot, ['push', '-u', settings.remote || 'origin', branchName]);
    }

    const urls = buildPublicAiUrls(remoteUrl, branchName);
    logPublicAiEndpoints(logger, urls);

    return {
      ok: true,
      pushed: Boolean(settings.push),
      urls
    };
  } catch (error) {
    if (logger) {
      logger.warn(`Git sync failed gracefully: ${formatGitError(error)}`);
    }

    return {
      ok: false,
      error: error.message
    };
  }
}

module.exports = {
  buildPublicAiUrls,
  ensureGitInitialized,
  getRemoteOriginUrl,
  isGitRepository,
  linkGithubRepository,
  syncContextToGit
};
