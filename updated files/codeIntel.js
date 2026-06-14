'use strict';

/**
 * codeIntel.js
 * ------------
 * Higher-level project intelligence built on top of the file/code
 * catalogue produced by fileSnapshot.js. Everything here is derived
 * purely from static analysis of project files — no execution.
 *
 * Provides:
 *   - scanCodeNotes()       TODO/FIXME/HACK/XXX/BUG comments across the project
 *   - buildDependencyGraph() which project files import which other project files
 *   - buildSetupGuide()      how to install + run, and env var readiness
 */

const fs   = require('fs');
const path = require('path');

const MAX_NOTES = 100;
const MAX_DERIVED_IMPL_DETAILS = 20;
const MAX_DERIVED_KEY_FEATURES = 10;

// Languages worth scanning for inline developer notes
const NOTE_SCAN_EXTENSIONS = new Set([
  '.js', '.ts', '.mjs', '.cjs', '.jsx', '.tsx',
  '.py', '.go', '.rs', '.java', '.rb', '.php', '.cs', '.swift', '.md'
]);

const NOTE_PATTERN = /(?:\/\/|#|<!--)\s*(TODO|FIXME|HACK|XXX|BUG)\b[:\s-]*(.*?)(?:-->)?\s*$/i;

// ─────────────────────────────────────────────────────────────────
//  Developer-note scanning (flags TODO / FIXME / HACK / XXX / BUG)
// ─────────────────────────────────────────────────────────────────

/**
 * Scans every tracked file for TODO/FIXME/HACK/XXX/BUG comments.
 * Returns: [{ type, file, line, text }]
 */
function scanCodeNotes(projectRoot, fileList) {
  const root  = path.resolve(projectRoot || process.cwd());
  const notes = [];

  for (const rel of (fileList || [])) {
    const ext = path.extname(rel).toLowerCase();
    if (!NOTE_SCAN_EXTENSIONS.has(ext)) continue;

    let content;
    try { content = fs.readFileSync(path.join(root, rel), 'utf8'); }
    catch (_) { continue; }

    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const m = NOTE_PATTERN.exec(lines[i]);
      if (!m) continue;
      const text = (m[2] || '').trim().slice(0, 160);
      notes.push({
        type: m[1].toUpperCase(),
        file: rel,
        line: i + 1,
        text: text || lines[i].trim().slice(0, 160)
      });
      if (notes.length >= MAX_NOTES) return notes;
    }
  }
  return notes;
}

// ─────────────────────────────────────────────────────────────────
//  Internal dependency graph
// ─────────────────────────────────────────────────────────────────

/**
 * Builds a map of project-file -> [project-files it imports],
 * using only imports that resolve to other tracked files
 * (external packages like 'express' or 'pandas' are excluded).
 *
 * codeFiles: the code_files object from fileSnapshot.buildCodeFileCatalogue
 * Returns: { graph: {file: [deps]}, mostUsed: [{file, count}] }
 */
function buildDependencyGraph(projectRoot, fileList, codeFiles) {
  const fileSet = new Set(fileList || []);
  const graph   = {};

  for (const [file, info] of Object.entries(codeFiles || {})) {
    const fileDir = path.dirname(file);
    const deps    = [];

    for (const imp of (info.imports || [])) {
      let resolved = null;

      if (imp.startsWith('.')) {
        // Relative JS/TS import
        resolved = resolveRelativeImport(fileDir, imp, fileSet);
      } else {
        // Absolute import — try Python-style dotted-path resolution.
        // Works whether or not the import is prefixed with the
        // project's package name (e.g. both "signal_bot.signals.fusion"
        // and "signals.fusion" resolve to signals/fusion.py).
        resolved = resolvePythonImport(imp, fileSet);
      }

      if (resolved && resolved !== file) deps.push(resolved);
    }

    if (deps.length) graph[file] = Array.from(new Set(deps));
  }

  // Reverse-count: which internal files are imported most often
  const usage = {};
  for (const deps of Object.values(graph)) {
    for (const dep of deps) usage[dep] = (usage[dep] || 0) + 1;
  }
  const mostUsed = Object.entries(usage)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([file, count]) => ({ file, count }));

  return { graph, mostUsed };
}

