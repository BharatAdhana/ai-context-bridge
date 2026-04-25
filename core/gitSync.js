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
    const result = await runGit(projectRoot, ['remote']);
    return result.stdout.trim().length > 0;
  } catch (error) {
    return false;
  }
}

async function hasStagedContextChanges(projectRoot) {
  try {
    await runGit(projectRoot, ['diff', '--cached', '--quiet', '--', '.ai-context']);
    return false;
  } catch (error) {
    return true;
  }
}

async function syncContextToGit(projectRoot, config, logger) {
  const settings = Object.assign(
    {
      enabled: false,
      push: true,
      commitMessage: 'auto: update AI context'
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
    await runGit(projectRoot, ['add', '.ai-context']);

    const hasChanges = await hasStagedContextChanges(projectRoot);
    if (!hasChanges) {
      return {
        skipped: true,
        reason: 'no_changes'
      };
    }

    await runGit(projectRoot, ['commit', '-m', settings.commitMessage]);

    if (settings.push) {
      const remoteExists = await hasRemote(projectRoot);

      if (!remoteExists) {
        if (logger) {
          logger.warn('Git sync committed locally, but no remote is configured for push.');
        }

        return {
          ok: true,
          pushed: false
        };
      }

      await runGit(projectRoot, ['push']);
    }

    if (logger) {
      logger.info('Synced .ai-context changes to git.');
    }

    return {
      ok: true,
      pushed: Boolean(settings.push)
    };
  } catch (error) {
    if (logger) {
      logger.warn(`Git sync failed gracefully: ${error.message}`);
    }

    return {
      ok: false,
      error: error.message
    };
  }
}

module.exports = {
  isGitRepository,
  syncContextToGit
};
