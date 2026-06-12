'use strict';

const fs   = require('fs');
const fsp  = require('fs/promises');
const path = require('path');

const { diffTexts, extractCodeSignals } = require('./codeDiff');
const { buildCodeFileCatalogue, getSnapshot, readCurrentContent } = require('./fileSnapshot');
const { scanCodeNotes, buildDependencyGraph, buildSetupGuide } = require('./codeIntel');
const { generateBriefing } = require('./briefingGenerator');

// ─────────────────────────────────────────────────────────────────
//  Constants
// ─────────────────────────────────────────────────────────────────

const CONTEXT_DIR_NAME        = '.ai-context';
const MAX_RECENT_UPDATES      = 15;
const MAX_CHANGELOG_ENTRIES   = 200;
const MAX_KEY_FEATURES        = 12;
const MAX_IMPL_DETAILS        = 15;
const MAX_TREE_DEPTH          = 6;
const MAX_RESOLVED_ISSUES     = 50;
const MAX_ACTIVE_ERRORS       = 30;
const MAX_CODE_CHANGE_HISTORY = 100;

const IMPORTANT_DIRS = new Set([
  'core','server','bin','src','routes','controllers',
  'services','middleware','lib','utils','api','helpers'
]);
const CODE_EXTENSIONS = new Set(['.js','.ts','.mjs','.cjs','.jsx','.tsx','.py','.go','.rs','.java','.rb','.php','.cs','.swift']);
const IGNORED_DIRS    = new Set([
  'node_modules','.git','.ai-context','dist','build',
  'coverage','.tmp','logs','.cache','out','.next','.nuxt','__pycache__'
]);

const DEFAULT_CONFIG = {
  port: 3333,
  debounceMs: 600,
  gitSync: {
    enabled: false, push: true,
    commitMessage: 'auto: update AI context',
    remote: 'origin', branch: 'main', repoUrl: ''
  }
};

// ─────────────────────────────────────────────────────────────────
//  Path helpers
// ─────────────────────────────────────────────────────────────────

function resolveRoot(projectRoot) { return path.resolve(projectRoot || process.cwd()); }

function getContextPaths(projectRoot) {
  const root       = resolveRoot(projectRoot);
  const contextDir = path.join(root, CONTEXT_DIR_NAME);
  return {
    contextDir,
    stateFile:     path.join(contextDir, 'state.json'),
    brainFile:     path.join(contextDir, 'brain.txt'),
    contextFile:   path.join(contextDir, 'context.md'),
    changelogFile: path.join(contextDir, 'changelog.json'),
    configFile:    path.join(contextDir, 'config.json'),
    briefingFile:  path.join(contextDir, 'briefing.md')
  };
}

// ─────────────────────────────────────────────────────────────────
//  Utilities
// ─────────────────────────────────────────────────────────────────

function isObj(v)  { return Boolean(v) && typeof v === 'object' && !Array.isArray(v); }
function uniq(arr) { return Array.from(new Set((arr || []).filter(Boolean))); }
function cap(s)    { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }

function deepMerge(base, override) {
  if (Array.isArray(base) || Array.isArray(override)) return override === undefined ? base : override;
  if (isObj(base) && isObj(override)) {
    const out = Object.assign({}, base);
    for (const [k, v] of Object.entries(override)) out[k] = deepMerge(base[k], v);
    return out;
  }
  return override === undefined ? base : override;
}

function normPath(p) { return String(p || '').split(path.sep).join('/').replace(/^\.\/+/, ''); }

function insideRoot(root, target) {
  const rel = path.relative(path.resolve(root), path.resolve(target));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

// ─────────────────────────────────────────────────────────────────
//  Ignore / score
// ─────────────────────────────────────────────────────────────────

function shouldIgnoreProjectFile(filePath) {
  const p    = normPath(filePath).toLowerCase();
  if (!p)    return false;
  const segs = p.split('/').filter(Boolean);
  const base = segs[segs.length - 1] || '';
  if (segs.some((s) => IGNORED_DIRS.has(s)))      return true;
  if (base.startsWith('.'))                        return true;
  if (/\.(log|tmp|lock|pyc|pyo)$/.test(base))              return true;
  if (base === 'package-lock.json' || base === 'yarn.lock' || base === 'pnpm-lock.yaml') return true;
  return false;
}

function scoreEvent(filePath) {
  const p = normPath(filePath).toLowerCase();
  if (shouldIgnoreProjectFile(p)) return -5;
  let score = 0;
  const firstSeg = p.split('/')[0];
  if (IMPORTANT_DIRS.has(firstSeg))                score += 3;
  if (CODE_EXTENSIONS.has(path.extname(p)))         score += 2;
  if (p === 'package.json' || p === 'readme.md')    score += 2;
  return score;
}

// ─────────────────────────────────────────────────────────────────
//  File scanning
// ─────────────────────────────────────────────────────────────────

function scanFiles(projectRoot, maxDepth) {
  const root    = resolveRoot(projectRoot);
  const results = [];
  function visit(dir, depth) {
    if (depth > maxDepth) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (!insideRoot(root, full)) continue;
      const rel  = normPath(path.relative(root, full));
      if (shouldIgnoreProjectFile(rel)) continue;
      if (e.isDirectory()) { visit(full, depth + 1); continue; }
      results.push(rel);
    }
  }
  visit(root, 0);
  return results;
}

