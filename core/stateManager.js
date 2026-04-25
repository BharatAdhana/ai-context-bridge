'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const CONTEXT_DIR_NAME = '.ai-context';
const MAX_RECENT_UPDATES = 8;
const MAX_CHANGELOG_ENTRIES = 50;
const IMPORTANT_DIRECTORIES = ['core/', 'server/', 'bin/'];
const IMPORTANT_EXTENSIONS = new Set(['.js', '.ts', '.py']);

const DEFAULT_CONFIG = {
  port: 3333,
  debounceMs: 600,
  gitSync: {
    enabled: false,
    push: true,
    commitMessage: 'auto: update AI context',
    remote: 'origin',
    branch: 'main',
    repoUrl: ''
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
  const techStack = detectTechStack(projectRoot);
  const metadata = {
    project: path.basename(projectRoot),
    version: '0.1.0',
    techStack: Object.assign({}, techStack, {
      package_manager: packageManager
    }),
    stackLabel: buildStackLabel(techStack),
    packageManager
  };

  if (!fs.existsSync(packageJsonPath)) {
    return metadata;
  }

  try {
    const rawPackage = fs.readFileSync(packageJsonPath, 'utf8');
    const parsedPackage = JSON.parse(rawPackage);

    metadata.project = parsedPackage.name || metadata.project;
    metadata.version = parsedPackage.version || metadata.version;
  } catch (error) {
    metadata.stackLabel = buildStackLabel(metadata.techStack);
  }

  return metadata;
}

function detectTechStack(projectRoot) {
  const packageJsonPath = path.join(projectRoot, 'package.json');
  const pythonMarkers = ['pyproject.toml', 'requirements.txt', 'setup.py'];
  const hasPackageJson = fs.existsSync(packageJsonPath);
  const hasPythonMarker = pythonMarkers.some((marker) =>
    fs.existsSync(path.join(projectRoot, marker))
  );
  let dependencies = {};

  if (hasPackageJson) {
    try {
      const rawPackage = fs.readFileSync(packageJsonPath, 'utf8');
      const parsedPackage = JSON.parse(rawPackage);
      dependencies = Object.assign(
        {},
        parsedPackage.dependencies || {},
        parsedPackage.devDependencies || {}
      );
    } catch (error) {
      dependencies = {};
    }
  }

  let language = '';
  let runtime = '';

  if (hasPackageJson || hasAnyFileExtension(projectRoot, ['.js', '.ts', '.mjs', '.cjs'])) {
    language = 'Node.js';
    runtime = 'Node.js';
  } else if (hasPythonMarker || hasAnyFileExtension(projectRoot, ['.py'])) {
    language = 'Python';
    runtime = 'Python';
  }

  return {
    language,
    framework: detectFramework(dependencies),
    runtime,
    package_manager: detectPackageManager(projectRoot)
  };
}

function detectFramework(dependencies) {
  if (dependencies.next) {
    return 'Next.js';
  }

  if (dependencies.react) {
    return 'React';
  }

  if (dependencies.express) {
    return 'Express';
  }

  return '';
}

function buildStackLabel(techStack) {
  const parts = [techStack.language, techStack.framework].filter(Boolean);
  return parts.length > 0 ? parts.join(' + ') : 'Project';
}

function hasAnyFileExtension(projectRoot, extensions) {
  return scanProjectFiles(projectRoot, 2).some((filePath) =>
    extensions.includes(path.extname(filePath).toLowerCase())
  );
}

function scanProjectFiles(projectRoot, maxDepth) {
  const results = [];

  function visit(currentDir, depth) {
    if (depth > maxDepth) {
      return;
    }

    let entries = [];

    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch (error) {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      const relativePath = normalizeProjectPath(path.relative(projectRoot, fullPath));

      if (entry.isDirectory()) {
        if (shouldIgnoreProjectFile(relativePath)) {
          continue;
        }

        visit(fullPath, depth + 1);
        continue;
      }

      if (!shouldIgnoreProjectFile(relativePath)) {
        results.push(relativePath);
      }
    }
  }

  visit(projectRoot, 0);
  return results;
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
  const keyFeatures = deriveKeyFeatures(projectRoot);
  const knownIssues = deriveKnownIssues(projectRoot, metadata.techStack);
  const currentStage = determineCurrentStage(keyFeatures);
  const state = {
    project: metadata.project,
    version: metadata.version,
    last_updated: new Date(0).toISOString(),
    ai_summary: '',
    tech_stack: metadata.techStack,
    current_stage: currentStage,
    recent_updates: [],
    key_features: keyFeatures,
    known_issues: knownIssues,
    next_steps: []
  };

  state.ai_summary = generateAiSummary(state);
  state.next_steps = generateNextSteps(state);

  return state;
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

async function updateRuntimeConfig(projectRoot, updates) {
  const { configFile } = getContextPaths(projectRoot);
  const currentConfig = await readJsonFile(configFile, {});
  const mergedCurrentConfig = deepMerge(DEFAULT_CONFIG, currentConfig);
  const nextConfig = deepMerge(mergedCurrentConfig, updates || {});

  await writeJsonAtomic(configFile, nextConfig);
  return nextConfig;
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
  const metadata = detectProjectMetadata(projectRoot);
  const existingState = await readJsonFile(contextPaths.stateFile, createDefaultState(projectRoot));
  const existingChangelog = await readJsonFile(
    contextPaths.changelogFile,
    createDefaultChangelog()
  );
  const normalizedEvents = Array.isArray(changeEvent) ? changeEvent : [changeEvent];
  const validEvents = normalizedEvents.filter(Boolean);
  const timestamp = determineUpdateTimestamp(validEvents);
  const meaningfulEvents = collapseEventsByFile(
    validEvents.filter((event) => isMeaningfulEvent(event))
  );
  const interpretedEvents = meaningfulEvents
    .map((event) => interpretChange(event))
    .filter(Boolean);
  const previousRecentUpdates = normalizeStoredUpdates(existingState.recent_updates);
  const previousHistoryEntries = normalizeStoredHistoryEntries(existingChangelog.entries);
  const recentUpdates = dedupeRecentUpdates(
    interpretedEvents.map(toStateUpdate).concat(previousRecentUpdates)
  ).slice(0, MAX_RECENT_UPDATES);
  const historyEntries = dedupeHistoryEntries(
    interpretedEvents.concat(previousHistoryEntries)
  ).slice(0, MAX_CHANGELOG_ENTRIES);
  const keyFeatures = deriveKeyFeatures(projectRoot);
  const knownIssues = deriveKnownIssues(projectRoot, metadata.techStack);
  const nextState = {
    project: metadata.project,
    version: metadata.version,
    last_updated: timestamp,
    ai_summary: '',
    tech_stack: metadata.techStack,
    current_stage: determineCurrentStage(keyFeatures),
    recent_updates: recentUpdates,
    key_features: keyFeatures,
    known_issues: knownIssues,
    next_steps: []
  };

  nextState.ai_summary = generateAiSummary(nextState);
  nextState.next_steps = generateNextSteps(nextState);

  await writeJsonAtomic(contextPaths.stateFile, nextState);
  await writeJsonAtomic(contextPaths.changelogFile, { entries: historyEntries });

  if (logger) {
    logger.debug(`Updated AI context with ${interpretedEvents.length} meaningful change(s).`);
  }

  if (typeof settings.syncCallback === 'function') {
    await settings.syncCallback();
  }

  return nextState;
}

function determineUpdateTimestamp(events) {
  if (!Array.isArray(events) || events.length === 0) {
    return new Date().toISOString();
  }

  const latestEvent = events[events.length - 1];
  return latestEvent.timestamp || new Date().toISOString();
}

function normalizeProjectPath(filePath) {
  return String(filePath || '').split(path.sep).join('/').replace(/^\.\/+/, '');
}

function shouldIgnoreProjectFile(filePath) {
  const normalizedPath = normalizeProjectPath(filePath).toLowerCase();

  if (!normalizedPath) {
    return false;
  }

  const segments = normalizedPath.split('/');
  const baseName = segments[segments.length - 1];

  if (
    segments.includes('node_modules') ||
    segments.includes('.git') ||
    segments.includes('.ai-context') ||
    segments.includes('dist') ||
    segments.includes('build')
  ) {
    return true;
  }

  if (baseName.startsWith('.start')) {
    return true;
  }

  if (
    baseName.endsWith('.log') ||
    baseName.endsWith('.tmp') ||
    baseName.endsWith('.lock') ||
    baseName === 'package-lock.json' ||
    baseName === 'yarn.lock' ||
    baseName === 'pnpm-lock.yaml' ||
    /^tmp[._-]/i.test(baseName) ||
    /^temp[._-]/i.test(baseName) ||
    /^debug[._-]/i.test(baseName)
  ) {
    return true;
  }

  return false;
}

function scoreEvent(filePath) {
  const normalizedPath = normalizeProjectPath(filePath);
  const lowerPath = normalizedPath.toLowerCase();
  const baseName = path.basename(normalizedPath).toLowerCase();
  let score = 0;

  if (shouldIgnoreProjectFile(normalizedPath)) {
    return -5;
  }

  if (IMPORTANT_DIRECTORIES.some((directory) => lowerPath.startsWith(directory))) {
    score += 3;
  }

  if (IMPORTANT_EXTENSIONS.has(path.extname(baseName))) {
    score += 2;
  }

  if (lowerPath === 'package.json') {
    score += 2;
  }

  if (lowerPath === 'readme.md') {
    score += 1;
  }

  return score;
}

function isMeaningfulEvent(event) {
  if (!event || !event.file) {
    return false;
  }

  return scoreEvent(event.file) >= 2;
}

function collapseEventsByFile(events) {
  const collapsedEvents = new Map();

  for (const event of events) {
    const normalizedFile = normalizeProjectPath(event.file).toLowerCase();
    collapsedEvents.set(
      normalizedFile,
      Object.assign({}, event, {
        file: normalizeProjectPath(event.file)
      })
    );
  }

  return Array.from(collapsedEvents.values());
}

function interpretChange(event) {
  const filePath = normalizeProjectPath(event.file);
  const area = classifyChangeArea(filePath);
  const subject = describeChangeSubject(filePath, area);
  const type = mapActionToType(event.action);
  const title = `${mapActionToVerb(event.action)} ${subject}`;

  return {
    timestamp: event.timestamp || new Date().toISOString(),
    file: filePath,
    title,
    type,
    impact: describeImpact(area, subject, event.action)
  };
}

function classifyChangeArea(filePath) {
  const lowerPath = filePath.toLowerCase();

  if (lowerPath === 'package.json') {
    return 'dependencies';
  }

  if (lowerPath === 'readme.md') {
    return 'documentation';
  }

  if (lowerPath.startsWith('core/')) {
    return 'logic';
  }

  if (lowerPath.startsWith('server/')) {
    return 'backend';
  }

  if (lowerPath.startsWith('bin/')) {
    return 'CLI';
  }

  if (lowerPath.startsWith('templates/')) {
    return 'templates';
  }

  return 'project';
}

function describeChangeSubject(filePath, area) {
  const lowerPath = filePath.toLowerCase();
  const baseName = path.basename(filePath);

  if (lowerPath === 'package.json') {
    return 'dependency configuration';
  }

  if (lowerPath === 'readme.md') {
    return 'documentation';
  }

  if (lowerPath === 'core/gitsync.js') {
    return 'GitHub sync logic';
  }

  if (lowerPath === 'core/statemanager.js') {
    return 'state intelligence logic';
  }

  if (lowerPath === 'core/watcher.js') {
    return 'watcher logic';
  }

  if (lowerPath === 'core/init.js') {
    return 'initialization flow';
  }

  if (lowerPath === 'server/server.js') {
    return 'backend server';
  }

  if (lowerPath === 'server/routes.js') {
    return 'backend routes';
  }

  if (lowerPath === 'bin/cli.js') {
    return 'CLI workflow';
  }

  if (area === 'templates') {
    return `${humanizeFileName(baseName)} template`;
  }

  if (area === 'logic') {
    return `${humanizeFileName(baseName)} logic`;
  }

  if (area === 'backend') {
    return `${humanizeFileName(baseName)} backend`;
  }

  if (area === 'CLI') {
    return 'CLI workflow';
  }

  return humanizeFileName(baseName);
}

function humanizeFileName(fileName) {
  return fileName
    .replace(path.extname(fileName), '')
    .replace(/[-_.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function mapActionToType(action) {
  if (action === 'add') {
    return 'feature';
  }

  if (action === 'delete') {
    return 'removal';
  }

  return 'improvement';
}

function mapActionToVerb(action) {
  if (action === 'add') {
    return 'Added';
  }

  if (action === 'delete') {
    return 'Removed';
  }

  return 'Updated';
}

function describeImpact(area, subject, action) {
  if (action === 'delete') {
    return `Removes ${subject.toLowerCase()} from the project workflow.`;
  }

  if (subject === 'GitHub sync logic') {
    return 'Improves reliability of context syncing.';
  }

  if (subject === 'state intelligence logic') {
    return 'Improves the quality of AI-readable project state.';
  }

  if (subject === 'watcher logic') {
    return 'Improves how meaningful project changes are detected.';
  }

  if (area === 'backend') {
    return 'Improves local AI context delivery.';
  }

  if (area === 'CLI') {
    return 'Improves command-line workflow clarity and usability.';
  }

  if (area === 'documentation') {
    return 'Improves onboarding and usage clarity.';
  }

  if (area === 'dependencies') {
    return 'Updates package behavior and dependency management.';
  }

  if (area === 'templates') {
    return 'Improves generated AI context defaults.';
  }

  return 'Improves core project intelligence and automation.';
}

function normalizeStoredUpdates(updates) {
  if (!Array.isArray(updates)) {
    return [];
  }

  return dedupeRecentUpdates(
    updates
      .map((update) => normalizeStoredUpdate(update))
      .filter(Boolean)
  );
}

function normalizeStoredUpdate(update) {
  if (!update) {
    return null;
  }

  if (update.title && update.type && update.impact) {
    return {
      title: update.title,
      type: update.type,
      impact: update.impact
    };
  }

  if (update.file && update.action && isMeaningfulEvent(update)) {
    return toStateUpdate(interpretChange(update));
  }

  return null;
}

function normalizeStoredHistoryEntries(entries) {
  if (!Array.isArray(entries)) {
    return [];
  }

  return dedupeHistoryEntries(
    entries
      .map((entry) => normalizeStoredHistoryEntry(entry))
      .filter(Boolean)
  );
}

function normalizeStoredHistoryEntry(entry) {
  if (!entry) {
    return null;
  }

  if (entry.title && entry.type && entry.impact) {
    return {
      timestamp: entry.timestamp || new Date(0).toISOString(),
      file: normalizeProjectPath(entry.file || ''),
      title: entry.title,
      type: entry.type,
      impact: entry.impact
    };
  }

  if (entry.file && entry.action && isMeaningfulEvent(entry)) {
    return interpretChange(entry);
  }

  return null;
}

function toStateUpdate(update) {
  return {
    title: update.title,
    type: update.type,
    impact: update.impact
  };
}

function dedupeRecentUpdates(updates) {
  const seenUpdates = new Set();
  const result = [];

  for (const update of updates) {
    const key = `${update.title}::${update.type}::${update.impact}`;

    if (seenUpdates.has(key)) {
      continue;
    }

    seenUpdates.add(key);
    result.push(update);
  }

  return result;
}

function dedupeHistoryEntries(entries) {
  const seenEntries = new Set();
  const result = [];

  for (const entry of entries) {
    const key = `${entry.title}::${entry.type}::${entry.file}`;

    if (seenEntries.has(key)) {
      continue;
    }

    seenEntries.add(key);
    result.push(entry);
  }

  return result;
}

function deriveKeyFeatures(projectRoot) {
  const features = [];

  if (fs.existsSync(path.join(projectRoot, 'bin', 'cli.js'))) {
    features.push('CLI commands for initializing, linking, starting, and updating AI context');
  }

  if (fs.existsSync(path.join(projectRoot, 'core', 'watcher.js'))) {
    features.push('Noise-filtered watcher that turns file changes into meaningful project updates');
  }

  if (
    fs.existsSync(path.join(projectRoot, 'server', 'server.js')) &&
    fs.existsSync(path.join(projectRoot, 'server', 'routes.js'))
  ) {
    features.push('Local Express server for AI-readable context endpoints');
  }

  if (fs.existsSync(path.join(projectRoot, 'core', 'gitSync.js'))) {
    features.push('Optional GitHub sync for publishing public AI-readable context');
  }

  if (fs.existsSync(path.join(projectRoot, 'core', 'stateManager.js'))) {
    features.push('Intelligent state engine that summarizes project evolution for AI tools');
  }

  return features;
}

function deriveKnownIssues(projectRoot, techStack) {
  const knownIssues = [];

  if (!hasTestIndicators(projectRoot)) {
    knownIssues.push('No automated test suite is detected yet.');
  }

  if (!techStack.framework) {
    knownIssues.push('No common application framework dependency is currently detected.');
  }

  return knownIssues;
}

function hasTestIndicators(projectRoot) {
  const testPaths = [
    'test',
    'tests',
    '__tests__',
    'vitest.config.js',
    'jest.config.js',
    'jest.config.cjs',
    'jest.config.mjs'
  ];

  return testPaths.some((relativePath) => fs.existsSync(path.join(projectRoot, relativePath)));
}

function determineCurrentStage(keyFeatures) {
  const hasCli = keyFeatures.some((feature) => feature.includes('CLI commands'));
  const hasSync = keyFeatures.some((feature) => feature.includes('GitHub sync'));
  const hasServer = keyFeatures.some((feature) => feature.includes('Express server'));
  const hasWatcher = keyFeatures.some((feature) => feature.includes('watcher'));
  const hasIntelligence = keyFeatures.some((feature) => feature.includes('Intelligent state engine'));

  if (hasCli && hasSync && hasServer && hasWatcher && hasIntelligence) {
    return 'Production-ready';
  }

  if (hasCli && hasSync) {
    return 'Functional prototype';
  }

  return 'Early development';
}

function generateAiSummary(state) {
  const language = state.tech_stack.language || 'Project';
  const hasServer = state.key_features.some((feature) => feature.includes('Express server'));
  const hasSync = state.key_features.some((feature) => feature.includes('GitHub sync'));
  const clauses = ['tracks meaningful project evolution', 'generates structured AI-readable context'];

  if (hasServer) {
    clauses.push('serves project context locally through Express');
  }

  if (hasSync) {
    clauses.push('can publish public AI-readable context through optional GitHub sync');
  }

  return `AI-powered ${language} CLI that ${clauses.join(', ')}.`;
}

function generateNextSteps(state) {
  const nextSteps = [];

  if (state.key_features.length === 0) {
    nextSteps.push('Define core features for the AI context workflow.');
  }

  if (state.known_issues.includes('No automated test suite is detected yet.')) {
    nextSteps.push('Add automated tests for the state engine, watcher, and GitHub sync flows.');
  }

  if (state.current_stage === 'Early development') {
    nextSteps.push('Implement the next core workflow milestone and document how AI should use it.');
  }

  if (state.current_stage === 'Functional prototype') {
    nextSteps.push('Harden the current feature set with tests and release validation.');
  }

  if (!state.tech_stack.framework) {
    nextSteps.push('Document the intended framework or extend stack detection for this project.');
  }

  if (state.recent_updates.length === 0) {
    nextSteps.push('Capture the first meaningful project milestone to seed AI context history.');
  }

  return Array.from(new Set(nextSteps)).slice(0, 4);
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
  interpretChange,
  loadRuntimeConfig,
  readJsonFile,
  renderTemplate,
  scoreEvent,
  shouldIgnoreProjectFile,
  updateRuntimeConfig,
  updateProjectState,
  writeJsonAtomic,
  writeTextAtomic
};
