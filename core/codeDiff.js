'use strict';

/**
 * codeDiff.js
 * -----------
 * Pure-JS line-level diff engine. No external deps.
 * Produces a unified-diff-style patch and a human summary
 * of what exactly changed in a file between two snapshots.
 */

const MAX_DIFF_LINES = 120; // cap stored diff size

/**
 * Myers diff – returns array of { op: 'eq'|'add'|'del', line }
 */
function myersDiff(oldLines, newLines) {
  const N = oldLines.length;
  const M = newLines.length;
  const MAX = N + M;
  if (MAX === 0) return [];

  const v = new Array(2 * MAX + 1).fill(0);
  const trail = [];

  for (let d = 0; d <= MAX; d++) {
    const snapshot = v.slice();
    trail.push(snapshot);

    for (let k = -d; k <= d; k += 2) {
      let x;
      if (k === -d || (k !== d && v[k - 1 + MAX] < v[k + 1 + MAX])) {
        x = v[k + 1 + MAX];
      } else {
        x = v[k - 1 + MAX] + 1;
      }
      let y = x - k;
      while (x < N && y < M && oldLines[x] === newLines[y]) { x++; y++; }
      v[k + MAX] = x;
      if (x >= N && y >= M) {
        return buildOps(trail, d, oldLines, newLines, MAX);
      }
    }
  }
  return buildOps(trail, MAX, oldLines, newLines, MAX);
}

function buildOps(trail, d, oldLines, newLines, MAX) {
  const ops = [];
  let x = oldLines.length;
  let y = newLines.length;

  for (let step = d; step > 0; step--) {
    const v = trail[step];
    const k = x - y;
    const prevK = (k === -step || (k !== step && v[k - 1 + MAX] < v[k + 1 + MAX]))
      ? k + 1 : k - 1;
    const prevX = v[prevK + MAX];
    const prevY = prevX - prevK;

    while (x > prevX + (x - prevX - (y - prevY)) && y > prevY + (y - prevY - (x - prevX))) {
      ops.unshift({ op: 'eq', line: oldLines[x - 1] });
      x--; y--;
    }

    if (step > 0) {
      if (x === prevX) {
        ops.unshift({ op: 'add', line: newLines[y - 1] });
        y--;
      } else {
        ops.unshift({ op: 'del', line: oldLines[x - 1] });
        x--;
      }
    }
  }

  while (x > 0) { ops.unshift({ op: 'eq', line: oldLines[x - 1] }); x--; }
  return ops;
}

/**
 * Produce a compact unified diff string from old/new text.
 * Returns { patch, linesAdded, linesRemoved, summary }
 */
function diffTexts(oldText, newText, filePath) {
  const oldLines = (oldText || '').split('\n');
  const newLines = (newText || '').split('\n');

  let linesAdded   = 0;
  let linesRemoved = 0;
  const patchLines = [`--- ${filePath}`, `+++ ${filePath}`];

  // Use simpler LCS approach for large files to stay fast
  if (oldLines.length + newLines.length > 2000) {
    // Fast path: just count added/removed, no full diff
    const oldSet = new Set(oldLines);
    const newSet = new Set(newLines);
    linesAdded   = newLines.filter((l) => !oldSet.has(l)).length;
    linesRemoved = oldLines.filter((l) => !newSet.has(l)).length;
    return {
      patch:        `[diff too large – ${linesAdded} lines added, ${linesRemoved} lines removed]`,
      linesAdded,
      linesRemoved,
      summary:      buildSummary(linesAdded, linesRemoved, filePath)
    };
  }

  const ops = myersDiff(oldLines, newLines);
  const CONTEXT = 3;
  const hunks   = [];
  let hunk      = null;
  let oldLine   = 1;
  let newLine   = 1;
  let pending   = [];

  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];

    if (op.op === 'eq') {
      if (hunk) {
        pending.push({ op, oldLine, newLine });
        if (pending.length > CONTEXT * 2) {
          // Flush context
          for (let j = 0; j < CONTEXT; j++) hunk.lines.push(` ${pending[j].op.line}`);
          hunks.push(hunk);
          hunk    = null;
          pending = pending.slice(pending.length - CONTEXT);
        }
      } else {
        pending.push({ op, oldLine, newLine });
        if (pending.length > CONTEXT) pending.shift();
      }
      oldLine++; newLine++;
    } else {
      if (!hunk) {
        const startOld = Math.max(1, oldLine - pending.length);
        const startNew = Math.max(1, newLine - pending.length);
        hunk = { startOld, startNew, oldCount: 0, newCount: 0, lines: [] };
        for (const p of pending) hunk.lines.push(` ${p.op.line}`);
        pending = [];
      }
      if (op.op === 'add') {
        hunk.lines.push(`+${op.line}`);
        hunk.newCount++;
        linesAdded++;
        newLine++;
      } else {
        hunk.lines.push(`-${op.line}`);
        hunk.oldCount++;
        linesRemoved++;
        oldLine++;
      }
    }
  }

  if (hunk) {
    for (let j = 0; j < Math.min(CONTEXT, pending.length); j++) {
      hunk.lines.push(` ${pending[j].op.line}`);
    }
    hunks.push(hunk);
  }

  let totalLines = 0;
  for (const h of hunks) {
    const oldCount = (h.lines.filter((l) => l[0] !== '+').length);
    const newCount = (h.lines.filter((l) => l[0] !== '-').length);
    patchLines.push(`@@ -${h.startOld},${oldCount} +${h.startNew},${newCount} @@`);
    for (const line of h.lines) {
      patchLines.push(line);
      totalLines++;
      if (totalLines >= MAX_DIFF_LINES) {
        patchLines.push(`[... diff truncated at ${MAX_DIFF_LINES} lines ...]`);
        break;
      }
    }
    if (totalLines >= MAX_DIFF_LINES) break;
  }

  return {
    patch:        patchLines.join('\n'),
    linesAdded,
    linesRemoved,
    summary:      buildSummary(linesAdded, linesRemoved, filePath)
  };
}