function buildFileTree(projectRoot) {
  const root = resolveRoot(projectRoot);
  function visit(dir, depth) {
    const node = {};
    if (depth > MAX_TREE_DEPTH) return node;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return node; }
    const dirs  = entries.filter((e) => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name));
    const files = entries.filter((e) => !e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name));
    for (const d of dirs) {
      const full = path.join(dir, d.name);
      const rel  = normPath(path.relative(root, full));
      if (!insideRoot(root, full) || shouldIgnoreProjectFile(rel)) continue;
      node[d.name] = visit(full, depth + 1);
    }
    for (const f of files) {
      const full = path.join(dir, f.name);
      const rel  = normPath(path.relative(root, full));
      if (!insideRoot(root, full) || shouldIgnoreProjectFile(rel)) continue;
      node[f.name] = null;
    }
    return node;
  }
  return visit(root, 0);
}

// ─────────────────────────────────────────────────────────────────
//  Package.json / metadata
// ─────────────────────────────────────────────────────────────────

function readPkg(projectRoot) {
  try { return JSON.parse(fs.readFileSync(path.join(resolveRoot(projectRoot), 'package.json'), 'utf8')); }
  catch (_) { return null; }
}

function detectProjectMetadata(projectRoot) {
  const root = resolveRoot(projectRoot);
  const pkg  = readPkg(root);
  const ts   = detectTechStack(root, pkg);
  const pm   = detectPackageManager(root);
  return {
    project:       (pkg && pkg.name)    || path.basename(root),
    version:       (pkg && pkg.version) || '0.1.0',
    description:   (pkg && pkg.description) || '',
    license:       (pkg && pkg.license)     || '',
    author:        (pkg && pkg.author)      || '',
    homepage:      (pkg && pkg.homepage)    || '',
    repository:    extractRepoUrl(pkg),
    techStack:     Object.assign({}, ts, { package_manager: pm }),
    stackLabel:    [ts.language, ts.framework].filter(Boolean).join(' + ') || 'Project',
    packageManager: pm
  };
}

function extractRepoUrl(pkg) {
  if (!pkg || !pkg.repository) return '';
  return typeof pkg.repository === 'string' ? pkg.repository : (pkg.repository.url || '');
}

function detectTechStack(root, pkg) {
  const deps = Object.assign({}, (pkg && pkg.dependencies) || {}, (pkg && pkg.devDependencies) || {});
  const has  = (k) => Boolean(deps[k]);
  const fileExists = (f) => fs.existsSync(path.join(root, f));

  const hasPy = ['pyproject.toml','requirements.txt','setup.py'].some(fileExists);
  let language = '', runtime = '';
  if (pkg || anyFileExt(root, ['.js','.ts','.mjs'])) { language = 'Node.js'; runtime = 'Node.js'; }
  else if (hasPy || anyFileExt(root, ['.py']))        { language = 'Python';  runtime = 'Python';  }

  return {
    language, runtime,
    framework:      detectFramework(deps),
    package_manager: detectPackageManager(root),
    typescript:     Boolean(has('typescript') || fileExists('tsconfig.json')),
    node_version:   (pkg && pkg.engines && pkg.engines.node) || '',
    databases:      detectDatabases(deps),
    test_framework: detectTestFw(deps, root),
    bundler:        detectBundler(deps),
    linter:         detectLinter(deps, root),
    cloud_platform: detectCloud(root)
  };
}

