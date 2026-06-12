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
  buildSetupGuide
};
