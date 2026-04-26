'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const CONTEXT_DIR_NAME = '.ai-context';
const MAX_RECENT_UPDATES = 5;
const MAX_CHANGELOG_ENTRIES = 50;
const MAX_KEY_FEATURES = 6;
const IMPORTANT_DIRECTORIES = ['core/', 'server/', 'bin/'];
const IMPORTANT_EXTENSIONS = new Set(['.js', '.ts', '.py']);
const LOW_VALUE_FEATURE_KEYS = new Set([
  'documentation',
  'package_configuration',
  'context_templates',
  'project_workflow'
]);

async function safeWriteJSON(filePath, data) {
  const fs = require("fs");
  const path = require("path");

  const tmpPath = filePath + ".tmp";

  try {
    // ensure directory exists
    fs.mkdirSync(path.dirname(filePath), { recursive: true });

    // write temp file
    await fs.promises.writeFile(tmpPath, data, "utf-8");

    // rename only if tmp exists
    if (fs.existsSync(tmpPath)) {
      await fs.promises.rename(tmpPath, filePath);
    } else {
      await fs.promises.writeFile(filePath, data, "utf-8");
    }
  } catch (err) {
    console.error("[aibridge] Write fallback triggered:", err.message);

    try {
      await fs.promises.writeFile(filePath, data, "utf-8");
    } catch (e) {
      console.error("[aibridge] Failed to write state file:", e.message);
    }
  }
}

const FEATURE_CATALOG = {
  cli_workflow: {
    name: 'CLI workflow for initializing, updating, and linking AI context',
    subject: 'CLI workflow',
    projectType: 'CLI tool'
  },
  github_sync: {
    name: 'Public GitHub sync for AI-readable project context',
    subject: 'GitHub sync system',
    projectType: 'CLI tool'
  },
  project_intelligence: {
    name: 'Project intelligence engine that turns development activity into AI-readable state',
    subject: 'project intelligence engine',
    projectType: 'project intelligence engine'
  },
  change_tracking: {
    name: 'Meaningful change tracking that filters noise from project activity',
    subject: 'change tracking engine',
    projectType: 'change tracking engine'
  },
  local_context_server: {
    name: 'Local server for AI-readable project context endpoints',
    subject: 'AI context delivery service',
    projectType: 'context delivery service'
  },
  context_delivery_system: {
    name: 'Unified context delivery system connecting project intelligence and serving layers',
    subject: 'AI context delivery system',
    projectType: 'AI context system'
  },
  cli_orchestration: {
    name: 'Command workflow that connects project intelligence with developer actions',
    subject: 'CLI workflow',
    projectType: 'CLI tool'
  },
  project_setup: {
    name: 'Guided setup flow for safe AI context initialization',
    subject: 'project setup flow',
    projectType: 'CLI tool'
  },
  documentation: {
    name: 'Developer guidance for adopting the AI context workflow',
    subject: 'developer guidance',
    projectType: 'project'
  },
  package_configuration: {
    name: 'Package configuration for distributing the AI context CLI',
    subject: 'package configuration',
    projectType: 'package'
  },
  context_templates: {
    name: 'Generated templates for bootstrapping AI-readable project context',
    subject: 'generated AI context templates',
    projectType: 'template set'
  },
  project_workflow: {
    name: 'Core project workflow for maintaining AI-readable project state',
    subject: 'project workflow',
    projectType: 'project'
  }
};

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
  await safeWriteJSON(filePath, content);
}

