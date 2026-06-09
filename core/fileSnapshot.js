'use strict';

/**
 * fileSnapshot.js
 * ---------------
 * Maintains an in-memory snapshot of every tracked file's content.
 * The watcher calls captureSnapshot(file) BEFORE a change is processed,
 * so diffTexts() can compare old vs new.
 *
 * Also owns the "code_files" section of state: a catalogue of every
 * tracked source file with its exports, imports, functions and line count.
 */

const fs   = require('fs');
const path = require('path');

const CODE_EXTENSIONS = new Set(['.js', '.ts', '.mjs', '.cjs', '.jsx', '.tsx', '.py', '.go', '.rs', '.java', '.rb', '.php', '.cs', '.swift']);
const MAX_READ_BYTES  = 200_000; // 200 KB per file cap

// In-process store: absolute path → content string
const _snapshots = new Map();

// ─────────────────────────────────────────────────────────────────
//  Snapshot capture / retrieval
// ─────────────────────────────────────────────────────────────────

function captureSnapshot(absolutePath) {
  try {
    const content = readFileSafe(absolutePath);
    _snapshots.set(absolutePath, content);
    return content;
  } catch (_) {
    _snapshots.set(absolutePath, '');
    return '';
  }
}

function getSnapshot(absolutePath) {
  return _snapshots.has(absolutePath) ? _snapshots.get(absolutePath) : null;
}

function readCurrentContent(absolutePath) {
  try {
    return readFileSafe(absolutePath);
  } catch (_) {
    return '';
  }
}

function readFileSafe(absolutePath) {
  const stat = fs.statSync(absolutePath);
  if (stat.size > MAX_READ_BYTES) {
    // Read only the first MAX_READ_BYTES for large files
    const buf = Buffer.alloc(MAX_READ_BYTES);
    const fd  = fs.openSync(absolutePath, 'r');
    fs.readSync(fd, buf, 0, MAX_READ_BYTES, 0);
    fs.closeSync(fd);
    return buf.toString('utf8') + '\n[file truncated]';
  }
  return fs.readFileSync(absolutePath, 'utf8');
}

function deleteSnapshot(absolutePath) {
  _snapshots.delete(absolutePath);
}

// ─────────────────────────────────────────────────────────────────
//  Code file catalogue builder
// ─────────────────────────────────────────────────────────────────

/**
 * For each tracked source file, extract:
 *   - line count
 *   - exported names (JS/TS)
 *   - imported modules
 *   - top-level function names
 *   - class names
 *
 * Returns an object keyed by relative file path.
 */
function buildCodeFileCatalogue(projectRoot, fileList) {
  const resolvedRoot = path.resolve(projectRoot);
  const catalogue    = {};

  for (const relPath of (fileList || [])) {
    const ext = path.extname(relPath).toLowerCase();
    if (!CODE_EXTENSIONS.has(ext)) continue;

    const absPath = path.join(resolvedRoot, relPath);
    let content   = '';
    try { content = readCurrentContent(absPath); } catch (_) { continue; }

    catalogue[relPath] = analyseSourceFile(content, ext);
  }

  return catalogue;
}

function analyseSourceFile(content, ext) {
  const lines    = content.split('\n');
  const result   = {
    lines:     lines.length,
    functions: [],
    classes:   [],
    exports:   [],
    imports:   []
  };

  if (['.js', '.ts', '.mjs', '.cjs', '.jsx', '.tsx'].includes(ext)) {
    analyseJs(content, result);
  } else if (ext === '.py') {
    analysePython(content, result);
  }

  return result;
}

function analyseJs(content, result) {
  // Named functions
  const fnPattern = /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)/gm;
  let m;
  while ((m = fnPattern.exec(content)) !== null) result.functions.push(m[1]);

  // Arrow / const functions
  const arrowPattern = /^(?:export\s+)?(?:const|let)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:async\s*)?\(/gm;
  while ((m = arrowPattern.exec(content)) !== null) result.functions.push(m[1]);

  // Classes
  const classPattern = /^(?:export\s+)?class\s+([A-Za-z_$][A-Za-z0-9_$]*)/gm;
  while ((m = classPattern.exec(content)) !== null) result.classes.push(m[1]);

  // CommonJS exports
  const cjsExportPattern = /module\.exports\s*=\s*\{([^}]+)\}/s;
  const cjsMatch = cjsExportPattern.exec(content);
  if (cjsMatch) {
    const names = cjsMatch[1].match(/([A-Za-z_$][A-Za-z0-9_$]*)/g) || [];
    result.exports.push(...names);
  }

  // ES named exports
  const esExportPattern = /^export\s+(?:const|let|function|class|async)\s+([A-Za-z_$][A-Za-z0-9_$]*)/gm;
  while ((m = esExportPattern.exec(content)) !== null) result.exports.push(m[1]);

  // require() imports
  const requirePattern = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((m = requirePattern.exec(content)) !== null) result.imports.push(m[1]);

  // ES import
  const importPattern = /^import\s+.*\s+from\s+['"]([^'"]+)['"]/gm;
  while ((m = importPattern.exec(content)) !== null) result.imports.push(m[1]);

  // De-dup
  result.functions = [...new Set(result.functions)].slice(0, 40);
  result.classes   = [...new Set(result.classes)].slice(0, 20);
  result.exports   = [...new Set(result.exports)].slice(0, 40);
  result.imports   = [...new Set(result.imports)].slice(0, 30);
}

function analysePython(content, result) {
  const defPattern   = /^def\s+([A-Za-z_][A-Za-z0-9_]*)/gm;
  const classPattern = /^class\s+([A-Za-z_][A-Za-z0-9_]*)/gm;
  const importPattern = /^(?:import|from)\s+([A-Za-z_][A-Za-z0-9_.]*)/gm;
  let m;
  while ((m = defPattern.exec(content))    !== null) result.functions.push(m[1]);
  while ((m = classPattern.exec(content))  !== null) result.classes.push(m[1]);
  while ((m = importPattern.exec(content)) !== null) result.imports.push(m[1]);
  result.functions = [...new Set(result.functions)].slice(0, 40);
  result.classes   = [...new Set(result.classes)].slice(0, 20);
  result.imports   = [...new Set(result.imports)].slice(0, 30);
}

module.exports = {
  captureSnapshot,
  deleteSnapshot,
  getSnapshot,
  readCurrentContent,
  buildCodeFileCatalogue
};