'use strict';

const path = require('path');
const fsp = require('fs/promises');

const {
  createDefaultChangelog,
  createDefaultState,
  detectProjectMetadata,
  ensureContextDirectory,
  getContextPaths,
  readJsonFile,
  renderTemplate,
  updateRuntimeConfig,
  writeJsonAtomic,
  writeTextAtomic
} = require('./stateManager');
const { ensureGitInitialized } = require('./gitSync');

async function initProject(projectRoot, options) {
  const settings = Object.assign({ logger: null, force: false }, options);
  const logger = settings.logger;
  const contextDir = await ensureContextDirectory(projectRoot);
  const paths = getContextPaths(projectRoot);
  const metadata = detectProjectMetadata(projectRoot);
  const templateDir = path.join(__dirname, '..', 'templates');
  const stateTemplate = await fsp.readFile(path.join(templateDir, 'state.template.json'), 'utf8');
  const changelogTemplate = await fsp.readFile(
    path.join(templateDir, 'changelog.template.json'),
    'utf8'
  );
  const brainTemplate = await fsp.readFile(path.join(templateDir, 'brain.template.txt'), 'utf8');
  const contextTemplate = await fsp.readFile(path.join(templateDir, 'context.template.md'), 'utf8');
  const existingConfig = await readJsonFile(paths.configFile, null);
  const existingState = await readJsonFile(paths.stateFile, null);
  const existingChangelog = await readJsonFile(paths.changelogFile, null);
  const templateState = JSON.parse(stateTemplate);
  const templateChangelog = JSON.parse(changelogTemplate);

  const initialState = Object.assign({}, templateState, existingState || createDefaultState(projectRoot), {
    project: metadata.project,
    version: metadata.version
  });

  const initialContext = renderTemplate(contextTemplate, {
    PROJECT_NAME: metadata.project,
    PROJECT_VERSION: metadata.version,
    STACK_LABEL: metadata.stackLabel,
    PACKAGE_MANAGER: metadata.packageManager
  });
  const shouldWriteBrain = settings.force || !(await fileExists(paths.brainFile));
  const shouldWriteContext = settings.force || !(await fileExists(paths.contextFile));

  await writeJsonAtomic(paths.stateFile, initialState);
  await writeJsonAtomic(paths.changelogFile, existingChangelog || templateChangelog || createDefaultChangelog());

  if (shouldWriteBrain) {
    await writeTextAtomic(paths.brainFile, brainTemplate);
  }

  if (shouldWriteContext) {
    await writeTextAtomic(paths.contextFile, initialContext);
  }

  await updateRuntimeConfig(
    projectRoot,
    existingConfig
      ? null
      : {
          gitSync: {
            enabled: true,
            push: true,
            commitMessage: 'auto: update AI context'
          }
        }
  );

  await ensureGitInitialized(projectRoot, logger);

  if (logger) {
    logger.info(`Initialized AI context in ${contextDir}`);
  }

  return {
    contextDir,
    metadata
  };
}

async function fileExists(filePath) {
  try {
    await fsp.access(filePath);
    return true;
  } catch (error) {
    return false;
  }
}

module.exports = {
  initProject
};