function createDefaultState(projectRoot) {
  const metadata = detectProjectMetadata(projectRoot);
  const state = {
    project: metadata.project,
    version: metadata.version,
    last_updated: new Date(0).toISOString(),
    ai_summary: '',
    tech_stack: metadata.techStack,
    current_stage: 'Early development',
    recent_updates: [],
    key_features: [],
    known_issues: deriveKnownIssues(projectRoot, metadata.techStack, []),
    next_steps: []
  };

  state.ai_summary = generateAiSummary(state, []);
  state.next_steps = generateNextSteps(state, []);

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
  const groupedUpdates = groupEventsByIntent(meaningfulEvents);
  const capabilityHistory = buildProjectCapabilityHistory(projectRoot);
  const previousHistoryEntries = normalizeStoredHistoryEntries(existingChangelog.entries);
  const historyEntries = dedupeHistoryEntries(
    groupedUpdates.concat(previousHistoryEntries, capabilityHistory)
  ).slice(0, MAX_CHANGELOG_ENTRIES);
  const recentUpdates = historyEntries
    .filter((entry) => entry.source !== 'project_snapshot')
    .slice(0, MAX_RECENT_UPDATES)
    .map(toStateUpdate);
  const keyFeatures = promoteFeatures(historyEntries);
  const knownIssues = deriveKnownIssues(projectRoot, metadata.techStack, keyFeatures);
  const nextState = {
    project: metadata.project,
    version: metadata.version,
    last_updated: timestamp,
    ai_summary: '',
    tech_stack: metadata.techStack,
    current_stage: determineCurrentStage(keyFeatures, historyEntries),
    recent_updates: recentUpdates,
    key_features: keyFeatures,
    known_issues: knownIssues,
    next_steps: []
  };

  nextState.ai_summary = generateAiSummary(nextState, historyEntries);
  nextState.next_steps = generateNextSteps(nextState, historyEntries);

  await writeJsonAtomic(contextPaths.stateFile, nextState);
  await writeJsonAtomic(contextPaths.changelogFile, { entries: historyEntries });

  if (logger) {
    logger.debug(`Updated AI context with ${groupedUpdates.length} grouped project intent(s).`);
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
    return 'cli';
  }

  if (lowerPath.startsWith('templates/')) {
    return 'templates';
  }

  return 'project';
}

function describeRootDirectory(filePath) {
  const normalizedPath = normalizeProjectPath(filePath);
  const segments = normalizedPath.split('/');

  if (segments.length === 1) {
    return segments[0] || 'project';
  }

  return segments[0] || 'project';
}

function detectIntentTheme(filePath, area) {
  const lowerPath = filePath.toLowerCase();

  if (lowerPath === 'package.json') {
    return 'package_configuration';
  }

  if (lowerPath === 'readme.md') {
    return 'documentation';
  }

  if (lowerPath.startsWith('bin/')) {
    return 'cli_workflow';
  }

  if (lowerPath.startsWith('server/')) {
    return 'local_context_server';
  }

  if (lowerPath.startsWith('templates/')) {
    return 'context_templates';
  }

  if (lowerPath.includes('gitsync') || lowerPath.includes('sync')) {
    return 'github_sync';
  }

  if (lowerPath.includes('watcher') || lowerPath.includes('watch')) {
    return 'change_tracking';
  }

  if (lowerPath.includes('state') || lowerPath.includes('context')) {
    return 'project_intelligence';
  }

  if (lowerPath.includes('init')) {
    return 'project_setup';
  }

  if (area === 'logic') {
    return 'project_intelligence';
  }

  return 'project_workflow';
}

function createEventDescriptor(event) {
  const normalizedPath = normalizeProjectPath(event.file);

  return {
    timestamp: event.timestamp || new Date().toISOString(),
    action: event.action || 'change',
    file: normalizedPath,
    area: classifyChangeArea(normalizedPath),
    rootDirectory: describeRootDirectory(normalizedPath),
    theme: detectIntentTheme(normalizedPath, classifyChangeArea(normalizedPath))
  };
}

function groupEventsByIntent(events) {
  if (!Array.isArray(events) || events.length === 0) {
    return [];
  }

  const groupedByArea = new Map();

  for (const event of events) {
    const descriptor = createEventDescriptor(event);
    const groupKey = `${descriptor.area}:${descriptor.rootDirectory}`;

    if (!groupedByArea.has(groupKey)) {
      groupedByArea.set(groupKey, {
        area: descriptor.area,
        rootDirectory: descriptor.rootDirectory,
        events: []
      });
    }

    groupedByArea.get(groupKey).events.push(descriptor);
  }

  const mergedGroups = mergeCrossAreaIntentGroups(Array.from(groupedByArea.values()));

  return mergedGroups
    .map((group) => interpretIntentGroup(group))
    .filter(Boolean)
    .sort((left, right) => new Date(right.timestamp) - new Date(left.timestamp));
}