function anyFileExt(root, exts) {
  return scanFiles(root, 2).some((f) => exts.includes(path.extname(f).toLowerCase()));
}
function detectPackageManager(root) {
  if (fs.existsSync(path.join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(root, 'yarn.lock')))      return 'yarn';
  if (fs.existsSync(path.join(root, 'bun.lockb')))      return 'bun';
  return 'npm';
}
function detectFramework(d) {
  if (d.next)           return 'Next.js';
  if (d.nuxt)           return 'Nuxt';
  if (d.react)          return 'React';
  if (d.vue)            return 'Vue';
  if (d.svelte)         return 'Svelte';
  if (d.express)        return 'Express';
  if (d.fastify)        return 'Fastify';
  if (d.koa)            return 'Koa';
  if (d['@nestjs/core'])return 'NestJS';
  if (d.hono)           return 'Hono';
  return '';
}
function detectDatabases(d) {
  const r = [];
  if (d.mongoose || d.mongodb)           r.push('MongoDB');
  if (d.pg || d['pg-pool'])              r.push('PostgreSQL');
  if (d.mysql || d.mysql2)              r.push('MySQL');
  if (d.sqlite3 || d['better-sqlite3']) r.push('SQLite');
  if (d.redis || d.ioredis)             r.push('Redis');
  if (d['@prisma/client'])              r.push('Prisma');
  if (d.sequelize)                      r.push('Sequelize');
  if (d.typeorm)                        r.push('TypeORM');
  if (d.knex)                           r.push('Knex');
  return r;
}
function detectTestFw(d, root) {
  if (d.jest || d['@jest/core']) return 'Jest';
  if (d.vitest)  return 'Vitest';
  if (d.mocha)   return 'Mocha';
  if (d.jasmine) return 'Jasmine';
  if (d.ava)     return 'AVA';
  if (fs.existsSync(path.join(root, 'jest.config.js')))   return 'Jest';
  if (fs.existsSync(path.join(root, 'vitest.config.js'))) return 'Vitest';
  return '';
}
function detectBundler(d) {
  if (d.webpack) return 'Webpack'; if (d.vite)    return 'Vite';
  if (d.esbuild) return 'esbuild'; if (d.rollup)  return 'Rollup';
  if (d.parcel)  return 'Parcel';  return '';
}
function detectLinter(d, root) {
  if (d.eslint || fs.existsSync(path.join(root, '.eslintrc.js')) || fs.existsSync(path.join(root, '.eslintrc.json'))) return 'ESLint';
  if (d.biome || fs.existsSync(path.join(root, 'biome.json')))   return 'Biome';
  return '';
}
function detectCloud(root) {
  const checks = [
    ['vercel.json','Vercel'],['netlify.toml','Netlify'],['railway.json','Railway'],
    ['fly.toml','Fly.io'],['render.yaml','Render'],['Dockerfile','Docker'],
    ['docker-compose.yml','Docker Compose'],['serverless.yml','Serverless Framework']
  ];
  for (const [f, name] of checks) if (fs.existsSync(path.join(root, f))) return name;
  if (fs.existsSync(path.join(root, '.github/workflows'))) return 'GitHub Actions';
  return '';
}

// ─────────────────────────────────────────────────────────────────
//  Dependency catalogue
// ─────────────────────────────────────────────────────────────────

function buildDependencyCatalogue(projectRoot) {
  const pkg = readPkg(resolveRoot(projectRoot));
  if (!pkg) return { production: {}, development: {}, peer: {}, scripts: {} };
  return {
    production:  pkg.dependencies    || {},
    development: pkg.devDependencies || {},
    peer:        pkg.peerDependencies || {},
    scripts:     pkg.scripts         || {}
  };
}

// ─────────────────────────────────────────────────────────────────
//  Env variable scanning
// ─────────────────────────────────────────────────────────────────

function scanEnvVars(projectRoot) {
  const root   = resolveRoot(projectRoot);
  const vars   = new Set();
  const files  = ['.env','.env.example','.env.sample','.env.local'];
  for (const f of files) {
    const fp = path.join(root, f);
    if (!fs.existsSync(fp)) continue;
    try {
      for (const line of fs.readFileSync(fp, 'utf8').split('\n')) {
        const t = line.trim();
        if (!t || t.startsWith('#')) continue;
        const m = t.match(/^([A-Z0-9_]+)\s*=/);
        if (m) vars.add(m[1]);
      }
    } catch (_) {}
  }
  // scan source for process.env refs
  for (const rel of scanFiles(root, 4).slice(0, 60)) {
    if (!['.js','.ts','.mjs','.cjs'].includes(path.extname(rel))) continue;
    try {
      const src = fs.readFileSync(path.join(root, rel), 'utf8');
      for (const m of src.matchAll(/process\.env\.([A-Z0-9_]+)/g)) vars.add(m[1]);
    } catch (_) {}
  }
  return Array.from(vars).sort();
}

// ─────────────────────────────────────────────────────────────────
//  API route extraction
// ─────────────────────────────────────────────────────────────────

