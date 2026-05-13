'use strict';

const { initProject } = require('./core/init');
const { startWatcher } = require('./core/watcher');
const {
  bootstrapProjectAnalysis,
  updateProjectState,
  loadRuntimeConfig,
  updateRuntimeConfig
} = require('./core/stateManager');
const { startServer } = require('./server/server');
const {
  buildPublicAiUrls,
  bootstrapProjectAnalysis,
  ensureGitInitialized,
  linkGithubRepository,
  syncContextToGit
} = require('./core/gitSync');

module.exports = {
  buildPublicAiUrls,
  ensureGitInitialized,
  initProject,
  linkGithubRepository,
  startWatcher,
  updateProjectState,
  loadRuntimeConfig,
  updateRuntimeConfig,
  startServer,
  syncContextToGit
};