function buildProjectCapabilityHistory(projectRoot) {
  const snapshotTimestamp = new Date(0).toISOString();
  const projectFiles = scanProjectFiles(projectRoot, 2).filter((filePath) => scoreEvent(filePath) >= 2);

  if (projectFiles.length === 0) {
    return [];
  }

  const capabilityBuckets = new Map();

  for (const filePath of projectFiles) {
    const area = classifyChangeArea(filePath);
    const featureKey = detectIntentTheme(filePath, area);

    if (!capabilityBuckets.has(featureKey)) {
      capabilityBuckets.set(featureKey, []);
    }

    capabilityBuckets.get(featureKey).push(filePath);
  }

  return Array.from(capabilityBuckets.entries())
    .map(([featureKey, files]) => createCapabilitySnapshotEntry(featureKey, files.length, snapshotTimestamp))
    .filter(Boolean);
}

function mergeCrossAreaIntentGroups(groups) {
  if (groups.length < 2) {
    return groups;
  }

  const logicGroup = groups.find((group) => group.area === 'logic');
  const backendGroup = groups.find((group) => group.area === 'backend');
  const cliGroup = groups.find((group) => group.area === 'cli');

  if (logicGroup && backendGroup && groups.length <= 3) {
    return mergeSelectedGroups(groups, [logicGroup, backendGroup], 'system');
  }

  if (logicGroup && cliGroup && groups.length <= 3) {
    return mergeSelectedGroups(groups, [logicGroup, cliGroup], 'cli_system');
  }

  return groups;
}

function mergeSelectedGroups(groups, groupsToMerge, mergedArea) {
  const mergeSet = new Set(groupsToMerge);
  const remainingGroups = groups.filter((group) => !mergeSet.has(group));
  const mergedGroup = {
    area: mergedArea,
    rootDirectory: mergedArea,
    events: groupsToMerge.flatMap((group) => group.events)
  };

  remainingGroups.push(mergedGroup);
  return remainingGroups;
}

function interpretIntentGroup(group) {
  if (!group || !Array.isArray(group.events) || group.events.length === 0) {
    return null;
  }

  const latestTimestamp = group.events.reduce((latest, event) => {
    return new Date(event.timestamp) > new Date(latest) ? event.timestamp : latest;
  }, group.events[0].timestamp);
  const featureKey = determineFeatureKey(group);
  const featureMeta = getFeatureMeta(featureKey);
  const type = determineGroupedUpdateType(group);
  const subject = describeIntentSubject(group, featureMeta.subject);

  return {
    timestamp: latestTimestamp,
    scope: describeIntentScope(group),
    title: buildIntentTitle(type, subject),
    type,
    impact: describeIntentImpact(type, featureKey, subject),
    feature_key: featureKey,
    feature_name: featureMeta.name,
    source: 'event'
  };
}

function determineFeatureKey(group) {
  const areas = new Set(group.events.map((event) => event.area));

  if (group.area === 'system' || (areas.has('logic') && areas.has('backend'))) {
    return 'context_delivery_system';
  }

  if (group.area === 'cli_system' || (areas.has('logic') && areas.has('cli'))) {
    return 'cli_orchestration';
  }

  const themeCounts = new Map();

  for (const event of group.events) {
    themeCounts.set(event.theme, (themeCounts.get(event.theme) || 0) + 1);
  }

  return Array.from(themeCounts.entries()).sort((left, right) => {
    if (right[1] !== left[1]) {
      return right[1] - left[1];
    }

    return getFeaturePriority(right[0]) - getFeaturePriority(left[0]);
  })[0][0];
}

function getFeatureMeta(featureKey) {
  return FEATURE_CATALOG[featureKey] || FEATURE_CATALOG.project_workflow;
}