function buildSummary(added, removed, filePath) {
  const parts = [];
  if (added   > 0) parts.push(`+${added} line${added   !== 1 ? 's' : ''}`);
  if (removed > 0) parts.push(`-${removed} line${removed !== 1 ? 's' : ''}`);
  if (parts.length === 0) return `No line changes in ${filePath}`;
  return `${filePath}: ${parts.join(', ')}`;
}

function extractPySignals(patch, signals) {
  const addedLines   = patch.split('\n').filter((l) => l.startsWith('+')).map((l) => l.slice(1));
  const removedLines = patch.split('\n').filter((l) => l.startsWith('-')).map((l) => l.slice(1));

  // Functions added/removed
  const defPattern = /^def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/;
  for (const line of addedLines) {
    const m = defPattern.exec(line);
    if (m) signals.push(`Added function \`${m[1]}\``);
  }
  for (const line of removedLines) {
    const m = defPattern.exec(line);
    if (m) signals.push(`Removed function \`${m[1]}\``);
  }

  // Classes added/removed
  const classPattern = /^class\s+([A-Za-z_][A-Za-z0-9_]*)/;
  for (const line of addedLines) {
    const m = classPattern.exec(line);
    if (m) signals.push(`Added class \`${m[1]}\``);
  }
  for (const line of removedLines) {
    const m = classPattern.exec(line);
    if (m) signals.push(`Removed class \`${m[1]}\``);
  }

  // Import changes
  const importPattern = /^(?:import|from)\s+([A-Za-z_][A-Za-z0-9_.]*)/;
  for (const line of addedLines) {
    const m = importPattern.exec(line);
    if (m) signals.push(`Added import \`${m[1]}\``);
  }
  for (const line of removedLines) {
    const m = importPattern.exec(line);
    if (m) signals.push(`Removed import \`${m[1]}\``);
  }

  // Decorators
  if (addedLines.some((l) => /^@/.test(l.trim()))) signals.push('Added decorator');

  // Async
  if (addedLines.some((l) => /\basync\s+def\b/.test(l))) signals.push('Added async function');

  // Error handling
  if (addedLines.some((l) => /^\s*(?:try:|except[\s:])/.test(l))) signals.push('Added error handling');

  // Type hints
  if (addedLines.some((l) => /\)\s*->\s*\w/.test(l))) signals.push('Added return type hint');
}

/**
 * Extract meaningful code-level signals from a diff patch.
 * Returns array of human-readable strings like:
 *   "Added function buildFileTree"
 *   "Removed call to syncContextToGit"
 *   "Modified exports block"
 */