function resolveRelativeImport(fromDir, importPath, fileSet) {
  const base = path.posix.normalize(path.posix.join(fromDir, importPath));
  const candidates = [
    base, `${base}.js`, `${base}.ts`, `${base}.jsx`, `${base}.tsx`, `${base}.mjs`, `${base}.cjs`,
    `${base}/index.js`, `${base}/index.ts`
  ];
  for (const c of candidates) if (fileSet.has(c)) return c;
  return null;
}

/**
 * Resolves a dotted Python import (e.g. "signal_bot.signals.fusion" or
 * "signals.fusion") to a project file. Tries the path with the first
 * segment stripped (handles "<package_root>.<module>.<submodule>")
 * and the path as-is (handles direct module paths). External packages
 * (pandas, loguru, etc.) simply won't match anything and return null.
 */
function resolvePythonImport(imp, fileSet) {
  const parts = imp.split('.').filter(Boolean);
  if (parts.length >= 2) {
    const stripped = tryPythonPathCandidates(parts.slice(1), fileSet);
    if (stripped) return stripped;
  }
  return tryPythonPathCandidates(parts, fileSet);
}

function tryPythonPathCandidates(parts, fileSet) {
  if (parts.length === 0) return null;
  const subPath = parts.join('/');
  if (fileSet.has(`${subPath}.py`))          return `${subPath}.py`;
  if (fileSet.has(`${subPath}/__init__.py`)) return `${subPath}/__init__.py`;
  return null;
}

// ─────────────────────────────────────────────────────────────────
//  Setup guide: how to install/run + env var readiness
// ─────────────────────────────────────────────────────────────────

/**
 * Returns: {
 *   install: string|null,
 *   run: string|null,
 *   entry_point: string|null,
 *   env_status: [{ name, configured }],
 *   env_configured_count, env_total_count
 * }
 */
function buildSetupGuide(projectRoot, state) {
  const root = path.resolve(projectRoot || process.cwd());
  const ts   = state.tech_stack || {};
  const guide = { install: null, run: null, entry_point: null, env_status: [] };

  // ── Install command ──────────────────────────────────────────
  if (ts.language === 'Node.js') {
    const pm = ts.package_manager || 'npm';
    guide.install = pm === 'yarn' ? 'yarn install'
                  : pm === 'pnpm' ? 'pnpm install'
                  : pm === 'bun'  ? 'bun install'
                  : 'npm install';
  } else if (ts.language === 'Python') {
    if (fs.existsSync(path.join(root, 'requirements.txt'))) {
      guide.install = 'pip install -r requirements.txt';
    } else if (fs.existsSync(path.join(root, 'pyproject.toml'))) {
      guide.install = 'pip install .';
    }
  }

  // ── Run command + entry point ────────────────────────────────
  const scripts = (state.dependencies || {}).scripts || {};
  if (scripts.start) {
    guide.run = `${ts.package_manager || 'npm'} start`;
    guide.entry_point = `scripts.start → ${scripts.start}`;
  } else if (ts.language === 'Python') {
    const candidates = ['main.py', 'app.py', 'bot.py', 'run.py'];
    for (const c of candidates) {
      if (fs.existsSync(path.join(root, c))) {
        guide.run = `python ${c}`;
        guide.entry_point = c;
        break;
      }
    }
  } else if (ts.language === 'Node.js') {
    const candidates = ['index.js', 'server.js', 'app.js'];
    for (const c of candidates) {
      if (fs.existsSync(path.join(root, c))) {
        guide.run = `node ${c}`;
        guide.entry_point = c;
        break;
      }
    }
  }

  // ── Env var readiness (names only — never values) ────────────
  const setVars = readConfiguredEnvVarNames(root);
  guide.env_status = (state.env_variables || []).map((name) => ({
    name,
    configured: setVars.has(name)
  }));
  guide.env_configured_count = guide.env_status.filter((v) => v.configured).length;
  guide.env_total_count      = guide.env_status.length;
  guide.env_file_found       = setVars.size > 0 || envFileExists(root);

  return guide;
}

function envFileExists(root) {
  return ['.env', '.env.local'].some((f) => fs.existsSync(path.join(root, f)));
}

