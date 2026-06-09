'use strict';

const { initProject }     = require('./core/init');
const { startWatcher }    = require('./core/watcher');
const { generateBriefing } = require('./core/briefingGenerator');
const {
  bootstrapProjectAnalysis,
  updateProjectState,
  loadRuntimeConfig,
  updateRuntimeConfig,
  createDefaultState,
  getContextPaths
} = require('./core/stateManager');
const { startServer }  = require('./server/server');
const {
  buildPublicAiUrls,
  ensureGitInitialized,
  linkGithubRepository,
  syncContextToGit
} = require('./core/gitSync');

module.exports = {
  // Core lifecycle
  initProject,
  startWatcher,
  startServer,

  // State management
  updateProjectState,
  loadRuntimeConfig,
  updateRuntimeConfig,
  createDefaultState,
  getContextPaths,
  bootstrapProjectAnalysis,

  // Briefing
  generateBriefing,

  // Git
  buildPublicAiUrls,
  ensureGitInitialized,
  linkGithubRepository,
  syncContextToGit
};