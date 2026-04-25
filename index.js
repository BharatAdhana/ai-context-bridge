'use strict';

const { initProject } = require('./core/init');
const { startWatcher } = require('./core/watcher');
const { updateProjectState, loadRuntimeConfig } = require('./core/stateManager');
const { startServer } = require('./server/server');
const { syncContextToGit } = require('./core/gitSync');

module.exports = {
  initProject,
  startWatcher,
  updateProjectState,
  loadRuntimeConfig,
  startServer,
  syncContextToGit
};
