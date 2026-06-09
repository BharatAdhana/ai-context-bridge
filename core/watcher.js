'use strict';

const path     = require('path');
const chokidar = require('chokidar');

const { syncContextToGit }           = require('./gitSync');
const { captureSnapshot, deleteSnapshot } = require('./fileSnapshot');
const {
  createDebouncedStateUpdater,
  loadRuntimeConfig,
  scoreEvent,
  shouldIgnoreProjectFile,
  updateProjectState
} = require('./stateManager');

function normPath(root, filePath) {
  return path.relative(root, filePath).split(path.sep).join('/');
}

async function startWatcher(projectRoot, options) {
  const settings   = Object.assign({ logger: null }, options);
  const logger     = settings.logger;
  const config     = await loadRuntimeConfig(projectRoot);
  const syncCb     = async () => syncContextToGit(projectRoot, config.gitSync, logger);
  const debounced  = createDebouncedStateUpdater(projectRoot, {
    debounceMs:   config.debounceMs,
    logger,
    syncCallback: syncCb
  });

  const watcher = chokidar.watch(projectRoot, {
    ignored(filePath) {
      const rel = normPath(projectRoot, filePath);
      return shouldIgnoreProjectFile(rel);
    },
    ignoreInitial: true,
    persistent:    true,
    awaitWriteFinish: { stabilityThreshold: 80, pollInterval: 30 }
  });

  // ── ADD: capture snapshot BEFORE chokidar fires for 'change'
  // We pre-read when the watch starts for existing files via 'ready' + 'add'
  watcher.on('add', (filePath) => {
    const rel = normPath(projectRoot, filePath);
    if (!rel || shouldIgnoreProjectFile(rel) || scoreEvent(rel) < 2) return;

    // Snapshot what the file looks like when first seen
    captureSnapshot(filePath);

    if (logger) logger.debug(`Tracking new file: ${rel}`);

    debounced.enqueue({
      timestamp:  new Date().toISOString(),
      action:     'add',
      file:       rel,
      oldContent: null         // brand new file
      // newContent left undefined → watcher will read it fresh
    });
  });

  watcher.on('change', (filePath) => {
    const rel = normPath(projectRoot, filePath);
    if (!rel || shouldIgnoreProjectFile(rel) || scoreEvent(rel) < 2) return;

    // Grab the PREVIOUS content BEFORE it's overwritten on disk
    const oldContent = require('./fileSnapshot').getSnapshot(filePath);

    // Immediately update the snapshot to the latest saved version
    captureSnapshot(filePath);

    if (logger) logger.debug(`Change detected: ${rel}`);

    debounced.enqueue({
      timestamp:  new Date().toISOString(),
      action:     'change',
      file:       rel,
      oldContent  // what it looked like before this save
      // newContent left undefined → stateManager reads from disk (just written)
    });
  });

  watcher.on('unlink', (filePath) => {
    const rel = normPath(projectRoot, filePath);
    if (!rel || shouldIgnoreProjectFile(rel)) return;

    deleteSnapshot(filePath);

    if (logger) logger.debug(`Deleted: ${rel}`);

    debounced.enqueue({
      timestamp:  new Date().toISOString(),
      action:     'delete',
      file:       rel,
      oldContent: null,
      newContent: ''
    });
  });

  watcher.on('error', (err) => {
    if (logger) logger.error(`Watcher error: ${err.message}`);
  });

  // Initial state update on startup
  await updateProjectState(
    projectRoot,
    { timestamp: new Date().toISOString(), action: 'watcher_started', file: '.' },
    { logger, syncCallback: syncCb }
  );

  return {
    watcher,
    async close() {
      await debounced.flushNow();
      await watcher.close();
    },
    async flush() {
      await debounced.flushNow();
    }
  };
}

module.exports = { startWatcher };