#!/usr/bin/env node
'use strict';

const path = require('path');
const readline = require('readline/promises');
const { stdin, stdout } = require('process');
const { initProject } = require('../core/init');
const { startWatcher } = require('../core/watcher');
const {
  loadRuntimeConfig,
  updateProjectState,
  updateRuntimeConfig
} = require('../core/stateManager');
const { linkGithubRepository, syncContextToGit } = require('../core/gitSync');
const { startServer } = require('../server/server');
const { createLogger } = require('../utils/logger');

async function run() {
  const logger = createLogger();
  const projectRoot = process.cwd();
  const command = process.argv[2];

  if (!command || command === '--help' || command === '-h') {
    printHelp();
    return;
  }

  if (command === '--version' || command === '-v') {
    // eslint-disable-next-line global-require
    const packageJson = require(path.join(__dirname, '..', 'package.json'));
    console.log(packageJson.version);
    return;
  }

  try {
    if (command === 'init') {
      await initProject(projectRoot, { logger });
      return;
    }

    if (command === 'update') {
      await initProject(projectRoot, { logger });
      const config = await loadRuntimeConfig(projectRoot);
      await updateProjectState(
        projectRoot,
        {
          timestamp: new Date().toISOString(),
          action: 'manual_update',
          file: '.'
        },
        {
          logger,
          syncCallback: async () => syncContextToGit(projectRoot, config.gitSync, logger)
        }
      );
      logger.info('Manual AI context update completed.');
      return;
    }

    if (command === 'link-github') {
      await initProject(projectRoot, { logger });
      const repoUrl = process.argv[3] || (await promptForRepoUrl());

      if (!repoUrl) {
        logger.error('A GitHub repository URL is required.');
        process.exitCode = 1;
        return;
      }

      const nextConfig = await updateRuntimeConfig(projectRoot, {
        gitSync: {
          enabled: true,
          push: true,
          repoUrl: repoUrl.trim()
        }
      });
      const linkResult = await linkGithubRepository(projectRoot, repoUrl.trim(), logger);

      if (!linkResult.ok) {
        process.exitCode = 1;
        return;
      }

      await syncContextToGit(projectRoot, nextConfig.gitSync, logger);
      return;
    }

    if (command === 'start') {
      await initProject(projectRoot, { logger });
      const config = await loadRuntimeConfig(projectRoot);
      const serverHandle = await startServer({
        projectRoot,
        port: Number(process.env.AI_CONTEXT_PORT || config.port || 3333),
        logger
      });
      const watcherHandle = await startWatcher(projectRoot, { logger });

      const shutdown = async (signal) => {
        logger.info(`Received ${signal}; shutting down cleanly.`);
        await watcherHandle.close();
        await serverHandle.close();
        process.exit(0);
      };

      process.on('SIGINT', () => {
        shutdown('SIGINT').catch((error) => {
          logger.error(`Shutdown failed: ${error.message}`);
          process.exit(1);
        });
      });

      process.on('SIGTERM', () => {
        shutdown('SIGTERM').catch((error) => {
          logger.error(`Shutdown failed: ${error.message}`);
          process.exit(1);
        });
      });

      return;
    }

    logger.error(`Unknown command: ${command}`);
    printHelp();
    process.exitCode = 1;
  } catch (error) {
    logger.error(error.stack || error.message);
    process.exitCode = 1;
  }
}

function printHelp() {
  console.log(`aibridge-context

Usage:
  aibridge init
  aibridge link-github
  aibridge start
  aibridge update

Commands:
  init    Create .ai-context and initialize AI context files
  link-github  Connect a GitHub remote and enable public AI sync
  start   Start the watcher and local server on port 3333
  update  Trigger a manual state update
`);
}

async function promptForRepoUrl() {
  const rl = readline.createInterface({
    input: stdin,
    output: stdout
  });

  try {
    const response = await rl.question('GitHub repository URL: ');
    return response.trim();
  } finally {
    rl.close();
  }
}

run();
