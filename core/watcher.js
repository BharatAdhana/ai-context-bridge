'use strict';

const path = require('path');
const chokidar = require('chokidar');

const { syncContextToGit } = require('./gitSync');
const {
  createDebouncedStateUpdater,
  loadRuntimeConfig,
  updateProjectState
} = require('./stateManager');

function normalizeFilePath(projectRoot, filePath) {
  return path.relative(projectRoot, filePath).split(path.sep).join('/');
}

async function startWatcher(projectRoot, options) {
  const settings = Object.assign({ logger: null }, options);
  const logger = settings.logger;
  const config = await loadRuntimeConfig(projectRoot);
  const syncCallback = async () =>
    syncContextToGit(projectRoot, config.gitSync, logger);
  const debouncedUpdater = createDebouncedStateUpdater(projectRoot, {
    debounceMs: config.debounceMs,
    logger,
    syncCallback
  });

  const watcher = chokidar.watch(projectRoot, {
    ignored: [
      /(^|[\\/])\.git([\\/]|$)/,
      /(^|[\\/])node_modules([\\/]|$)/,
      /(^|[\\/])\.ai-context([\\/]|$)/
    ],
    ignoreInitial: true,
    persistent: true
  });

  function handleEvent(action, filePath) {
    const normalizedPath = normalizeFilePath(projectRoot, filePath);

    if (!normalizedPath || normalizedPath.startsWith('.ai-context/')) {
      return;
    }

    if (logger) {
      logger.info(`${action} ${normalizedPath}`);
    }

    debouncedUpdater.enqueue({
      timestamp: new Date().toISOString(),
      action,
      file: normalizedPath
    });
  }

  watcher.on('add', (filePath) => handleEvent('add', filePath));
  watcher.on('change', (filePath) => handleEvent('change', filePath));
  watcher.on('unlink', (filePath) => handleEvent('delete', filePath));
  watcher.on('error', (error) => {
    if (logger) {
      logger.error(`Watcher error: ${error.message}`);
    }
  });

  await updateProjectState(
    projectRoot,
    {
      timestamp: new Date().toISOString(),
      action: 'watcher_started',
      file: '.'
    },
    {
      logger,
      syncCallback
    }
  );

  return {
    watcher,
    async close() {
      await debouncedUpdater.flushNow();
      await watcher.close();
    },
    async flush() {
      await debouncedUpdater.flushNow();
    }
  };
}

module.exports = {
  startWatcher
};
