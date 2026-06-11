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
    methods:   {},
    exports:   [],
    imports:   [],
    summaries: {}
  };

  if (['.js', '.ts', '.mjs', '.cjs', '.jsx', '.tsx'].includes(ext)) {
    analyseJs(content, result);
  } else if (ext === '.py') {
    analysePython(content, result);
  }

  return result;
}

function analyseJs(content, result) {
  const lines = content.split('\n');

  // Named functions
  const fnPattern = /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)/gm;
  let m;
  while ((m = fnPattern.exec(content)) !== null) {
    result.functions.push(m[1]);
    captureJsSummary(result, lines, content, m, m[1]);
  }

  // Arrow / const functions
  const arrowPattern = /^(?:export\s+)?(?:const|let)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:async\s*)?\(/gm;
  while ((m = arrowPattern.exec(content)) !== null) {
    result.functions.push(m[1]);
    captureJsSummary(result, lines, content, m, m[1]);
  }

  // Classes
  const classPattern = /^(?:export\s+)?class\s+([A-Za-z_$][A-Za-z0-9_$]*)/gm;
  while ((m = classPattern.exec(content)) !== null) {
    result.classes.push(m[1]);
    captureJsSummary(result, lines, content, m, m[1]);
  }

  // CommonJS exports — strip comments first so section-header comments
  // like "// Core lifecycle" inside module.exports = {...} aren't
  // mistaken for exported identifier names.
  const cjsExportPattern = /module\.exports\s*=\s*\{([^}]+)\}/s;
  const cjsMatch = cjsExportPattern.exec(content);
  if (cjsMatch) {
    const body = cjsMatch[1]
      .replace(/\/\/.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    const names = body.match(/([A-Za-z_$][A-Za-z0-9_$]*)/g) || [];
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

/**
 * Looks immediately above a function/class declaration for either a
 * /** JSDoc *\/ block or a single // line comment, and stores the
 * first descriptive line as result.summaries[name].
 */
function captureJsSummary(result, lines, content, match, name) {
  if (result.summaries[name]) return; // first match wins
  const lineIdx  = content.slice(0, match.index).split('\n').length - 1;
  const summary  = extractJsCommentSummary(lines, lineIdx);
  if (summary) result.summaries[name] = summary;
}

function extractJsCommentSummary(lines, declarationLineIdx) {
  let i = declarationLineIdx - 1;
  while (i >= 0 && lines[i].trim() === '') i--;
  if (i < 0) return null;
  const trimmed = lines[i].trim();

  // /** JSDoc */ block (single or multi-line)
  if (trimmed.endsWith('*/')) {
    let start = i;
    while (start >= 0 && !/^\/\*\*?/.test(lines[start].trim())) start--;
    if (start < 0) return null;
    for (let j = start; j <= i; j++) {
      const text = lines[j].trim()
        .replace(/^\/\*\*?/, '')
        .replace(/\*\/$/, '')
        .replace(/^\*/, '')
        .trim();
      if (text && !text.startsWith('@')) return text.slice(0, 200);
    }
    return null;
  }

  // Single-line // comment immediately above
  if (trimmed.startsWith('//')) {
    const text = trimmed.replace(/^\/+/, '').trim();
    return text ? text.slice(0, 200) : null;
  }

  return null;
}

function analysePython(content, result) {
  const lines = content.split('\n');
  const defPattern    = /^(\s*)def\s+([A-Za-z_][A-Za-z0-9_]*)/;
  const classPattern  = /^(\s*)class\s+([A-Za-z_][A-Za-z0-9_]*)/;
  const importPattern = /^(?:import|from)\s+([A-Za-z_][A-Za-z0-9_.]*)/;

  let currentClass       = null;
  let currentClassIndent = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const indent = line.length - line.trimStart().length;

    // Dedented past the current class body — exit its scope
    if (currentClass !== null && indent <= currentClassIndent) {
      currentClass       = null;
      currentClassIndent = -1;
    }

    let m = classPattern.exec(line);
    if (m) {
      const name = m[2];
      result.classes.push(name);
      const summary = extractPythonDocstring(lines, i + 1);
      if (summary && !result.summaries[name]) result.summaries[name] = summary;
      currentClass       = name;
      currentClassIndent = m[1].length;
      continue;
    }

    m = defPattern.exec(line);
    if (m) {
      const indentLen = m[1].length;
      const name      = m[2];
      const summary   = extractPythonDocstring(lines, i + 1);

      if (currentClass !== null && indentLen > currentClassIndent) {
        // Method belonging to the current class
        if (!result.methods[currentClass]) result.methods[currentClass] = [];
        result.methods[currentClass].push(name);
        if (summary) result.summaries[`${currentClass}.${name}`] = summary;
      } else if (indentLen === 0) {
        // Top-level function
        result.functions.push(name);
        if (summary && !result.summaries[name]) result.summaries[name] = summary;
      }
      continue;
    }

    m = importPattern.exec(line);
    if (m) result.imports.push(m[1]);
  }

  result.functions = [...new Set(result.functions)].slice(0, 40);
  result.classes   = [...new Set(result.classes)].slice(0, 20);
  result.imports   = [...new Set(result.imports)].slice(0, 30);
  for (const cls of Object.keys(result.methods)) {
    result.methods[cls] = [...new Set(result.methods[cls])].slice(0, 30);
  }
}

/**
 * Looks at the line(s) immediately following a def/class for a
 * triple-quoted docstring and returns its first descriptive line.
 * Handles both one-liners ("""Does X.""") and multi-line docstrings.
 */
function extractPythonDocstring(lines, startIdx) {
  let i = startIdx;
  while (i < lines.length && lines[i].trim() === '') i++;
  if (i >= lines.length) return null;

  const trimmed = lines[i].trim();
  const quoteMatch = /^("""|''')/.exec(trimmed);
  if (!quoteMatch) return null;

  const quote = quoteMatch[1];
  let rest = trimmed.slice(quote.length);

  // One-liner: """Does X."""
  const closeIdx = rest.indexOf(quote);
  if (closeIdx !== -1) {
    const text = rest.slice(0, closeIdx).trim();
    return text ? text.slice(0, 200) : null;
  }

  // Multi-line: first line content, or the next non-empty line
  const firstLine = rest.trim();
  if (firstLine) return firstLine.slice(0, 200);

  if (i + 1 < lines.length) {
    const next = lines[i + 1].trim();
    if (next && !next.startsWith(quote)) return next.slice(0, 200);
  }
  return null;
}

module.exports = {
  captureSnapshot,
  deleteSnapshot,
  getSnapshot,
  readCurrentContent,
  buildCodeFileCatalogue
};
