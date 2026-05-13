'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const CONTEXT_DIR_NAME = '.ai-context';
const MAX_RECENT_UPDATES = 5;
const MAX_CHANGELOG_ENTRIES = 50;
const MAX_KEY_FEATURES = 6;
const MAX_IMPLEMENTATION_DETAILS = 8;
const IMPORTANT_DIRECTORIES = ['core/', 'server/', 'bin/', 'src/', 'routes/', 'controllers/', 'services/'];
const IMPORTANT_EXTENSIONS = new Set(['.js', '.ts', '.py']);
const IGNORED_DIRECTORY_NAMES = new Set([
  'node_modules',
  '.git',
  '.ai-context',
  'dist',
  'build',
  'coverage',
  '.tmp',
  'logs'
]);
const ANALYSIS_ROOT_FILES = [
  'package.json',
  'app.js',
  'app.ts',
  'index.js',
  'index.ts',
  'main.py',
  'requirements.txt',
  'tsconfig.json'
];
const ANALYSIS_DIRECTORIES = [
  'routes',
  'server',
  'controllers',
  'services',
  'middleware',
  'config',
  'src',
  'core',
  'bin'
];
const FEATURE_CATALOG = {
  ai_context_generation: 'AI-readable project context generation',
  cli_automation: 'Command-line workflow for project setup and automation',
  change_tracking: 'Automatic change tracking with noise filtering',
  public_sync: 'Optional GitHub sync for publishing project context',
  local_context_server: 'HTTP endpoints for accessing current project context',
  rest_api: 'REST-style API surface',
  auth: 'Authenticated workflows secured with JWT',
  persistence: 'MongoDB-backed data persistence',
  realtime: 'Real-time communication channel',
  external_api: 'External service integration',
  middleware: 'Middleware-driven request processing',
  config_management: 'Centralized project configuration management'
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

function resolveProjectRoot(projectRoot) {
  return path.resolve(projectRoot || process.cwd());
}

function getContextPaths(projectRoot) {
  const resolvedRoot = resolveProjectRoot(projectRoot);
  const contextDir = path.join(resolvedRoot, CONTEXT_DIR_NAME);

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

function normalizeProjectPath(filePath) {
  return String(filePath || '').split(path.sep).join('/').replace(/^\.\/+/, '');
}

function isInsideProjectRoot(projectRoot, targetPath) {
  const resolvedRoot = resolveProjectRoot(projectRoot);
  const resolvedTarget = path.resolve(targetPath);
  const relativePath = path.relative(resolvedRoot, resolvedTarget);

  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

function getRootPackageJsonPath(projectRoot) {
  const resolvedRoot = resolveProjectRoot(projectRoot);
  return path.join(resolvedRoot, 'package.json');
}

function readRootPackageJson(projectRoot) {
  const packageJsonPath = getRootPackageJsonPath(projectRoot);

  if (!fs.existsSync(packageJsonPath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  } catch (error) {
    return null;
  }
}

function detectProjectMetadata(projectRoot) {
  const resolvedRoot = resolveProjectRoot(projectRoot);
  const packageJson = readRootPackageJson(resolvedRoot);
  const techStack = detectTechStack(resolvedRoot, packageJson);
  const packageManager = detectPackageManager(resolvedRoot);

  return {
    project: packageJson && packageJson.name ? packageJson.name : path.basename(resolvedRoot),
    version: packageJson && packageJson.version ? packageJson.version : '0.1.0',
    techStack: Object.assign({}, techStack, {
      package_manager: packageManager
    }),
    stackLabel: buildStackLabel(techStack),
    packageManager
  };
}

function detectTechStack(projectRoot, packageJson) {
  const resolvedRoot = resolveProjectRoot(projectRoot);
  const rootPackage = packageJson || readRootPackageJson(resolvedRoot);
  const dependencies = Object.assign(
    {},
    (rootPackage && rootPackage.dependencies) || {},
    (rootPackage && rootPackage.devDependencies) || {}
  );
  const hasPythonMarker = ['pyproject.toml', 'requirements.txt', 'setup.py'].some((marker) =>
    fs.existsSync(path.join(resolvedRoot, marker))
  );
  let language = '';
  let runtime = '';

  if (rootPackage || hasAnyFileExtension(resolvedRoot, ['.js', '.ts', '.mjs', '.cjs'])) {
    language = 'Node.js';
    runtime = 'Node.js';
  } else if (hasPythonMarker || hasAnyFileExtension(resolvedRoot, ['.py'])) {
    language = 'Python';
    runtime = 'Python';
  }

  return {
    language,
    framework: detectFramework(dependencies),
    runtime,
    package_manager: detectPackageManager(resolvedRoot)
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

  if (dependencies.fastify) {
    return 'Fastify';
  }

  if (dependencies.koa) {
    return 'Koa';
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

function detectPackageManager(projectRoot) {
  const resolvedRoot = resolveProjectRoot(projectRoot);

  if (fs.existsSync(path.join(resolvedRoot, 'pnpm-lock.yaml'))) {
    return 'pnpm';
  }

  if (fs.existsSync(path.join(resolvedRoot, 'yarn.lock'))) {
    return 'yarn';
  }

  return 'npm';
}

function scanProjectFiles(projectRoot, maxDepth, options) {
  const resolvedRoot = resolveProjectRoot(projectRoot);
  const settings = Object.assign({ includeDirectories: null }, options);
  const includeDirectories = settings.includeDirectories
    ? new Set(settings.includeDirectories.map((entry) => normalizeProjectPath(entry).toLowerCase()))
    : null;
  const results = [];

  function visit(currentDir, depth) {
    if (depth > maxDepth || !isInsideProjectRoot(resolvedRoot, currentDir)) {
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

      if (!isInsideProjectRoot(resolvedRoot, fullPath)) {
        continue;
      }

      const relativePath = normalizeProjectPath(path.relative(resolvedRoot, fullPath));

      if (entry.isDirectory()) {
        if (shouldIgnoreProjectFile(relativePath)) {
          continue;
        }

        if (includeDirectories && depth === 0 && !includeDirectories.has(relativePath.toLowerCase())) {
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

  visit(resolvedRoot, 0);
  return results;
}

function shouldIgnoreProjectFile(filePath) {
  const normalizedPath = normalizeProjectPath(filePath).toLowerCase();

  if (!normalizedPath) {
    return false;
  }

  const segments = normalizedPath.split('/').filter(Boolean);
  const baseName = segments[segments.length - 1] || '';

  if (segments.some((segment) => IGNORED_DIRECTORY_NAMES.has(segment))) {
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
  let score = 0;

  if (shouldIgnoreProjectFile(normalizedPath)) {
    return -5;
  }

  if (IMPORTANT_DIRECTORIES.some((directory) => lowerPath.startsWith(directory))) {
    score += 3;
  }

  if (IMPORTANT_EXTENSIONS.has(path.extname(lowerPath))) {
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
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(tempFilePath, content, 'utf8');
  await fsp.rename(tempFilePath, filePath);
}

function renderTemplate(template, variables) {
  return Object.entries(variables).reduce((accumulator, [key, value]) => {
    const safeValue = value == null ? '' : String(value);
    return accumulator.split(`{{${key}}}`).join(safeValue);
  }, template);
}

function createDefaultChangelog() {
  return {
    entries: []
  };
}

function createDefaultState(projectRoot) {
  const metadata = detectProjectMetadata(projectRoot);
  const bootstrap = bootstrapProjectAnalysis(projectRoot);
  const state = {
    project: metadata.project,
    version: metadata.version,
    last_updated: new Date(0).toISOString(),
    ai_summary: '',
    tech_stack: bootstrap.techStack,
    architecture_patterns: bootstrap.architecturePatterns,
    implementation_details: bootstrap.implementationDetails,
    current_stage: determineCurrentStage(bootstrap.keyFeatures, [], bootstrap.implementationDetails),
    recent_updates: [],
    key_features: bootstrap.keyFeatures,
    known_issues: deriveKnownIssues(projectRoot, bootstrap),
    next_steps: []
  };

  state.ai_summary = generateAiSummary(state, bootstrap);
  state.next_steps = generateNextSteps(state, bootstrap, []);

  return state;
}

function bootstrapProjectAnalysis(projectRoot) {
  const resolvedRoot = resolveProjectRoot(projectRoot);
  const metadata = detectProjectMetadata(resolvedRoot);
  const rootPackage = readRootPackageJson(resolvedRoot);
  const techStack = metadata.techStack;
  const analysisInputs = collectAnalysisInputs(resolvedRoot);
  const implementationSignals = detectImplementationSignals(analysisInputs, rootPackage, techStack);
  const architecturePatterns = buildArchitecturePatterns(
    implementationSignals,
    analysisInputs,
    techStack,
    rootPackage
  );
  const implementationDetails = buildImplementationDetails(implementationSignals, techStack);
  const keyFeatures = buildKeyFeatures(implementationSignals, techStack);
  const projectType = determineProjectType(implementationSignals, techStack, rootPackage);

  return {
    projectType,
    techStack,
    architecturePatterns,
    implementationDetails,
    keyFeatures,
    signals: implementationSignals
  };
}

function collectAnalysisInputs(projectRoot) {
  const resolvedRoot = resolveProjectRoot(projectRoot);
  const selectedFiles = new Set();

  for (const relativeFile of ANALYSIS_ROOT_FILES) {
    const absoluteFile = path.join(resolvedRoot, relativeFile);

    if (fs.existsSync(absoluteFile) && isInsideProjectRoot(resolvedRoot, absoluteFile)) {
      selectedFiles.add(relativeFile);
    }
  }

  const discoveredFiles = scanProjectFiles(resolvedRoot, 4, {
    includeDirectories: ANALYSIS_DIRECTORIES
  });

  for (const relativeFile of discoveredFiles) {
    selectedFiles.add(relativeFile);
  }

  return Array.from(selectedFiles)
    .sort()
    .map((relativeFile) => {
      const absoluteFile = path.join(resolvedRoot, relativeFile);

      try {
        const content = fs.readFileSync(absoluteFile, 'utf8');
        return {
          path: relativeFile,
          content: content.slice(0, 50000)
        };
      } catch (error) {
        return null;
      }
    })
    .filter(Boolean);
}

function detectImplementationSignals(analysisInputs, rootPackage, techStack) {
  const dependencyNames = new Set([
    ...Object.keys((rootPackage && rootPackage.dependencies) || {}),
    ...Object.keys((rootPackage && rootPackage.devDependencies) || {})
  ]);
  const runtimeInputs = analysisInputs.filter((input) => isRuntimeImplementationFile(input.path));
  const automationInputs = analysisInputs.filter((input) => isAutomationImplementationFile(input.path));
  const runtimeContent = runtimeInputs.map((input) => input.content).join('\n');
  const automationContent = automationInputs.map((input) => input.content).join('\n');
  const allContent = analysisInputs.map((input) => input.content).join('\n');
  const hasDirectory = (directoryName) =>
    analysisInputs.some((input) => normalizeProjectPath(input.path).startsWith(`${directoryName}/`));
  const hasRuntimePattern = (pattern) => pattern.test(runtimeContent);
  const hasAutomationPattern = (pattern) => pattern.test(automationContent);
  const hasAnyPattern = (pattern) => pattern.test(allContent);

  return {
    hasPackageJson: Boolean(rootPackage),
    hasCliEntry:
      Boolean(rootPackage && rootPackage.bin && Object.keys(rootPackage.bin).length > 0) ||
      hasAutomationPattern(/^#!\/usr\/bin\/env node/m) ||
      hasAutomationPattern(/\bprocess\.argv\b/),
    hasExpress:
      dependencyNames.has('express') ||
      hasRuntimePattern(/\brequire\(['"]express['"]\)/) ||
      hasRuntimePattern(/\bfrom ['"]express['"]/) ||
      hasRuntimePattern(/\bexpress\(\)/),
    hasNext: dependencyNames.has('next'),
    hasReact: dependencyNames.has('react'),
    hasFastify: dependencyNames.has('fastify'),
    hasKoa: dependencyNames.has('koa'),
    hasRestRoutes: hasRuntimePattern(/\b(router|app)\.(get|post|put|patch|delete)\s*\(/),
    hasMiddleware: hasRuntimePattern(/\bapp\.use\s*\(/) || hasDirectory('middleware'),
    hasJwt:
      dependencyNames.has('jsonwebtoken') ||
      hasRuntimePattern(/\bjwt\.(sign|verify)\s*\(/) ||
      hasRuntimePattern(/\brequire\(['"]jsonwebtoken['"]\)/),
    hasMongoose:
      dependencyNames.has('mongoose') ||
      hasRuntimePattern(/\bmongoose\.connect\s*\(/) ||
      hasRuntimePattern(/\brequire\(['"]mongoose['"]\)/),
    hasSocketIO:
      dependencyNames.has('socket.io') ||
      hasRuntimePattern(/\bsocket\.io\b/) ||
      hasRuntimePattern(/\brequire\(['"]socket\.io['"]\)/),
    hasAxiosOrFetch:
      dependencyNames.has('axios') ||
      hasRuntimePattern(/\baxios\./) ||
      hasRuntimePattern(/\bfetch\s*\(/),
    hasWatcher:
      dependencyNames.has('chokidar') ||
      hasAutomationPattern(/\bchokidar\.watch\s*\(/) ||
      hasAutomationPattern(/\bfs\.watch\s*\(/),
    hasGitAutomation:
      hasAutomationPattern(/\bgit\s+(add|commit|push)\b/) ||
      hasAutomationPattern(/\b(syncContextToGit|linkGithubRepository)\b/),
    hasAiContextArtifacts:
      hasAutomationPattern(/\bstate\.json\b/) ||
      hasAutomationPattern(/\bbrain\.txt\b/) ||
      hasAutomationPattern(/\bcontext\.md\b/) ||
      hasAutomationPattern(/\bchangelog\.json\b/),
    hasControllers: hasDirectory('controllers'),
    hasServices: hasDirectory('services'),
    hasRoutes: hasDirectory('routes'),
    hasServerDirectory: hasDirectory('server'),
    hasConfigDirectory: hasDirectory('config'),
    hasTypeScriptConfig: analysisInputs.some((input) => input.path === 'tsconfig.json'),
    hasPythonRequirements: analysisInputs.some((input) => input.path === 'requirements.txt'),
    hasNodeRuntime: techStack.language === 'Node.js',
    hasPythonRuntime: techStack.language === 'Python',
    hasApplicationEntries: runtimeInputs.length > 0,
    hasAnyContent: hasAnyPattern(/\S/)
  };
}

function isRuntimeImplementationFile(relativePath) {
  const normalizedPath = normalizeProjectPath(relativePath).toLowerCase();

  return (
    normalizedPath.startsWith('routes/') ||
    normalizedPath.startsWith('server/') ||
    normalizedPath.startsWith('controllers/') ||
    normalizedPath.startsWith('services/') ||
    normalizedPath.startsWith('middleware/') ||
    normalizedPath.startsWith('config/') ||
    normalizedPath.startsWith('src/') ||
    normalizedPath === 'app.js' ||
    normalizedPath === 'app.ts' ||
    normalizedPath === 'index.js' ||
    normalizedPath === 'index.ts' ||
    normalizedPath === 'main.py'
  );
}

function isAutomationImplementationFile(relativePath) {
  const normalizedPath = normalizeProjectPath(relativePath).toLowerCase();

  return (
    normalizedPath.startsWith('core/') ||
    normalizedPath.startsWith('bin/') ||
    normalizedPath === 'package.json' ||
    normalizedPath === 'index.js' ||
    normalizedPath === 'index.ts'
  );
}

function buildArchitecturePatterns(signals, analysisInputs, techStack, rootPackage) {
  const patterns = [];

  if (signals.hasCliEntry) {
    patterns.push('Command-line automation workflow');
  }

  if (signals.hasWatcher) {
    patterns.push('Event-driven file watching pipeline');
  }

  if (signals.hasExpress && signals.hasRestRoutes) {
    patterns.push('REST API architecture');
  }

  if (signals.hasMiddleware) {
    patterns.push('Middleware-driven request pipeline');
  }

  if (signals.hasControllers && signals.hasServices) {
    patterns.push('Layered controller-service architecture');
  }

  if (signals.hasServerDirectory && signals.hasRoutes) {
    patterns.push('Separated server bootstrap and route handling');
  }

  if (signals.hasConfigDirectory) {
    patterns.push('Centralized configuration layer');
  }

  if (signals.hasSocketIO) {
    patterns.push('Real-time event architecture');
  }

  if (signals.hasNext) {
    patterns.push('Framework-driven web application structure');
  } else if (signals.hasReact) {
    patterns.push('Component-based frontend architecture');
  }

  if (
    signals.hasAiContextArtifacts &&
    signals.hasExpress &&
    analysisInputs.some((input) => /\bstate\.json\b|\bbrain\.txt\b|\bcontext\.md\b/.test(input.content))
  ) {
    patterns.push('Structured AI context delivery workflow');
  }

  if (rootPackage && Array.isArray(rootPackage.keywords) && rootPackage.keywords.includes('cli')) {
    patterns.push('Package-distributed CLI architecture');
  }

  return uniqueNonEmpty(patterns).slice(0, 6);
}

function buildImplementationDetails(signals, techStack) {
  const details = [];

  if (signals.hasJwt) {
    details.push('JWT-based authentication system');
  }

  if (signals.hasMongoose) {
    details.push('MongoDB integration through Mongoose ORM');
  }

  if (signals.hasExpress && signals.hasRestRoutes) {
    details.push('REST API architecture using Express routing');
  }

  if (signals.hasMiddleware) {
    details.push('Express middleware pipeline for request handling');
  }

  if (signals.hasSocketIO) {
    details.push('Socket.IO-based real-time communication');
  }

  if (signals.hasAxiosOrFetch) {
    details.push('External API integration for outbound service calls');
  }

  if (signals.hasWatcher) {
    details.push('File system monitoring for automatic project state updates');
  }

  if (signals.hasAiContextArtifacts) {
    details.push('Structured AI context generation across JSON, Markdown, and instruction files');
  }

  if (signals.hasGitAutomation) {
    details.push('Git-backed synchronization workflow for publishing project state');
  }

  if (signals.hasCliEntry && techStack.language === 'Node.js') {
    details.push('Node.js CLI entrypoint for developer-facing automation');
  }

  return uniqueNonEmpty(details).slice(0, MAX_IMPLEMENTATION_DETAILS);
}

function buildKeyFeatures(signals, techStack) {
  const features = [];

  if (signals.hasAiContextArtifacts) {
    features.push(FEATURE_CATALOG.ai_context_generation);
  }

  if (signals.hasCliEntry) {
    features.push(FEATURE_CATALOG.cli_automation);
  }

  if (signals.hasWatcher) {
    features.push(FEATURE_CATALOG.change_tracking);
  }

  if (signals.hasGitAutomation) {
    features.push(FEATURE_CATALOG.public_sync);
  }

  if (signals.hasExpress && signals.hasAiContextArtifacts) {
    features.push(FEATURE_CATALOG.local_context_server);
  } else if (signals.hasExpress && signals.hasRestRoutes) {
    features.push(FEATURE_CATALOG.rest_api);
  }

  if (signals.hasJwt) {
    features.push(FEATURE_CATALOG.auth);
  }

  if (signals.hasMongoose) {
    features.push(FEATURE_CATALOG.persistence);
  }

  if (signals.hasSocketIO) {
    features.push(FEATURE_CATALOG.realtime);
  }

  if (signals.hasAxiosOrFetch) {
    features.push(FEATURE_CATALOG.external_api);
  }

  if (signals.hasMiddleware) {
    features.push(FEATURE_CATALOG.middleware);
  }

  if (signals.hasConfigDirectory) {
    features.push(FEATURE_CATALOG.config_management);
  }

  if (features.length === 0 && techStack.language) {
    features.push(`${techStack.language} project structure with detectable application entry points`);
  }

  return uniqueNonEmpty(features).slice(0, MAX_KEY_FEATURES);
}

function determineProjectType(signals, techStack, rootPackage) {
  if (signals.hasNext) {
    return 'Next.js application';
  }

  if (signals.hasCliEntry && signals.hasAiContextArtifacts) {
    return 'CLI tool';
  }

  if (signals.hasExpress && signals.hasRestRoutes) {
    return 'backend API platform';
  }

  if (signals.hasReact) {
    return 'frontend application';
  }

  if (signals.hasPythonRuntime) {
    return 'Python application';
  }

  if (rootPackage && rootPackage.bin) {
    return 'CLI tool';
  }

  if (techStack.language === 'Node.js') {
    return 'Node.js application';
  }

  return 'software project';
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
  const resolvedRoot = resolveProjectRoot(projectRoot);
  const contextPaths = getContextPaths(resolvedRoot);
  const metadata = detectProjectMetadata(resolvedRoot);
  const bootstrap = bootstrapProjectAnalysis(resolvedRoot);
  const existingState = await readJsonFile(contextPaths.stateFile, createDefaultState(resolvedRoot));
  const existingChangelog = await readJsonFile(
    contextPaths.changelogFile,
    createDefaultChangelog()
  );
  const normalizedEvents = Array.isArray(changeEvent) ? changeEvent : [changeEvent];
  const validEvents = normalizedEvents.filter(Boolean);
  const timestamp = determineUpdateTimestamp(validEvents);
  const meaningfulEvents = collapseEventsByFile(validEvents.filter((event) => isMeaningfulEvent(event)));
  const groupedUpdates = groupEventsByIntent(meaningfulEvents, bootstrap);
  const previousHistoryEntries = normalizeStoredHistoryEntries(existingChangelog.entries);
  const historyEntries = dedupeHistoryEntries(groupedUpdates.concat(previousHistoryEntries))
    .slice(0, MAX_CHANGELOG_ENTRIES);
  const promotedFeatures = promoteFeatures(historyEntries);
  const keyFeatures = mergeKeyFeatures(bootstrap.keyFeatures, promotedFeatures);
  const recentUpdates = groupedUpdates.length > 0
    ? dedupeRecentUpdates(groupedUpdates.map(toStateUpdate).concat(normalizeStoredUpdates(existingState.recent_updates)))
        .slice(0, MAX_RECENT_UPDATES)
    : normalizeStoredUpdates(existingState.recent_updates).slice(0, MAX_RECENT_UPDATES);
  const nextState = {
    project: metadata.project,
    version: metadata.version,
    last_updated: timestamp,
    ai_summary: '',
    tech_stack: bootstrap.techStack,
    architecture_patterns: bootstrap.architecturePatterns,
    implementation_details: bootstrap.implementationDetails,
    current_stage: determineCurrentStage(keyFeatures, historyEntries, bootstrap.implementationDetails),
    recent_updates: recentUpdates,
    key_features: keyFeatures,
    known_issues: deriveKnownIssues(resolvedRoot, bootstrap),
    next_steps: []
  };

  nextState.ai_summary = generateAiSummary(nextState, bootstrap);
  nextState.next_steps = generateNextSteps(nextState, bootstrap, historyEntries);

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

function determineUpdateTimestamp(events) {
  if (!Array.isArray(events) || events.length === 0) {
    return new Date().toISOString();
  }

  const latestEvent = events[events.length - 1];
  return latestEvent.timestamp || new Date().toISOString();
}

function classifyChangeArea(filePath) {
  const lowerPath = normalizeProjectPath(filePath).toLowerCase();

  if (lowerPath === 'package.json') {
    return 'configuration';
  }

  if (lowerPath === 'readme.md') {
    return 'documentation';
  }

  if (lowerPath.startsWith('bin/')) {
    return 'cli';
  }

  if (lowerPath.startsWith('server/') || lowerPath.startsWith('routes/')) {
    return 'backend';
  }

  if (
    lowerPath.startsWith('controllers/') ||
    lowerPath.startsWith('services/') ||
    lowerPath.startsWith('middleware/') ||
    lowerPath.startsWith('config/')
  ) {
    return 'application';
  }

  if (lowerPath.startsWith('core/') || lowerPath.startsWith('src/')) {
    return 'logic';
  }

  return 'project';
}

function detectEventFeatureKey(filePath, bootstrap) {
  const lowerPath = normalizeProjectPath(filePath).toLowerCase();
  const signals = bootstrap.signals;

  if (lowerPath === 'package.json') {
    if (signals.hasGitAutomation) {
      return 'public_sync';
    }

    if (signals.hasCliEntry) {
      return 'cli_automation';
    }

    return 'config_management';
  }

  if (lowerPath.startsWith('bin/')) {
    return 'cli_automation';
  }

  if (lowerPath.startsWith('server/') || lowerPath.startsWith('routes/')) {
    if (signals.hasAiContextArtifacts) {
      return 'local_context_server';
    }

    return 'rest_api';
  }

  if (lowerPath.includes('gitsync') || lowerPath.includes('sync')) {
    return 'public_sync';
  }

  if (lowerPath.includes('watch')) {
    return 'change_tracking';
  }

  if (lowerPath.includes('state') || lowerPath.includes('context')) {
    return 'ai_context_generation';
  }

  if (lowerPath.includes('auth') || lowerPath.includes('jwt')) {
    return 'auth';
  }

  if (lowerPath.includes('service') || lowerPath.includes('controller')) {
    return signals.hasAxiosOrFetch ? 'external_api' : 'rest_api';
  }

  return 'ai_context_generation';
}

function groupEventsByIntent(events, bootstrap) {
  if (!Array.isArray(events) || events.length === 0) {
    return [];
  }

  const buckets = new Map();

  for (const event of events) {
    const area = classifyChangeArea(event.file);
    const featureKey = detectEventFeatureKey(event.file, bootstrap);
    const key = `${area}:${featureKey}`;

    if (!buckets.has(key)) {
      buckets.set(key, []);
    }

    buckets.get(key).push(
      Object.assign({}, event, {
        area,
        featureKey
      })
    );
  }

  return Array.from(buckets.values())
    .map((group) => interpretIntentGroup(group))
    .filter(Boolean)
    .sort((left, right) => new Date(right.timestamp) - new Date(left.timestamp));
}

function interpretIntentGroup(group) {
  const latestTimestamp = group.reduce((latest, event) => {
    return new Date(event.timestamp) > new Date(latest) ? event.timestamp : latest;
  }, group[0].timestamp || new Date().toISOString());
  const featureKey = group[0].featureKey;
  const area = group[0].area;
  const type = determineGroupedUpdateType(group);
  const subject = describeIntentSubject(featureKey);

  return {
    timestamp: latestTimestamp,
    scope: area,
    title: buildIntentTitle(type, subject),
    type,
    impact: describeIntentImpact(type, featureKey),
    feature_key: featureKey,
    feature_name: FEATURE_CATALOG[featureKey] || subject
  };
}

function determineGroupedUpdateType(group) {
  const hasAdd = group.some((event) => event.action === 'add');
  const hasDelete = group.some((event) => event.action === 'delete');

  if (hasAdd) {
    return 'feature';
  }

  if (hasDelete) {
    return 'fix';
  }

  if (group.length > 2) {
    return 'refactor';
  }

  return 'improvement';
}

function describeIntentSubject(featureKey) {
  const subjectMap = {
    ai_context_generation: 'AI context generation workflow',
    cli_automation: 'CLI automation workflow',
    change_tracking: 'change tracking workflow',
    public_sync: 'GitHub sync workflow',
    local_context_server: 'context delivery service',
    rest_api: 'API architecture',
    auth: 'authentication workflow',
    persistence: 'data persistence layer',
    realtime: 'real-time communication layer',
    external_api: 'external integration workflow',
    middleware: 'request processing workflow',
    config_management: 'project configuration workflow'
  };

  return subjectMap[featureKey] || 'project workflow';
}

function buildIntentTitle(type, subject) {
  const verbs = {
    feature: 'Expanded',
    improvement: 'Improved',
    refactor: 'Refined',
    fix: 'Stabilized'
  };

  return `${verbs[type] || 'Improved'} ${subject}`;
}

function describeIntentImpact(type, featureKey) {
  const impactMap = {
    ai_context_generation: 'Improves the quality of generated AI-readable project context.',
    cli_automation: 'Improves how developers control the project workflow from the command line.',
    change_tracking: 'Improves how meaningful project changes are detected without noise.',
    public_sync: 'Improves how project state is published for external AI consumption.',
    local_context_server: 'Improves how current project context is delivered over HTTP endpoints.',
    rest_api: 'Improves the structure and clarity of the project API surface.',
    auth: 'Improves authentication reliability and access control.',
    persistence: 'Improves how project data is persisted and retrieved.',
    realtime: 'Improves real-time communication behavior.',
    external_api: 'Improves outbound integration reliability.',
    middleware: 'Improves request handling and middleware orchestration.',
    config_management: 'Improves project configuration and packaging reliability.'
  };

  if (type === 'fix') {
    return impactMap[featureKey].replace(/^Improves /, 'Resolves issues in ');
  }

  if (type === 'feature') {
    return impactMap[featureKey].replace(/^Improves /, 'Adds ');
  }

  return impactMap[featureKey] || 'Improves the overall project workflow.';
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
      type: normalizeUpdateType(update.type),
      impact: update.impact
    };
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
      scope: entry.scope || 'project',
      title: entry.title,
      type: normalizeUpdateType(entry.type),
      impact: entry.impact,
      feature_key: entry.feature_key || inferFeatureKeyFromText(entry.title, entry.impact),
      feature_name: entry.feature_name || FEATURE_CATALOG[inferFeatureKeyFromText(entry.title, entry.impact)] || 'Project capability'
    };
  }

  return null;
}

function inferFeatureKeyFromText(title, impact) {
  const combinedText = `${title || ''} ${impact || ''}`.toLowerCase();

  if (combinedText.includes('jwt') || combinedText.includes('auth')) {
    return 'auth';
  }

  if (combinedText.includes('mongo') || combinedText.includes('mongoose') || combinedText.includes('persist')) {
    return 'persistence';
  }

  if (combinedText.includes('real-time') || combinedText.includes('socket')) {
    return 'realtime';
  }

  if (combinedText.includes('api') || combinedText.includes('route')) {
    return 'rest_api';
  }

  if (combinedText.includes('git') || combinedText.includes('publish') || combinedText.includes('sync')) {
    return 'public_sync';
  }

  if (combinedText.includes('watch') || combinedText.includes('change')) {
    return 'change_tracking';
  }

  if (combinedText.includes('command line') || combinedText.includes('cli')) {
    return 'cli_automation';
  }

  if (combinedText.includes('http') || combinedText.includes('context delivery')) {
    return 'local_context_server';
  }

  return 'ai_context_generation';
}

function normalizeUpdateType(type) {
  if (type === 'feature' || type === 'improvement' || type === 'refactor' || type === 'fix') {
    return type;
  }

  if (type === 'removal') {
    return 'fix';
  }

  return 'improvement';
}

function toStateUpdate(update) {
  return {
    title: update.title,
    type: normalizeUpdateType(update.type),
    impact: update.impact
  };
}

function dedupeRecentUpdates(updates) {
  const seen = new Set();
  const result = [];

  for (const update of updates.filter(Boolean)) {
    const key = `${update.title}::${update.type}::${update.impact}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(update);
  }

  return result;
}

function dedupeHistoryEntries(entries) {
  const seen = new Set();
  const result = [];

  for (const entry of entries.filter(Boolean)) {
    const key = `${entry.title}::${entry.type}::${entry.feature_key}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(entry);
  }

  return result.sort((left, right) => new Date(right.timestamp) - new Date(left.timestamp));
}

function promoteFeatures(historyEntries) {
  if (!Array.isArray(historyEntries) || historyEntries.length === 0) {
    return [];
  }

  const scores = new Map();

  for (const entry of historyEntries) {
    const featureName = entry.feature_name || FEATURE_CATALOG[entry.feature_key];

    if (!featureName) {
      continue;
    }

    scores.set(featureName, (scores.get(featureName) || 0) + scoreHistoryEntry(entry));
  }

  return Array.from(scores.entries())
    .sort((left, right) => right[1] - left[1])
    .map(([featureName]) => featureName)
    .slice(0, MAX_KEY_FEATURES);
}

function scoreHistoryEntry(entry) {
  const weights = {
    feature: 4,
    refactor: 3,
    improvement: 2,
    fix: 2
  };

  return weights[normalizeUpdateType(entry.type)] || 1;
}

function mergeKeyFeatures(primaryFeatures, promotedFeatures) {
  return uniqueNonEmpty([].concat(primaryFeatures || [], promotedFeatures || [])).slice(0, MAX_KEY_FEATURES);
}

function deriveKnownIssues(projectRoot, bootstrap) {
  const knownIssues = [];

  if (!hasTestIndicators(projectRoot)) {
    knownIssues.push('No automated test suite is detected yet.');
  }

  if (bootstrap.implementationDetails.length === 0) {
    knownIssues.push('Project structure exposes limited implementation signals, so deeper architecture details may still be missing.');
  }

  if (!bootstrap.techStack.framework && bootstrap.techStack.language === 'Node.js') {
    knownIssues.push('No common Node.js application framework dependency is currently detected.');
  }

  return knownIssues;
}

function hasTestIndicators(projectRoot) {
  const resolvedRoot = resolveProjectRoot(projectRoot);
  const testPaths = [
    'test',
    'tests',
    '__tests__',
    'vitest.config.js',
    'jest.config.js',
    'jest.config.cjs',
    'jest.config.mjs'
  ];

  return testPaths.some((relativePath) => fs.existsSync(path.join(resolvedRoot, relativePath)));
}

function determineCurrentStage(keyFeatures, historyEntries, implementationDetails) {
  if (keyFeatures.length >= 4 && implementationDetails.length >= 3) {
    return 'Production-ready';
  }

  if (keyFeatures.length >= 2 || historyEntries.length >= 2) {
    return 'Functional prototype';
  }

  return 'Early development';
}

function generateAiSummary(state, bootstrap) {
  const features = state.key_features || [];
  const details = bootstrap.implementationDetails || [];
  const projectType = bootstrap.projectType || 'software project';
  const normalizedType = projectType === 'backend API platform'
    ? 'Backend API platform'
    : capitalize(projectType);

  if (details.some((detail) => detail.includes('JWT')) && details.some((detail) => detail.includes('MongoDB'))) {
    return `${normalizedType} with JWT authentication and MongoDB-backed application logic.`;
  }

  if (
    features.includes(FEATURE_CATALOG.ai_context_generation) &&
    features.includes(FEATURE_CATALOG.public_sync)
  ) {
    return `${normalizedType} that generates AI-readable project context, tracks meaningful changes, and can publish public project state through GitHub.`;
  }

  if (
    features.includes(FEATURE_CATALOG.rest_api) &&
    details.some((detail) => detail.includes('Express'))
  ) {
    return `${normalizedType} with RESTful request handling and structured server-side workflow orchestration.`;
  }

  if (features.length >= 2) {
    return `${normalizedType} focused on ${features.slice(0, 2).join(' and ').toLowerCase()}.`;
  }

  if (details.length > 0) {
    return `${normalizedType} built around ${details[0].toLowerCase()}.`;
  }

  return `${normalizedType} with detectable project structure and implementation patterns.`;
}

function generateNextSteps(state, bootstrap, historyEntries) {
  const nextSteps = [];

  if (state.known_issues.includes('No automated test suite is detected yet.')) {
    nextSteps.push('Add automated tests that cover the main application flow and critical integration points.');
  }

  if (bootstrap.implementationDetails.length < 2) {
    nextSteps.push('Strengthen the project structure so major implementation patterns are easier to detect automatically.');
  }

  if (historyEntries.length === 0) {
    nextSteps.push('Capture the next meaningful project update so recent evolution is reflected alongside the bootstrap analysis.');
  }

  if (state.current_stage === 'Early development') {
    nextSteps.push('Ship the next core capability to move the project from initial structure into a functional prototype.');
  }

  return Array.from(new Set(nextSteps)).slice(0, 4);
}

function uniqueNonEmpty(values) {
  return Array.from(new Set((values || []).filter(Boolean)));
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
  bootstrapProjectAnalysis,
  createDebouncedStateUpdater,
  createDefaultChangelog,
  createDefaultState,
  detectProjectMetadata,
  ensureContextDirectory,
  getContextPaths,
  groupEventsByIntent,
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