function extractCodeSignals(patch, filePath) {
  if (!patch || typeof patch !== 'string') return [];
  const signals = [];
  const ext     = (filePath || '').split('.').pop().toLowerCase();

  if (['js', 'ts', 'mjs', 'cjs'].includes(ext)) {
    extractJsSignals(patch, signals);
  } else if (ext === 'py') {
    extractPySignals(patch, signals);
  } else if (ext === 'json') {
    extractJsonSignals(patch, signals, filePath);
  } else if (ext === 'md') {
    signals.push('Documentation updated');
  }

  return uniqueSignals(signals);
}

function extractJsSignals(patch, signals) {
  const addedLines   = patch.split('\n').filter((l) => l.startsWith('+')).map((l) => l.slice(1));
  const removedLines = patch.split('\n').filter((l) => l.startsWith('-')).map((l) => l.slice(1));

  // Functions added/removed
  const fnPattern = /\bfunction\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/;
  const arrowFn   = /\b(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:async\s*)?\(/;
  const methodFn  = /\b([A-Za-z_$][A-Za-z0-9_$]*)\s*\(.*\)\s*\{/;

  for (const line of addedLines) {
    const m = fnPattern.exec(line) || arrowFn.exec(line);
    if (m) signals.push(`Added function \`${m[1]}\``);
  }
  for (const line of removedLines) {
    const m = fnPattern.exec(line) || arrowFn.exec(line);
    if (m) signals.push(`Removed function \`${m[1]}\``);
  }

  // require/import changes
  const reqPattern = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/;
  for (const line of addedLines) {
    const m = reqPattern.exec(line);
    if (m) signals.push(`Added dependency on \`${m[1]}\``);
  }
  for (const line of removedLines) {
    const m = reqPattern.exec(line);
    if (m) signals.push(`Removed dependency on \`${m[1]}\``);
  }

  // exports changes
  const exportsAdded   = addedLines.some((l) => /module\.exports|exports\./.test(l));
  const exportsRemoved = removedLines.some((l) => /module\.exports|exports\./.test(l));
  if (exportsAdded || exportsRemoved) signals.push('Modified module exports');

  // Const/let additions
  const constPattern = /\b(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=/;
  for (const line of addedLines.slice(0, 20)) {
    const m = constPattern.exec(line);
    if (m && !signals.some((s) => s.includes(m[1]))) {
      signals.push(`Added \`${m[1]}\``);
    }
  }

  // Error handling
  if (addedLines.some((l) => /try\s*\{|catch\s*\(/.test(l))) signals.push('Added error handling');
  if (addedLines.some((l) => /throw\s+new/.test(l)))         signals.push('Added throw statement');

  // Async/await
  if (addedLines.some((l) => /\basync\b/.test(l))) signals.push('Added async logic');

  // Route definitions
  const routePattern = /\b(?:router|app)\.(get|post|put|patch|delete)\s*\(\s*['"`]([^'"`]+)['"`]/;
  for (const line of addedLines) {
    const m = routePattern.exec(line);
    if (m) signals.push(`Added route ${m[1].toUpperCase()} ${m[2]}`);
  }
  for (const line of removedLines) {
    const m = routePattern.exec(line);
    if (m) signals.push(`Removed route ${m[1].toUpperCase()} ${m[2]}`);
  }
}

function extractJsonSignals(patch, signals, filePath) {
  if (filePath && filePath.includes('package.json')) {
    const addedLines   = patch.split('\n').filter((l) => l.startsWith('+')).map((l) => l.slice(1));
    const removedLines = patch.split('\n').filter((l) => l.startsWith('-')).map((l) => l.slice(1));
    const pkgPattern   = /"([a-z@][a-z0-9@/_-]*)"\s*:/;
    for (const line of addedLines) {
      const m = pkgPattern.exec(line);
      if (m && !m[1].startsWith('name') && !m[1].startsWith('version')) {
        signals.push(`Added package \`${m[1]}\``);
      }
    }
    for (const line of removedLines) {
      const m = pkgPattern.exec(line);
      if (m) signals.push(`Removed package \`${m[1]}\``);
    }
    if (addedLines.some((l) => /"version"/.test(l))) signals.push('Version bumped');
  } else {
    signals.push('Config/data file updated');
  }
}

function uniqueSignals(signals) {
  return Array.from(new Set(signals)).slice(0, 10);
}

module.exports = { diffTexts, extractCodeSignals };