function extractApiRoutes(projectRoot) {
  const root   = resolveRoot(projectRoot);
  const routes = [];
  const seen   = new Set();
  for (const rel of scanFiles(root, 4)) {
    if (!['.js','.ts'].includes(path.extname(rel))) continue;
    try {
      const src = fs.readFileSync(path.join(root, rel), 'utf8');
      const pat = /\b(?:router|app)\.(get|post|put|patch|delete|all)\s*\(\s*['"`]([^'"`]+)['"`]/gm;
      let m;
      while ((m = pat.exec(src)) !== null) {
        const key = `${m[1].toUpperCase()}:${m[2]}`;
        if (seen.has(key)) continue;
        seen.add(key);
        routes.push({ method: m[1].toUpperCase(), path: m[2], file: rel });
      }
    } catch (_) {}
  }
  return routes;
}

// ─────────────────────────────────────────────────────────────────
//  Issue tracker
// ─────────────────────────────────────────────────────────────────

function createDefaultIssueTracker() {
  return {
    active_errors:     [],
    resolved_issues:   [],
    last_error_at:     null,
    last_resolved_at:  null,
    total_errors_seen: 0,
    total_resolved:    0
  };
}

function applyErrorEvent(tracker, event) {
  const t = Object.assign({}, createDefaultIssueTracker(), tracker);
  const entry = {
    id:        `err_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    timestamp: event.timestamp || new Date().toISOString(),
    message:   event.message   || 'Unknown error',
    file:      event.file      || '',
    stack:     event.stack     || '',
    status:    'active'
  };
  return Object.assign({}, t, {
    active_errors:     [entry, ...t.active_errors].slice(0, MAX_ACTIVE_ERRORS),
    last_error_at:     entry.timestamp,
    total_errors_seen: t.total_errors_seen + 1
  });
}

function applyResolveEvent(tracker, event) {
  const t   = Object.assign({}, createDefaultIssueTracker(), tracker);
  const now = event.timestamp || new Date().toISOString();
  let actives = [...t.active_errors];
  let resolved = null;

  const idx = actives.findIndex((e) =>
    (event.errorId && e.id === event.errorId) ||
    (event.message && e.message && e.message.toLowerCase().includes(event.message.toLowerCase()))
  );

  if (idx !== -1) {
    resolved = Object.assign({}, actives[idx], {
      status:      'resolved',
      resolved_at: now,
      resolution:  event.resolution || 'Marked resolved'
    });
    actives.splice(idx, 1);
  } else {
    resolved = {
      id:          `res_${Date.now()}`,
      timestamp:   now,
      resolved_at: now,
      message:     event.message    || 'Issue resolved',
      resolution:  event.resolution || 'Marked resolved',
      file:        event.file       || '',
      status:      'resolved'
    };
  }

  return Object.assign({}, t, {
    active_errors:   actives,
    resolved_issues: [resolved, ...t.resolved_issues].slice(0, MAX_RESOLVED_ISSUES),
    last_resolved_at: now,
    total_resolved:   t.total_resolved + 1
  });
}

// ─────────────────────────────────────────────────────────────────
//  Code change history  ← THE KEY NEW SECTION
// ─────────────────────────────────────────────────────────────────

/**
 * Given a file path and its old/new content snapshots,
 * build a rich code change entry for the changelog.
 */
function buildCodeChangeEntry(relPath, oldContent, newContent, action, timestamp) {
  const ext  = path.extname(relPath).toLowerCase();
  const isCode = CODE_EXTENSIONS.has(ext);
  const ts   = timestamp || new Date().toISOString();

  if (action === 'delete') {
    return {
      id:           `chg_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
      timestamp:    ts,
      action:       'delete',
      file:         relPath,
      summary:      `Deleted ${relPath}`,
      signals:      ['File removed from project'],
      patch:        null,
      lines_added:   0,
      lines_removed: 0
    };
  }

  if (action === 'add' && !oldContent) {
    const lines = (newContent || '').split('\n').length;
    const signals = isCode ? extractCodeSignals(
      (newContent || '').split('\n').map((l) => `+${l}`).join('\n'),
      relPath
    ) : ['New file added'];
    return {
      id:            `chg_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
      timestamp:     ts,
      action:        'add',
      file:          relPath,
      summary:       `Added ${relPath} (${lines} lines)`,
      signals,
      patch:         null,
      lines_added:   lines,
      lines_removed: 0
    };
  }

  // change – produce real diff
  const old_ = oldContent || '';
  const new_ = newContent || '';

  if (old_ === new_) return null; // no actual change

  const { patch, linesAdded, linesRemoved, summary } = diffTexts(old_, new_, relPath);
  const signals = isCode ? extractCodeSignals(patch, relPath) : ['File updated'];

  return {
    id:            `chg_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
    timestamp:     ts,
    action:        'change',
    file:          relPath,
    summary,
    signals,
    patch:         patch.length > 8000 ? patch.slice(0, 8000) + '\n[patch truncated]' : patch,
    lines_added:   linesAdded,
    lines_removed: linesRemoved
  };
}

// ─────────────────────────────────────────────────────────────────
//  Bootstrap project analysis
// ─────────────────────────────────────────────────────────────────

function bootstrapProjectAnalysis(projectRoot) {
  const root     = resolveRoot(projectRoot);
  const meta     = detectProjectMetadata(root);
  const pkg      = readPkg(root);
  const ts       = meta.techStack;
  const files    = scanFiles(root, 4);
  const inputs   = collectAnalysisInputs(root, files);
  const signals  = detectSignals(inputs, pkg, ts);
  return {
    projectType:            inferProjectType(signals, ts, pkg),
    techStack:              ts,
    architecturePatterns:   buildArchPatterns(signals, ts, pkg),
    implementationDetails:  buildImplDetails(signals, ts),
    keyFeatures:            buildKeyFeatures(signals, ts),
    signals
  };
}

function collectAnalysisInputs(root, files) {
  const important = new Set([
    'package.json','app.js','app.ts','index.js','index.ts','main.py'
  ]);
  const importantDirs = new Set(['routes','server','controllers','services','middleware','config','src','core','bin','lib','api','utils']);
  // Exclude aibridge's own infrastructure files — they contain detection
  // strings (e.g. /new PrismaClient/) that would create false positives
  // when the tool analyses itself.
  const SELF_FILES = new Set([
    'core/stateManager.js','core/codeDiff.js','core/fileSnapshot.js',
    'core/watcher.js','core/gitSync.js','core/init.js',
    'bin/cli.js','utils/logger.js'
  ]);
  const selected = files.filter((f) => {
    if (SELF_FILES.has(f)) return false;
    if (important.has(f)) return true;
    const seg = f.split('/')[0];
    return importantDirs.has(seg);
  });
  return selected.slice(0, 80).map((rel) => {
    try {
      const content = fs.readFileSync(path.join(root, rel), 'utf8').slice(0, 50000);
      return { path: rel, content };
    } catch (_) { return null; }
  }).filter(Boolean);
}

function detectSignals(inputs, pkg, ts) {
  const deps = Object.assign({}, (pkg && pkg.dependencies) || {}, (pkg && pkg.devDependencies) || {});
  const all  = inputs.map((i) => i.content).join('\n');
  const has  = (p) => p.test(all);
  const dep  = (k) => Boolean(deps[k]);
  const hasDir = (d) => inputs.some((i) => i.path.startsWith(d + '/'));

  return {
    hasPackageJson:    Boolean(pkg),
    hasCliEntry:       Boolean(pkg && pkg.bin && Object.keys(pkg.bin).length) || has(/\bprocess\.argv\b/),
    hasExpress:        dep('express') || has(/require\(['"]express['"]\)/) || has(/\bexpress\(\)/),
    hasNext:           dep('next'),
    hasReact:          dep('react'),
    hasFastify:        dep('fastify'),
    hasNest:           dep('@nestjs/core'),
    hasRestRoutes:     has(/\b(router|app)\.(get|post|put|patch|delete)\s*\(/),
    hasMiddleware:     has(/\bapp\.use\s*\(/) || hasDir('middleware'),
    hasJwt:            dep('jsonwebtoken') || has(/\bjwt\.(sign|verify)/),
    hasMongoose:       dep('mongoose') || has(/mongoose\.connect/),
    hasPrisma:         dep('@prisma/client') || has(/new PrismaClient/),
    hasSocketIO:       dep('socket.io') || has(/require\(['"]socket\.io['"]\)/),
    hasAxiosOrFetch:   dep('axios') || has(/\baxios\./) || has(/\bfetch\s*\(/),
    hasWatcher:        dep('chokidar') || has(/chokidar\.watch/),
    hasGitAutomation:  has(/\bgit\s+(add|commit|push)\b/) || has(/syncContextToGit/),
    hasAiArtifacts:    has(/state\.json/) && has(/brain\.txt/),
    hasControllers:    hasDir('controllers'),
    hasServices:       hasDir('services'),
    hasRoutes:         hasDir('routes'),
    hasServerDir:      hasDir('server'),
    hasConfigDir:      hasDir('config'),
    hasTests:          hasDir('test') || hasDir('tests') || hasDir('__tests__') || dep('jest') || dep('vitest') || dep('mocha'),
    hasRedis:          dep('redis') || dep('ioredis'),
    hasQueue:          dep('bull') || dep('bullmq'),
    hasEmail:          dep('nodemailer') || dep('@sendgrid/mail') || dep('resend'),
    hasGraphQL:        dep('graphql') || dep('@apollo/server'),
    hasTypeScript:     ts.typescript
  };
}

function inferProjectType(s, ts, pkg) {
  if (s.hasNext)                       return 'Next.js application';
  if (s.hasCliEntry && s.hasAiArtifacts) return 'CLI tool';
  if (s.hasExpress && s.hasRestRoutes) return 'backend API platform';
  if (s.hasReact)                      return 'frontend application';
  if (ts.language === 'Python')        return 'Python application';
  if (pkg && pkg.bin)                  return 'CLI tool';
  return 'Node.js application';
}

function buildArchPatterns(s, ts, pkg) {
  const p = [];
  if (s.hasCliEntry)                         p.push('Command-line automation workflow');
  if (s.hasWatcher)                          p.push('Event-driven file watching pipeline');
  if (s.hasExpress && s.hasRestRoutes)       p.push('REST API architecture');
  if (s.hasMiddleware)                       p.push('Middleware-driven request pipeline');
  if (s.hasControllers && s.hasServices)     p.push('Layered controller-service architecture');
  if (s.hasServerDir && s.hasRoutes)         p.push('Separated server bootstrap and route handling');
  if (s.hasSocketIO)                         p.push('Real-time event architecture');
  if (s.hasNest)                             p.push('NestJS modular architecture');
  if (s.hasGraphQL)                          p.push('GraphQL API layer');
  if (s.hasPrisma || s.hasMongoose)          p.push('Database-backed persistence layer');
  if (s.hasRedis)                            p.push('Redis-backed caching or session layer');
  if (s.hasAiArtifacts && s.hasExpress)      p.push('Structured AI context delivery workflow');
  if (pkg && Array.isArray(pkg.keywords) && pkg.keywords.includes('cli')) p.push('Package-distributed CLI architecture');
  return uniq(p).slice(0, 8);
}

function buildImplDetails(s, ts) {
  const d = [];
  if (s.hasJwt)                          d.push('JWT-based authentication');
  if (s.hasMongoose)                     d.push('MongoDB via Mongoose ORM');
  if (s.hasPrisma)                       d.push('Type-safe database access via Prisma');
  if (s.hasExpress && s.hasRestRoutes)   d.push('REST API with Express routing');
  if (s.hasMiddleware)                   d.push('Express middleware pipeline');
  if (s.hasSocketIO)                     d.push('Socket.IO real-time communication');
  if (s.hasAxiosOrFetch)                 d.push('External API integration');
  if (s.hasWatcher)                      d.push('Debounced file-system event watcher');
  if (s.hasAiArtifacts)                  d.push('Structured AI context generation (state.json, brain.txt, context.md, changelog.json)');
  if (s.hasGitAutomation)                d.push('Git-backed context sync workflow');
  if (s.hasCliEntry)                     d.push('Node.js CLI entrypoint');
  if (s.hasGraphQL)                      d.push('GraphQL schema and resolvers');
  if (s.hasRedis)                        d.push('Redis caching layer');
  if (s.hasQueue)                        d.push('Background job queue');
  if (s.hasEmail)                        d.push('Transactional email delivery');
  if (s.hasTests)                        d.push('Automated test suite');
  return uniq(d).slice(0, MAX_IMPL_DETAILS);
}

function buildKeyFeatures(s, ts) {
  const f = [];
  if (s.hasAiArtifacts)    f.push('AI-readable project context generation');
  if (s.hasCliEntry)       f.push('CLI automation workflow');
  if (s.hasWatcher)        f.push('Automatic change tracking');
  if (s.hasGitAutomation)  f.push('Optional GitHub sync for public AI access');
  if (s.hasExpress && s.hasAiArtifacts) f.push('Local HTTP context server');
  else if (s.hasExpress)   f.push('REST API');
  if (s.hasJwt)            f.push('Authentication');
  if (s.hasMongoose || s.hasPrisma) f.push('Data persistence');
  if (s.hasSocketIO)       f.push('Real-time communication');
  if (s.hasAxiosOrFetch)   f.push('External API integration');
  if (s.hasTests)          f.push('Automated testing');
  if (s.hasGraphQL)        f.push('GraphQL API');
  if (s.hasEmail)          f.push('Email notifications');
  return uniq(f).slice(0, MAX_KEY_FEATURES);
}

// ─────────────────────────────────────────────────────────────────
//  Default state / changelog
// ─────────────────────────────────────────────────────────────────

function createDefaultChangelog() { return { entries: [] }; }

function createDefaultState(projectRoot) {
  const root      = resolveRoot(projectRoot);
  const meta      = detectProjectMetadata(root);
  const boot      = bootstrapProjectAnalysis(root);
  const fileList  = scanFiles(root, MAX_TREE_DEPTH);
  const codeFiles = buildCodeFileCatalogue(root, fileList);

  const state = {
    project:     meta.project,
    version:     meta.version,
    description: meta.description,
    author:      meta.author,
    license:     meta.license,
    homepage:    meta.homepage,
    repository:  meta.repository,

    last_updated:           new Date().toISOString(),
    ai_summary:             '',
    tech_stack:             boot.techStack,
    architecture_patterns:  boot.architecturePatterns,
    implementation_details: boot.implementationDetails,
    current_stage:          stageFromFeatures(boot.keyFeatures, boot.implementationDetails),
    recent_updates:         [],
    key_features:           boot.keyFeatures,
    known_issues:           [],
    next_steps:             [],

    // File structure
    file_tree:    buildFileTree(root),
    file_list:    fileList,

    // Code catalogue: every file's exports/imports/functions/methods/summaries
    code_files:   codeFiles,

    // Full code change history with real diffs
    code_changes: [],

    // API surface
    api_routes:   extractApiRoutes(root),

    // Dependencies
    dependencies: buildDependencyCatalogue(root),

    // Environment
    env_variables: scanEnvVars(root),

    // Error / issue tracking
    issue_tracker: createDefaultIssueTracker(),

    // Developer notes embedded in code (TODO/FIXME/HACK/XXX/BUG)
    code_notes: scanCodeNotes(root, fileList),

    // Internal module dependency graph (which project files import which)
    dependency_graph: buildDependencyGraph(root, fileList, codeFiles),

    // Working context (manually set or updated via CLI)
    current_focus:  '',
    working_branch: '',
    open_questions: [],
    decisions_made: [],
    session_notes:  []
  };

  state.setup_guide = buildSetupGuide(root, state);
  state.ai_summary  = genAiSummary(state, boot);
  state.next_steps  = genNextSteps(state, boot);
  return state;
}

function stageFromFeatures(features, details) {
  if (features.length >= 4 && details.length >= 3) return 'Production-ready';
  if (features.length >= 2)                         return 'Functional prototype';
  return 'Early development';
}

function genAiSummary(state, boot) {
  const type  = cap(boot.projectType || 'Project');
  const feats = (state.key_features || []).slice(0, 3).join(', ').toLowerCase();
  const db    = state.tech_stack.databases && state.tech_stack.databases.length
    ? ` backed by ${state.tech_stack.databases.join(', ')}`
    : '';
  if (feats) return `${type}${db} with: ${feats}.`;
  return `${type}${db}.`;
}

function genNextSteps(state, boot) {
  const steps = [];
  if (!state.tech_stack.test_framework && !boot.signals.hasTests) steps.push('Add automated tests');
  if (boot.implementationDetails.length < 2)  steps.push('Expand project structure so more patterns are detectable');
  if (state.current_stage === 'Early development') steps.push('Ship next core capability to reach functional prototype stage');
  return steps.slice(0, 4);
}

// ─────────────────────────────────────────────────────────────────
//  I/O helpers
// ─────────────────────────────────────────────────────────────────

async function ensureContextDirectory(projectRoot) {
  const { contextDir } = getContextPaths(projectRoot);
  await fsp.mkdir(contextDir, { recursive: true });
  return contextDir;
}

async function readJsonFile(filePath, fallback) {
  try { return JSON.parse(await fsp.readFile(filePath, 'utf8')); }
  catch (_) { return fallback; }
}

async function writeJsonAtomic(filePath, value) {
  await writeTextAtomic(filePath, JSON.stringify(value, null, 2) + '\n');
}

async function writeTextAtomic(filePath, content) {
  const tmp = `${filePath}.tmp`;
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(tmp, content, 'utf8');
  await fsp.rename(tmp, filePath);
}

function renderTemplate(template, vars) {
  return Object.entries(vars).reduce((acc, [k, v]) =>
    acc.split(`{{${k}}}`).join(v == null ? '' : String(v)), template);
}

// ─────────────────────────────────────────────────────────────────
//  Runtime config
// ─────────────────────────────────────────────────────────────────

async function loadRuntimeConfig(projectRoot) {
  const { configFile } = getContextPaths(projectRoot);
  return deepMerge(DEFAULT_CONFIG, await readJsonFile(configFile, {}));
}

async function updateRuntimeConfig(projectRoot, updates) {
  const { configFile } = getContextPaths(projectRoot);
  const cur  = await readJsonFile(configFile, {});
  const next = deepMerge(deepMerge(DEFAULT_CONFIG, cur), updates || {});
  await writeJsonAtomic(configFile, next);
  return next;
}

// ─────────────────────────────────────────────────────────────────
//  MAIN STATE UPDATER
// ─────────────────────────────────────────────────────────────────

async function updateProjectState(projectRoot, changeEvent, options) {
  const settings = Object.assign({ logger: null, syncCallback: null }, options);
  const log      = settings.logger;
  const root     = resolveRoot(projectRoot);
  const paths    = getContextPaths(root);

  const existing    = await readJsonFile(paths.stateFile,     createDefaultState(root));
  const existingLog = await readJsonFile(paths.changelogFile, createDefaultChangelog());

  const events = (Array.isArray(changeEvent) ? changeEvent : [changeEvent]).filter(Boolean);
  const ts     = events.length ? (events[events.length - 1].timestamp || new Date().toISOString()) : new Date().toISOString();

  // ── 1. Handle error/resolve events ──────────────────────────────
  let issueTracker = existing.issue_tracker || createDefaultIssueTracker();
  for (const ev of events) {
    if (ev.type === 'error')   issueTracker = applyErrorEvent(issueTracker, ev);
    if (ev.type === 'resolve') issueTracker = applyResolveEvent(issueTracker, ev);
  }

  // ── 2. Build real code-change entries with diffs ────────────────
  const newCodeChanges = [];
  for (const ev of events) {
    if (!ev.file || ev.type === 'error' || ev.type === 'resolve') continue;
    if (scoreEvent(ev.file) < 2) continue;

    const absPath    = path.join(root, ev.file);
    const oldContent = ev.oldContent !== undefined ? ev.oldContent : getSnapshot(absPath);
    let   newContent = ev.newContent;
    if (newContent === undefined) {
      newContent = ev.action === 'delete' ? '' : readCurrentContent(absPath);
    }

    const entry = buildCodeChangeEntry(ev.file, oldContent, newContent, ev.action, ev.timestamp || ts);
    if (entry) newCodeChanges.push(entry);
  }

  // ── 3. Re-scan project for fresh context ────────────────────────
  const meta          = detectProjectMetadata(root);
  const boot          = bootstrapProjectAnalysis(root);
  const fileList      = scanFiles(root, MAX_TREE_DEPTH);
  const freshCodeFiles = buildCodeFileCatalogue(root, fileList);

  // ── 4. Merge code_changes (newest first, capped) ────────────────
  const prevCodeChanges = Array.isArray(existing.code_changes) ? existing.code_changes : [];
  const allCodeChanges  = [...newCodeChanges, ...prevCodeChanges].slice(0, MAX_CODE_CHANGE_HISTORY);

  // ── 5. Build changelog entries (one per change, rich) ───────────
  const newChangelogEntries = newCodeChanges.map((c) => ({
    id:        c.id,
    timestamp: c.timestamp,
    file:      c.file,
    action:    c.action,
    summary:   c.summary,
    signals:   c.signals,
    lines_added:   c.lines_added,
    lines_removed: c.lines_removed
    // patch intentionally excluded from changelog to keep it lean
  }));
  const prevEntries    = Array.isArray(existingLog.entries) ? existingLog.entries : [];
  const allEntries     = [...newChangelogEntries, ...prevEntries].slice(0, MAX_CHANGELOG_ENTRIES);

  // ── 6. recent_updates: human-readable, last N changes ───────────
  const recentUpdates = allCodeChanges.slice(0, MAX_RECENT_UPDATES).map((c) => ({
    timestamp:    c.timestamp,
    file:         c.file,
    action:       c.action,
    summary:      c.summary,
    signals:      c.signals,
    lines_added:  c.lines_added,
    lines_removed: c.lines_removed
  }));

  // ── 7. Compose next state ───────────────────────────────────────
  const nextState = {
    project:     meta.project,
    version:     meta.version,
    description: meta.description || existing.description || '',
    author:      meta.author      || existing.author      || '',
    license:     meta.license     || existing.license     || '',
    homepage:    meta.homepage    || existing.homepage    || '',
    repository:  meta.repository  || existing.repository  || '',

    last_updated:           ts,
    tech_stack:             deepMerge(boot.techStack, existing.tech_stack || {}),
    architecture_patterns:  boot.architecturePatterns.length  ? boot.architecturePatterns  : (existing.architecture_patterns  || []),
    implementation_details: boot.implementationDetails.length ? boot.implementationDetails : (existing.implementation_details || []),
    key_features:           boot.keyFeatures.length           ? boot.keyFeatures           : (existing.key_features           || []),
    current_stage:          stageFromFeatures(boot.keyFeatures, boot.implementationDetails),
    recent_updates:         recentUpdates,
    known_issues:           existing.known_issues || [],
    next_steps:             [],

    // Always refreshed
    file_tree:     buildFileTree(root),
    file_list:     fileList,
    code_files:    freshCodeFiles,
    code_changes:  allCodeChanges,
    api_routes:    extractApiRoutes(root),
    dependencies:  buildDependencyCatalogue(root),
    env_variables: scanEnvVars(root),

    // Developer notes embedded in code (TODO/FIXME/HACK/XXX/BUG)
    code_notes: scanCodeNotes(root, fileList),

    // Internal module dependency graph (which project files import which)
    dependency_graph: buildDependencyGraph(root, fileList, freshCodeFiles),

    // Issue tracking
    issue_tracker: issueTracker,

    // Preserve working context
    current_focus:  existing.current_focus  || '',
    working_branch: existing.working_branch || '',
    open_questions: existing.open_questions || [],
    decisions_made: existing.decisions_made || [],
    session_notes:  existing.session_notes  || []
  };

  nextState.ai_summary   = genAiSummary(nextState, boot);
  nextState.next_steps   = genNextSteps(nextState, boot);
  nextState.setup_guide  = buildSetupGuide(root, nextState);

  // ── 8. Write state, changelog, and auto-regenerate briefing.md ──
  const briefing = generateBriefing(nextState, root);
  await writeJsonAtomic(paths.stateFile,     nextState);
  await writeJsonAtomic(paths.changelogFile, { entries: allEntries });
  await writeTextAtomic(paths.briefingFile,  briefing);

  if (log) log.debug(`Updated AI context – ${newCodeChanges.length} code change(s) recorded`);
  if (typeof settings.syncCallback === 'function') await settings.syncCallback();

  return nextState;
}

// ─────────────────────────────────────────────────────────────────
//  Debounced updater
// ─────────────────────────────────────────────────────────────────

function createDebouncedStateUpdater(projectRoot, options) {
  const s = Object.assign({ debounceMs: DEFAULT_CONFIG.debounceMs, logger: null, syncCallback: null }, options);
  let timer   = null;
  let pending = [];
  let active  = Promise.resolve();

  async function flush() {
    if (!pending.length) return;
    const evs = pending.slice();
    pending   = [];
    active    = active.then(() => updateProjectState(projectRoot, evs, { logger: s.logger, syncCallback: s.syncCallback }));
    await active;
  }

  return {
    enqueue(event) {
      pending.push(event);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        flush().catch((err) => { if (s.logger) s.logger.error(`Flush failed: ${err.message}`); });
      }, s.debounceMs);
    },
    async flushNow() {
      if (timer) { clearTimeout(timer); timer = null; }
      await flush();
    }
  };
}

// ─────────────────────────────────────────────────────────────────
//  Exports
// ─────────────────────────────────────────────────────────────────

module.exports = {
  CONTEXT_DIR_NAME,
  DEFAULT_CONFIG,
  applyErrorEvent,
  applyResolveEvent,
  bootstrapProjectAnalysis,
  buildCodeFileCatalogue,
  buildDependencyCatalogue,
  buildFileTree,
  createDebouncedStateUpdater,
  createDefaultChangelog,
  createDefaultIssueTracker,
  createDefaultState,
  detectProjectMetadata,
  ensureContextDirectory,
  extractApiRoutes,
  getContextPaths,
  loadRuntimeConfig,
  readJsonFile,
  renderTemplate,
  scanEnvVars,
  scanFiles,
  scoreEvent,
  shouldIgnoreProjectFile,
  updateRuntimeConfig,
  updateProjectState,
  writeJsonAtomic,
  writeTextAtomic
};