function getFeaturePriority(featureKey) {
  const priorities = {
    project_intelligence: 7,
    github_sync: 6,
    local_context_server: 5,
    change_tracking: 4,
    cli_workflow: 3,
    project_setup: 2,
    project_workflow: 1
  };

  return priorities[featureKey] || 0;
}

function determineGroupedUpdateType(group) {
  const actions = new Set(group.events.map((event) => event.action));
  const fileCount = group.events.length;

  if (actions.has('add')) {
    return 'feature';
  }

  if (hasFixSignals(group.events)) {
    return 'fix';
  }

  if (fileCount > 2 || group.area === 'system' || group.area === 'cli_system') {
    return 'refactor';
  }

  return 'improvement';
}

function hasFixSignals(events) {
  return events.some((event) =>
    /(fix|bug|error|guard|validate|sanitize|safe|stabilize)/i.test(event.file)
  );
}

function describeIntentSubject(group, fallbackSubject) {
  const areas = new Set(group.events.map((event) => event.area));

  if (group.area === 'system' || (areas.has('logic') && areas.has('backend'))) {
    return 'AI context delivery system';
  }

  if (group.area === 'cli_system' || (areas.has('logic') && areas.has('cli'))) {
    return 'CLI workflow';
  }

  if (group.area === 'backend' && group.events.length > 1) {
    return 'AI context delivery service';
  }

  return fallbackSubject || 'project workflow';
}

function describeIntentScope(group) {
  if (group.area === 'system') {
    return 'system';
  }

  if (group.area === 'cli_system') {
    return 'CLI';
  }

  return group.area;
}

function buildIntentTitle(type, subject) {
  const verbs = {
    feature: 'Expanded',
    improvement: 'Improved',
    refactor: 'Refactored',
    fix: 'Stabilized'
  };

  return `${verbs[type] || 'Improved'} ${subject}`;
}

function describeIntentImpact(type, featureKey, subject) {
  const impactByFeature = {
    cli_workflow: 'Improves how developers initialize and manage AI context from the command line.',
    github_sync: 'Improves reliability of publishing AI-readable project context to GitHub.',
    project_intelligence: 'Improves how project progress is summarized for AI systems.',
    change_tracking: 'Improves how meaningful project evolution is detected without noise.',
    local_context_server: 'Improves how AI tools consume project context through local endpoints.',
    context_delivery_system: 'Improves reliability and structure of the end-to-end AI context delivery system.',
    cli_orchestration: 'Improves how CLI actions drive the project intelligence workflow.',
    project_setup: 'Improves first-run setup and configuration clarity for teams adopting AI context.',
    documentation: 'Improves onboarding and usage clarity for developers and AI collaborators.',
    package_configuration: 'Improves package installation and distribution behavior.',
    context_templates: 'Improves the default AI context generated for new projects.',
    project_workflow: 'Improves the overall project workflow for maintaining AI-readable context.'
  };

  if (type === 'feature') {
    return impactByFeature[featureKey]
      .replace(/^Improves /, 'Adds ')
      .replace(/^Improves how /, 'Adds ')
      .replace(/^Improves reliability of /, 'Adds ')
      .replace(/^Improves first-run setup and configuration clarity for teams adopting /, 'Adds ')
      .replace(/^Improves the default AI context generated for /, 'Adds ')
      .replace(/^Improves the overall project workflow for maintaining /, 'Adds ');
  }

  if (type === 'fix') {
    return `Resolves reliability issues in the ${subject.toLowerCase()}.`;
  }

  return impactByFeature[featureKey] || 'Improves the overall project workflow for maintaining AI-readable context.';
}

function interpretChange(event) {
  return groupEventsByIntent([event])[0] || null;
}

function normalizeStoredUpdates(updates) {
  if (!Array.isArray(updates)) {
    return [];
  }

  return dedupeRecentUpdates(updates.map((update) => normalizeStoredUpdate(update)).filter(Boolean));
}