function readConfiguredEnvVarNames(root) {
  const set = new Set();
  for (const f of ['.env', '.env.local']) {
    const fp = path.join(root, f);
    if (!fs.existsSync(fp)) continue;
    try {
      for (const line of fs.readFileSync(fp, 'utf8').split('\n')) {
        const t = line.trim();
        if (!t || t.startsWith('#')) continue;
        const m = t.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
        // Only count as "configured" if there's a non-empty value
        if (m && m[2] && m[2].trim().length > 0) set.add(m[1]);
      }
    } catch (_) { /* silent */ }
  }
  return set;
}

module.exports = {
  scanCodeNotes,
  buildDependencyGraph,
  buildSetupGuide,
  deriveProjectCapabilities,
  buildArchitectureFlow,
  rankCoreFiles
};

// ─────────────────────────────────────────────────────────────────
//  Project capabilities (architecture/implementation/key-features)
// ─────────────────────────────────────────────────────────────────

/**
 * Turns the existing code catalogue + dependency graph into
 * human-readable architecture/implementation/feature summaries —
 * entirely from data already extracted (class docstrings, which
 * files are actually wired into the dependency graph, and the
 * project's own directory structure). Works for any language;
 * no hardcoded domain knowledge.
 *
 * Returns:
 *   implementationDetails: ["`ClassName` — docstring", ...]
 *   keyFeatures:           ["`dir/` — docstring of primary class", ...]
 *   modularPattern:        "Modular subsystem architecture across: a, b, c" | null
 */
function deriveProjectCapabilities(codeFiles, dependencyGraph) {
  const graph = (dependencyGraph && dependencyGraph.graph) || {};

  // Files that actually participate in the dependency graph (either
  // import something internal, or are imported by something internal).
  const usedFiles = new Set();
  for (const [file, deps] of Object.entries(graph)) {
    usedFiles.add(file);
    for (const dep of deps) usedFiles.add(dep);
  }
  const hasGraph = usedFiles.size > 0;

  // Collect every documented class, optionally restricted to "used" files.
  const capabilities = [];
  for (const [file, info] of Object.entries(codeFiles || {})) {
    if (hasGraph && !usedFiles.has(file)) continue;
    for (const cls of (info.classes || [])) {
      const summary = (info.summaries || {})[cls];
      if (!summary) continue;
      capabilities.push({
        name:        cls,
        summary,
        file,
        dir:         topLevelDir(file),
        methodCount: ((info.methods || {})[cls] || []).length
      });
    }
  }

  // implementation_details: one line per documented class actually in use
  const implementationDetails = capabilities
    .map((c) => `\`${c.name}\` — ${c.summary}`)
    .slice(0, MAX_DERIVED_IMPL_DETAILS);

  // key_features: one entry per top-level directory, described by its
  // most substantial (most-methods) documented class. Also keep the
  // full sorted per-dir list for the Module Capabilities section.
  const byDir = {};
  for (const c of capabilities) {
    if (c.dir === '.') continue;
    (byDir[c.dir] = byDir[c.dir] || []).push(c);
  }
  for (const dir of Object.keys(byDir)) {
    byDir[dir].sort((a, b) => b.methodCount - a.methodCount);
  }
  const keyFeatures = Object.entries(byDir)
    .map(([dir, classes]) => `\`${dir}/\` — ${classes[0].summary}`)
    .slice(0, MAX_DERIVED_KEY_FEATURES);

  // architecture: if the project is organized into multiple subsystem
  // directories, say so as a single pattern entry
  const dirs = Object.keys(byDir);
  const modularPattern = dirs.length >= 2
    ? `Modular subsystem architecture across: ${dirs.map((d) => `${d}/`).join(', ')}`
    : null;

  return { implementationDetails, keyFeatures, modularPattern, byDir, capabilities };
}

function topLevelDir(filePath) {
  const idx = filePath.indexOf('/');
  return idx === -1 ? '.' : filePath.slice(0, idx);
}

// ─────────────────────────────────────────────────────────────────
//  Architecture flow (dependency tree from the entry point)
// ─────────────────────────────────────────────────────────────────

const MAX_FLOW_LINES = 60;
const MAX_FLOW_DEPTH = 6;

