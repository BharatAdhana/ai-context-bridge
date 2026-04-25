'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const CONTEXT_DIR_NAME = '.ai-context';
const MAX_RECENT_UPDATES = 50;
const MAX_CHANGELOG_ENTRIES = 200;

const DEFAULT_CONFIG = {
  port: 3333,
  debounceMs: 600,
  gitSync: {
    enabled: false,
    push: true,
    commitMessage: 'auto: update AI context'
  }
};

function getContextPaths(projectRoot) {
  const contextDir = path.join(projectRoot, CONTEXT_DIR_NAME);

  return {
    contextDir,
    stateFile: path.join(contextDir, 'state.json'),
    brainFile: path.join(contextDir, 'brain.txt'),
    contextFile: path.join(contextDir, 'context.md'),
    changelogFile: path.join(contextDir, 'changelog.json'),
    configFile: path.join(contextDir, 'config.json')
  };
}

function deepMerge(baseValue, overrideValue) {
  if (Array.isArray(baseValue) || Array.isArray(overrideValue)) {
    return overrideValue === undefined ? baseValue : overrideValue;
  }

  if (isObject(baseValue) && isObject(overrideValue)) {
    const merged = Object.assign({}, baseValue);

    for (const [key, value] of Object.entries(overrideValue)) {
      merged[key] = deepMerge(baseValue[key], value);
    }

    return merged;
  }

  return overrideValue === undefined ? baseValue : overrideValue;
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function detectProjectMetadata(projectRoot) {
  const packageJsonPath = path.join(projectRoot, 'package.json');
  const packageManager = detectPackageManager(projectRoot);
  const metadata = {
    project: path.basename(projectRoot),
    version: '0.1.0',
    stackLabel: 'Node.js project',
    packageManager
  };

  if (!fs.existsSync(packageJsonPath)) {
    return metadata;
  }

  try {
    const rawPackage = fs.readFileSync(packageJsonPath, 'utf8');
    const parsedPackage = JSON.parse(rawPackage);
    const dependencies = Object.assign(
      {},
      parsedPackage.dependencies || {},
      parsedPackage.devDependencies || {}
    );

    metadata.project = parsedPackage.name || metadata.project;
    metadata.version = parsedPackage.version || metadata.version;
    metadata.stackLabel = describeStack(dependencies);
    metadata.packageManager = packageManager;
  } catch (error) {
    metadata.stackLabel = 'Node.js project';
  }

  return metadata;
}

function detectPackageManager(projectRoot) {
  if (fs.existsSync(path.join(projectRoot, 'pnpm-lock.yaml'))) {
    return 'pnpm';
  }

  if (fs.existsSync(path.join(projectRoot, 'yarn.lock'))) {
    return 'yarn';
  }

  return 'npm';
}

function describeStack(dependencies) {
  if (dependencies.next) {
    return 'Node.js + Next.js';
  }

  if (dependencies.react) {
    return 'Node.js + React';
  }

  if (dependencies.express) {
    return 'Node.js + Express';
  }

  if (dependencies.typescript) {
    return 'Node.js + TypeScript';
  }

  return 'Node.js project';
}

async function ensureContextDirectory(projectRoot) {
  const { contextDir } = getContextPaths(projectRoot);
  await fsp.mkdir(contextDir, { recursive: true });
  return contextDir;
}

async function readJsonFile(filePath, fallbackValue) {
  try {
    const raw = await fsp.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    return fallbackValue;
  }
}

async function writeJsonAtomic(filePath, value) {
  const content = `${JSON.stringify(value, null, 2)}\n`;
  await writeTextAtomic(filePath, content);
}

async function writeTextAtomic(filePath, content) {
  const tempFilePath = `${filePath}.tmp`;
  await fsp.writeFile(tempFilePath, content, 'utf8');
  await fsp.rename(tempFilePath, filePath);
}

function createDefaultState(projectRoot) {
  const metadata = detectProjectMetadata(projectRoot);

  return {
    project: metadata.project,
    version: metadata.version,
    last_updated: new Date(0).toISOString(),
    stats: {
      files_changed: 0,
      last_file: ''
    },
    recent_updates: [],
    features: [],
    next_steps: []
  };
}

function createDefaultChangelog() {
  return {
    entries: []
  };
}

function renderTemplate(template, variables) {
  return Object.entries(variables).reduce((accumulator, [key, value]) => {
    const safeValue = value == null ? '' : String(value);
    return accumulator.split(`{{${key}}}`).join(safeValue);
  }, template);
}

async function loadRuntimeConfig(projectRoot) {
  const { configFile } = getContextPaths(projectRoot);
  const userConfig = await readJsonFile(configFile, {});
  return deepMerge(DEFAULT_CONFIG, userConfig);
}

async function updateProjectState(projectRoot, changeEvent, options) {
  const settings = Object.assign(
    {
      logger: null,
      syncCallback: null
    },
    options
  );
  const logger = settings.logger;
  const contextPaths = getContextPaths(projectRoot);
  const state = await readJsonFile(contextPaths.stateFile, createDefaultState(projectRoot));
  const changelog = await readJsonFile(contextPaths.changelogFile, createDefaultChangelog());
  const normalizedEvents = Array.isArray(changeEvent) ? changeEvent : [changeEvent];
  const validEvents = normalizedEvents.filter(Boolean);

  if (validEvents.length === 0) {
    return state;
  }

  const latestEvent = validEvents[validEvents.length - 1];
  const timestamp = latestEvent.timestamp || new Date().toISOString();
  const recentUpdates = Array.isArray(state.recent_updates) ? state.recent_updates.slice() : [];
  const changelogEntries = Array.isArray(changelog.entries) ? changelog.entries.slice() : [];

  for (const event of validEvents) {
    const normalizedEvent = {
      timestamp: event.timestamp || timestamp,
      action: event.action || 'updated',
      file: event.file || ''
    };

    recentUpdates.push(normalizedEvent);
    changelogEntries.push(normalizedEvent);
  }

  const nextState = {
    project: state.project || createDefaultState(projectRoot).project,
    version: state.version || createDefaultState(projectRoot).version,
    last_updated: timestamp,
    stats: {
      files_changed: (state.stats && typeof state.stats.files_changed === 'number'
        ? state.stats.files_changed
        : 0) + validEvents.length,
      last_file: latestEvent.file || ''
    },
    recent_updates: recentUpdates.slice(-MAX_RECENT_UPDATES),
    features: Array.isArray(state.features) ? state.features : [],
    next_steps: Array.isArray(state.next_steps) ? state.next_steps : []
  };

  const nextChangelog = {
    entries: changelogEntries.slice(-MAX_CHANGELOG_ENTRIES)
  };

  await writeJsonAtomic(contextPaths.stateFile, nextState);
  await writeJsonAtomic(contextPaths.changelogFile, nextChangelog);

  if (logger) {
    logger.debug(`Updated AI context for ${validEvents.length} change(s).`);
  }

  if (typeof settings.syncCallback === 'function') {
    await settings.syncCallback();
  }

  return nextState;
}

function createDebouncedStateUpdater(projectRoot, options) {
  const settings = Object.assign(
    {
      debounceMs: DEFAULT_CONFIG.debounceMs,
      logger: null,
      syncCallback: null
    },
    options
  );

  let timer = null;
  let pendingEvents = [];
  let activeFlush = Promise.resolve();

  async function flush() {
    if (pendingEvents.length === 0) {
      return;
    }

    const events = pendingEvents.slice();
    pendingEvents = [];

    activeFlush = activeFlush.then(() =>
      updateProjectState(projectRoot, events, {
        logger: settings.logger,
        syncCallback: settings.syncCallback
      })
    );

    await activeFlush;
  }

  return {
    enqueue(event) {
      pendingEvents.push(event);

      if (timer) {
        clearTimeout(timer);
      }

      timer = setTimeout(() => {
        timer = null;
        flush().catch((error) => {
          if (settings.logger) {
            settings.logger.error(`Failed to flush AI context updates: ${error.message}`);
          }
        });
      }, settings.debounceMs);
    },
    async flushNow() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }

      await flush();
    }
  };
}

module.exports = {
  CONTEXT_DIR_NAME,
  DEFAULT_CONFIG,
  createDebouncedStateUpdater,
  createDefaultChangelog,
  createDefaultState,
  detectProjectMetadata,
  ensureContextDirectory,
  getContextPaths,
  loadRuntimeConfig,
  readJsonFile,
  renderTemplate,
  updateProjectState,
  writeJsonAtomic,
  writeTextAtomic
};