function normalizeStoredUpdate(update) {
  if (!update) {
    return null;
  }

  if (update.title && update.type && update.impact) {
    return {
      title: update.title,
      type: normalizeUpdateType(update.type),
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
    const inferredFeature = inferFeatureFromEntry(entry);
    const featureKey = entry.feature_key || inferredFeature.featureKey;
    const normalizedType = normalizeUpdateType(entry.type);
    const subject = describeCanonicalSubject(featureKey);

    return {
      timestamp: entry.timestamp || new Date(0).toISOString(),
      scope: entry.scope || inferredFeature.scope,
      title: buildIntentTitle(normalizedType, subject),
      type: normalizedType,
      impact: describeIntentImpact(normalizedType, featureKey, subject),
      feature_key: featureKey,
      feature_name: entry.feature_name || getFeatureMeta(featureKey).name,
      source: entry.source || 'history'
    };
  }

  if (entry.file && entry.action && isMeaningfulEvent(entry)) {
    return interpretChange(entry);
  }

  return null;
}

function inferFeatureFromEntry(entry) {
  const combinedText = `${entry.title || ''} ${entry.impact || ''}`.toLowerCase();

  if (combinedText.includes('github') || combinedText.includes('sync')) {
    return {
      featureKey: 'github_sync',
      featureName: getFeatureMeta('github_sync').name,
      scope: 'logic'
    };
  }

  if (combinedText.includes('state') || combinedText.includes('intelligence')) {
    return {
      featureKey: 'project_intelligence',
      featureName: getFeatureMeta('project_intelligence').name,
      scope: 'logic'
    };
  }

  if (combinedText.includes('watch') || combinedText.includes('change tracking')) {
    return {
      featureKey: 'change_tracking',
      featureName: getFeatureMeta('change_tracking').name,
      scope: 'logic'
    };
  }

  if (
    combinedText.includes('server') ||
    combinedText.includes('backend') ||
    combinedText.includes('endpoint') ||
    combinedText.includes('delivery')
  ) {
    return {
      featureKey: 'local_context_server',
      featureName: getFeatureMeta('local_context_server').name,
      scope: 'backend'
    };
  }

  if (combinedText.includes('cli') || combinedText.includes('command line')) {
    return {
      featureKey: 'cli_workflow',
      featureName: getFeatureMeta('cli_workflow').name,
      scope: 'cli'
    };
  }

  if (combinedText.includes('documentation') || combinedText.includes('onboarding')) {
    return {
      featureKey: 'documentation',
      featureName: getFeatureMeta('documentation').name,
      scope: 'documentation'
    };
  }

  if (combinedText.includes('package') || combinedText.includes('dependency')) {
    return {
      featureKey: 'package_configuration',
      featureName: getFeatureMeta('package_configuration').name,
      scope: 'dependencies'
    };
  }

  return {
    featureKey: 'project_workflow',
    featureName: getFeatureMeta('project_workflow').name,
    scope: 'project'
  };
}

function normalizeUpdateType(type) {
  if (type === 'removal') {
    return 'refactor';
  }

  if (type === 'feature' || type === 'improvement' || type === 'refactor' || type === 'fix') {
    return type;
  }

  return 'improvement';
}

function toStateUpdate(update) {
  if (!update) {
    return null;
  }

  return {
    title: update.title,
    type: normalizeUpdateType(update.type),
    impact: update.impact
  };
}

function dedupeRecentUpdates(updates) {
  const seenUpdates = new Set();
  const result = [];

  for (const update of updates.filter(Boolean)) {
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

  for (const entry of entries.filter(Boolean)) {
    const key = `${entry.title}::${entry.type}::${entry.feature_key}`;

    if (seenEntries.has(key)) {
      continue;
    }

    seenEntries.add(key);
    result.push(entry);
  }

  return result.sort((left, right) => new Date(right.timestamp) - new Date(left.timestamp));
}

function promoteFeatures(history) {
  if (!Array.isArray(history) || history.length === 0) {
    return [];
  }

  const featureStats = new Map();

  for (const entry of history) {
    const featureKey = entry.feature_key || inferFeatureFromEntry(entry).featureKey;
    const featureMeta = getFeatureMeta(featureKey);
    const existing = featureStats.get(featureKey) || {
      featureKey,
      featureName: featureMeta.name,
      count: 0,
      score: 0,
      lastTimestamp: new Date(0).toISOString()
    };

    existing.count += 1;
    existing.score += scoreFeatureEntry(entry);
    if (new Date(entry.timestamp) > new Date(existing.lastTimestamp)) {
      existing.lastTimestamp = entry.timestamp;
    }

    featureStats.set(featureKey, existing);
  }

  const rankedFeatures = Array.from(featureStats.values()).sort((left, right) => {
    if (right.count !== left.count) {
      return right.count - left.count;
    }

    if (right.score !== left.score) {
      return right.score - left.score;
    }

    if (getFeaturePriority(right.featureKey) !== getFeaturePriority(left.featureKey)) {
      return getFeaturePriority(right.featureKey) - getFeaturePriority(left.featureKey);
    }

    return new Date(right.lastTimestamp) - new Date(left.lastTimestamp);
  });

  const promoted = [];
  const seenFeatureNames = new Set();

  for (const feature of rankedFeatures.filter((item) => item.count >= 3)) {
    if (LOW_VALUE_FEATURE_KEYS.has(feature.featureKey)) {
      continue;
    }

    promoted.push(feature.featureName);
    seenFeatureNames.add(feature.featureName);
  }

  for (const feature of rankedFeatures) {
    if (promoted.length >= MAX_KEY_FEATURES) {
      break;
    }

    if (LOW_VALUE_FEATURE_KEYS.has(feature.featureKey)) {
      continue;
    }

    if (seenFeatureNames.has(feature.featureName)) {
      continue;
    }

    promoted.push(feature.featureName);
    seenFeatureNames.add(feature.featureName);
  }

  for (const feature of rankedFeatures) {
    if (promoted.length >= MAX_KEY_FEATURES) {
      break;
    }

    if (seenFeatureNames.has(feature.featureName)) {
      continue;
    }

    promoted.push(feature.featureName);
    seenFeatureNames.add(feature.featureName);
  }

  return promoted.slice(0, MAX_KEY_FEATURES);
}

function scoreFeatureEntry(entry) {
  const typeWeights = {
    feature: 4,
    refactor: 3,
    improvement: 2,
    fix: 2
  };

  return typeWeights[normalizeUpdateType(entry.type)] || 1;
}

function describeCanonicalSubject(featureKey) {
  return getFeatureMeta(featureKey).subject;
}

function createCapabilitySnapshotEntry(featureKey, fileCount, timestamp) {
  const subject = describeCanonicalSubject(featureKey);
  const type = fileCount > 2 ? 'refactor' : 'improvement';

  return {
    timestamp,
    scope: inferScopeFromFeature(featureKey),
    title: buildIntentTitle(type, subject),
    type,
    impact: describeIntentImpact(type, featureKey, subject),
    feature_key: featureKey,
    feature_name: getFeatureMeta(featureKey).name,
    source: 'project_snapshot'
  };
}

function inferScopeFromFeature(featureKey) {
  if (
    featureKey === 'github_sync' ||
    featureKey === 'project_intelligence' ||
    featureKey === 'change_tracking' ||
    featureKey === 'project_setup'
  ) {
    return 'logic';
  }

  if (featureKey === 'cli_workflow' || featureKey === 'cli_orchestration') {
    return 'cli';
  }

  if (featureKey === 'local_context_server' || featureKey === 'context_delivery_system') {
    return 'backend';
  }

  if (featureKey === 'package_configuration') {
    return 'dependencies';
  }

  if (featureKey === 'documentation') {
    return 'documentation';
  }

  return 'project';
}

function deriveKnownIssues(projectRoot, techStack, keyFeatures) {
  const knownIssues = [];

  if (!hasTestIndicators(projectRoot)) {
    knownIssues.push('No automated test suite is detected yet.');
  }

  if (!techStack.framework) {
    knownIssues.push('No common application framework dependency is currently detected.');
  }

  if (keyFeatures.length < 2) {
    knownIssues.push('Project intelligence history is still sparse, so AI context may omit mature capabilities.');
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

function determineCurrentStage(keyFeatures, historyEntries) {
  if (keyFeatures.length >= 4 && historyEntries.length >= 4) {
    return 'Production-ready';
  }

  if (keyFeatures.length >= 2 || historyEntries.length >= 2) {
    return 'Functional prototype';
  }

  return 'Early development';
}

function generateAiSummary(state, historyEntries) {
  const featureSignals = collectFeatureSignals(historyEntries, state.key_features);
  const projectType = featureSignals.has('cli_workflow') || featureSignals.has('cli_orchestration')
    ? 'CLI tool'
    : 'project system';
  let coreCapability = 'maintains an AI-readable view of project progress';
  let uniqueValue = 'so AI collaborators can understand the current project state immediately';

  if (featureSignals.has('project_intelligence') && featureSignals.has('change_tracking')) {
    coreCapability = 'turns meaningful project activity into AI-readable context';
  } else if (featureSignals.has('project_intelligence')) {
    coreCapability = 'converts development work into AI-readable project state';
  } else if (featureSignals.has('local_context_server')) {
    coreCapability = 'delivers AI-readable project context through clear endpoints';
  }

  if (
    featureSignals.has('github_sync') ||
    featureSignals.has('context_delivery_system') ||
    featureSignals.has('cli_orchestration')
  ) {
    uniqueValue = 'and enables public AI collaboration through GitHub-synced context endpoints';
  } else if (featureSignals.has('local_context_server')) {
    uniqueValue = 'and keeps current context available through local AI endpoints';
  }

  return `${capitalize(projectType)} that ${coreCapability} ${uniqueValue}.`;
}

function collectFeatureSignals(historyEntries, keyFeatures) {
  const featureSignals = new Set();

  for (const entry of historyEntries) {
    if (entry.feature_key) {
      featureSignals.add(entry.feature_key);
    }
  }

  for (const featureName of keyFeatures || []) {
    for (const [featureKey, featureMeta] of Object.entries(FEATURE_CATALOG)) {
      if (featureMeta.name === featureName) {
        featureSignals.add(featureKey);
      }
    }
  }

  return featureSignals;
}

function generateNextSteps(state, historyEntries) {
  const nextSteps = [];
  const featureSignals = collectFeatureSignals(historyEntries, state.key_features);

  if (state.key_features.length === 0) {
    nextSteps.push('Capture a few meaningful project milestones so stable AI-visible features can emerge from real development history.');
  }

  if (state.known_issues.includes('No automated test suite is detected yet.')) {
    nextSteps.push('Add automated tests for the intelligence engine, watcher, and GitHub sync workflow.');
  }

  if (!featureSignals.has('project_intelligence')) {
    nextSteps.push('Strengthen the intelligence engine so more project-level capabilities are captured automatically.');
  }

  if (!featureSignals.has('local_context_server')) {
    nextSteps.push('Expand context delivery coverage so AI consumers can reliably read current project state.');
  }

  if (!featureSignals.has('github_sync')) {
    nextSteps.push('Validate public sync behavior so AI tools can safely consume the latest project context from GitHub.');
  }

  if (state.current_stage === 'Early development') {
    nextSteps.push('Ship the next core workflow milestone to turn the project into a functional prototype.');
  }

  return Array.from(new Set(nextSteps)).slice(0, 4);
}

function capitalize(value) {
  if (!value) {
    return '';
  }

  return value.charAt(0).toUpperCase() + value.slice(1);
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
  groupEventsByIntent,
  interpretChange,
  loadRuntimeConfig,
  promoteFeatures,
  readJsonFile,
  renderTemplate,
  scoreEvent,
  shouldIgnoreProjectFile,
  updateRuntimeConfig,
  updateProjectState,
  writeJsonAtomic,
  writeTextAtomic
};