/**
 * Renders the dependency graph as an indented tree starting from the
 * project's entry point. Files that reappear deeper in the tree (e.g.
 * a config module imported by many things) are marked "(↺ shown above)"
 * instead of being re-expanded, to keep hub files from exploding the
 * tree. Returns an array of lines, or null if there's no entry point
 * in the graph to walk from.
 */
function buildArchitectureFlow(dependencyGraph, entryPoint) {
  const graph = (dependencyGraph && dependencyGraph.graph) || {};
  if (!entryPoint || !(entryPoint in graph)) return null;

  const lines   = [entryPoint];
  const visited = new Set([entryPoint]);

  function walk(file, prefix, depth) {
    if (depth > MAX_FLOW_DEPTH || lines.length >= MAX_FLOW_LINES) return;
    const deps = graph[file] || [];
    for (let i = 0; i < deps.length; i++) {
      if (lines.length >= MAX_FLOW_LINES) {
        lines.push(`${prefix}… (truncated)`);
        return;
      }
      const dep    = deps[i];
      const isLast = i === deps.length - 1;
      const branch = isLast ? '└─ ' : '├─ ';
      const nextPrefix = prefix + (isLast ? '   ' : '│  ');

      if (visited.has(dep)) {
        lines.push(`${prefix}${branch}${dep} (↺ shown above)`);
      } else {
        visited.add(dep);
        lines.push(`${prefix}${branch}${dep}`);
        walk(dep, nextPrefix, depth + 1);
      }
    }
  }

  walk(entryPoint, '', 1);
  return lines.length > 1 ? lines : null;
}

// ─────────────────────────────────────────────────────────────────
//  Core file ranking ("read these first")
// ─────────────────────────────────────────────────────────────────

const MAX_CORE_FILES = 6;

/**
 * Ranks the files an AI should read first: the entry point, the most
 * depended-upon ("foundational") files, and the files with the most
 * outgoing dependencies ("hub"/orchestrator files). Each gets a short
 * description pulled from its most substantial documented class or,
 * failing that, a documented top-level function.
 * Returns [{ file, reason, description }], capped at MAX_CORE_FILES.
 */
function rankCoreFiles(codeFiles, dependencyGraph, setupGuide) {
  const graph    = (dependencyGraph && dependencyGraph.graph) || {};
  const mostUsed = (dependencyGraph && dependencyGraph.mostUsed) || [];
  const entry    = setupGuide && setupGuide.entry_point;

  // file -> best one-line description, from its richest documented
  // class (most methods) or, failing that, a documented top-level function
  const fileDocs = {};
  for (const [file, info] of Object.entries(codeFiles || {})) {
    const summaries = info.summaries || {};
    let best = null;
    for (const cls of (info.classes || [])) {
      const summary = summaries[cls];
      if (!summary) continue;
      const methodCount = ((info.methods || {})[cls] || []).length;
      if (!best || methodCount > best.methodCount) best = { name: cls, summary, methodCount };
    }
    if (!best) {
      for (const fn of (info.functions || [])) {
        if (summaries[fn]) { best = { name: fn, summary: summaries[fn], methodCount: 0 }; break; }
      }
    }
    if (best) fileDocs[file] = best;
  }

  const ranked = [];
  const seen   = new Set();

  function add(file, reason) {
    if (!file || seen.has(file)) return;
    seen.add(file);
    const doc = fileDocs[file];
    ranked.push({ file, reason, description: doc ? `\`${doc.name}\` — ${doc.summary}` : null });
  }

  // Entry point is always the natural starting point
  if (entry && /^[\w./-]+\.\w+$/.test(entry)) add(entry, 'Entry point');

  // Foundational modules — depended on by many other files
  for (const u of mostUsed) {
    add(u.file, `Used by ${u.count} other file${u.count !== 1 ? 's' : ''}`);
    if (ranked.length >= MAX_CORE_FILES) break;
  }

  // Hub/orchestrator modules — depend on many other files themselves
  const byOutgoing = Object.entries(graph)
    .map(([file, deps]) => ({ file, count: deps.length }))
    .filter((x) => x.count >= 2)
    .sort((a, b) => b.count - a.count);
  for (const h of byOutgoing) {
    add(h.file, `Connects to ${h.count} other modules`);
    if (ranked.length >= MAX_CORE_FILES) break;
  }

  return ranked.slice(0, MAX_CORE_FILES);
}
