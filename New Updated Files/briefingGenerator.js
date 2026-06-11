'use strict';

/**
 * briefingGenerator.js
 * --------------------
 * Generates .ai-context/briefing.md — a single markdown file
 * that gives any AI assistant a complete, immediate picture
 * of the project: structure, code, errors, fixes, changes,
 * dependencies, routes, and what to work on next.
 *
 * Auto-regenerated on every startup and every file change.
 */

const path = require('path');

// ─────────────────────────────────────────────────────────────────
//  Tree renderer
// ─────────────────────────────────────────────────────────────────

function renderFileTree(tree, prefix, lines) {
  const entries = Object.entries(tree || {});
  entries.forEach(([name, children], idx) => {
    const isLast      = idx === entries.length - 1;
    const connector   = isLast ? '└── ' : '├── ';
    const childPrefix = isLast ? '    ' : '│   ';
    lines.push(prefix + connector + name);
    if (children && typeof children === 'object') {
      renderFileTree(children, prefix + childPrefix, lines);
    }
  });
}

function fileTreeToString(tree) {
  const lines = [];
  renderFileTree(tree, '', lines);
  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────
//  Section builders
// ─────────────────────────────────────────────────────────────────

function sectionHeader(title) {
  return `\n## ${title}\n`;
}

function buildSetupGuide(state) {
  const guide = state.setup_guide || {};
  const lines = [sectionHeader('🧭 Getting Started')];

  if (guide.install) lines.push(`**Install:** \`${guide.install}\``);
  if (guide.run)     lines.push(`**Run:** \`${guide.run}\``);
  if (guide.entry_point) lines.push(`**Entry point:** \`${guide.entry_point}\``);

  const total      = guide.env_total_count || 0;
  const configured = guide.env_configured_count || 0;
  if (total > 0) {
    const icon = configured === total ? '✅' : configured === 0 ? '⚠️' : '🟡';
    lines.push('');
    lines.push(`${icon} **Environment:** ${configured}/${total} required variables configured`);
    if (!guide.env_file_found) {
      lines.push(`   No \`.env\` file found — create one with the variables listed in **Environment Variables** below.`);
    } else if (configured < total) {
      lines.push(`   See **Environment Variables** below for which are missing.`);
    }
  }

  if (lines.length === 1) return ''; // nothing detected
  return lines.join('\n');
}

function buildCodeNotes(state) {
  const notes = state.code_notes || [];
  const lines = [sectionHeader('📌 Developer Notes In Code')];
  lines.push('_TODO/FIXME/HACK/XXX/BUG comments found in source — known gaps or risky areas flagged by past sessions._\n');

  if (notes.length === 0) {
    lines.push('_None found._');
    return lines.join('\n');
  }

  const ICONS = { TODO: '🔧', FIXME: '⚠️', HACK: '🩹', XXX: '❗', BUG: '🐛' };
  for (const n of notes.slice(0, 30)) {
    const icon = ICONS[n.type] || '📝';
    lines.push(`- ${icon} **${n.type}** in \`${n.file}:${n.line}\` — ${n.text}`);
  }
  if (notes.length > 30) lines.push(`\n_...and ${notes.length - 30} more in state.json → code_notes_`);
  return lines.join('\n');
}

function buildDependencyGraphSection(state) {
  const dg       = state.dependency_graph || {};
  const graph    = dg.graph    || {};
  const mostUsed = dg.mostUsed || [];
  const files    = Object.keys(graph);
  if (files.length === 0) return '';

  const lines = [sectionHeader('🕸 Module Dependencies')];
  lines.push('_Internal file relationships — which project files import which other project files (external packages excluded)._\n');

  for (const file of files.slice(0, 40)) {
    lines.push(`- \`${file}\` → ${graph[file].map((d) => `\`${d}\``).join(', ')}`);
  }
  if (files.length > 40) lines.push(`\n_...and ${files.length - 40} more in state.json → dependency_graph_`);

  if (mostUsed.length) {
    lines.push('');
    lines.push('**Most-used internal modules:**');
    for (const u of mostUsed) {
      lines.push(`- \`${u.file}\` — used by ${u.count} file${u.count !== 1 ? 's' : ''}`);
    }
  }
  return lines.join('\n');
}

function buildOverview(state) {
  const ts   = state.tech_stack || {};
  const dbs  = (ts.databases || []).join(', ') || 'None detected';
  const lines = [
    sectionHeader('Project Overview'),
    `| Field | Value |`,
    `|---|---|`,
    `| **Project** | ${state.project} v${state.version} |`,
    `| **Stage** | ${state.current_stage} |`,
    `| **Language** | ${ts.language || '—'} |`,
    `| **Framework** | ${ts.framework || '—'} |`,
    `| **Runtime** | ${ts.runtime || '—'} |`,
    `| **Package Manager** | ${ts.package_manager || '—'} |`,
    `| **TypeScript** | ${ts.typescript ? 'Yes' : 'No'} |`,
    `| **Databases** | ${dbs} |`,
    `| **Test Framework** | ${ts.test_framework || 'None detected'} |`,
    `| **Linter** | ${ts.linter || 'None'} |`,
    `| **Bundler** | ${ts.bundler || 'None'} |`,
    `| **Cloud / Deploy** | ${ts.cloud_platform || 'None detected'} |`,
    `| **Last Updated** | ${state.last_updated} |`,
    '',
    `**Summary:** ${state.ai_summary}`,
    '',
    (state.description ? `**Description:** ${state.description}` : '')
  ];
  return lines.filter((l) => l !== '').join('\n');
}

function buildActiveErrors(state) {
  const errors = (state.issue_tracker || {}).active_errors || [];
  if (errors.length === 0) {
    return sectionHeader('🔴 Active Errors') + '\n_No active errors. All clear._\n';
  }
  const lines = [sectionHeader('🔴 Active Errors (FIX THESE FIRST)')];
  lines.push(`> **${errors.length} open error${errors.length !== 1 ? 's' : ''} — address before any new work.**\n`);
  for (const e of errors) {
    lines.push(`### ${e.id}`);
    lines.push(`- **Message:** ${e.message}`);
    if (e.file)  lines.push(`- **File:** \`${e.file}\``);
    if (e.stack) lines.push(`- **Stack:**\n\`\`\`\n${e.stack.slice(0, 400)}\n\`\`\``);
    lines.push(`- **Recorded:** ${e.timestamp}`);
    lines.push('');
  }
  return lines.join('\n');
}

function buildResolvedIssues(state) {
  const resolved = (state.issue_tracker || {}).resolved_issues || [];
  if (resolved.length === 0) return '';
  const lines = [sectionHeader('✅ Resolved Issues (History)')];
  lines.push('_Read this before writing any fix — these bugs were already solved._\n');
  for (const r of resolved.slice(0, 15)) {
    lines.push(`- **${r.message}**`);
    if (r.file)       lines.push(`  - File: \`${r.file}\``);
    lines.push(`  - Fixed: ${r.resolved_at || r.timestamp}`);
    lines.push(`  - How: ${r.resolution}`);
  }
  if (resolved.length > 15) lines.push(`\n_...and ${resolved.length - 15} more in state.json_`);
  return lines.join('\n');
}

function buildRecentChanges(state) {
  const changes = state.code_changes || [];
  if (changes.length === 0) {
    return sectionHeader('📝 Recent Code Changes') + '\n_No changes recorded yet._\n';
  }
  const lines = [sectionHeader('📝 Recent Code Changes')];
  for (const c of changes.slice(0, 10)) {
    lines.push(`### \`${c.file}\` — ${c.action} — ${c.timestamp}`);
    lines.push(`**${c.summary}**`);
    if (c.signals && c.signals.length) {
      lines.push('');
      lines.push('What changed:');
      for (const sig of c.signals) lines.push(`- ${sig}`);
    }
    if (c.patch && c.patch.length < 2000) {
      lines.push('');
      lines.push('```diff');
      lines.push(c.patch);
      lines.push('```');
    }
    lines.push('');
  }
  if (changes.length > 10) lines.push(`_...and ${changes.length - 10} more in state.json → code_changes_`);
  return lines.join('\n');
}

function buildFileStructure(state) {
  const lines = [sectionHeader('📁 File Structure')];
  lines.push('```');
  lines.push(fileTreeToString(state.file_tree || {}));
  lines.push('```');
  return lines.join('\n');
}

function buildCodeCatalogue(state) {
  const codeFiles = state.code_files || {};
  const files     = Object.keys(codeFiles);
  if (files.length === 0) return '';

  const lines = [sectionHeader('🔍 Code Catalogue')];
  lines.push('_Every source file with what it does — function/class purposes are pulled from docstrings and comments._\n');

  for (const filePath of files) {
    const info = codeFiles[filePath];
    const summaries = info.summaries || {};
    lines.push(`#### \`${filePath}\` (${info.lines} lines)`);

    // Classes — with summary + their methods (with summaries) indented underneath
    if (info.classes && info.classes.length) {
      lines.push(`- **Classes:**`);
      for (const cls of info.classes) {
        const clsSummary = summaries[cls];
        lines.push(`  - \`${cls}\`${clsSummary ? ` — ${clsSummary}` : ''}`);
        const methods = (info.methods && info.methods[cls]) || [];
        for (const method of methods) {
          const methodSummary = summaries[`${cls}.${method}`];
          lines.push(`    - \`${method}()\`${methodSummary ? ` — ${methodSummary}` : ''}`);
        }
      }
    }

    // Top-level functions — with summary where available
    if (info.functions && info.functions.length) {
      const anySummary = info.functions.some((fn) => summaries[fn]);
      if (anySummary) {
        lines.push(`- **Functions:**`);
        for (const fn of info.functions) {
          const fnSummary = summaries[fn];
          lines.push(`  - \`${fn}()\`${fnSummary ? ` — ${fnSummary}` : ''}`);
        }
      } else {
        lines.push(`- **Functions:** ${info.functions.join(', ')}`);
      }
    }

    if (info.exports && info.exports.length) {
      lines.push(`- **Exports:** ${info.exports.join(', ')}`);
    }
    if (info.imports && info.imports.length) {
      lines.push(`- **Imports:** ${info.imports.join(', ')}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

function buildApiRoutes(state) {
  const routes = state.api_routes || [];
  if (routes.length === 0) return '';

  const lines = [sectionHeader('🛤 API Routes')];
  lines.push('| Method | Path | File |');
  lines.push('|---|---|---|');
  for (const r of routes) {
    lines.push(`| \`${r.method}\` | \`${r.path}\` | \`${r.file}\` |`);
  }
  return lines.join('\n');
}

function buildDependencies(state) {
  const deps    = state.dependencies || {};
  const prod    = Object.entries(deps.production  || {});
  const dev     = Object.entries(deps.development || {});
  const scripts = Object.entries(deps.scripts     || {});

  const lines = [sectionHeader('📦 Dependencies & Scripts')];

  if (prod.length) {
    lines.push('**Production:**');
    for (const [name, ver] of prod) lines.push(`- \`${name}\` ${ver}`);
    lines.push('');
  }
  if (dev.length) {
    lines.push('**Development:**');
    for (const [name, ver] of dev) lines.push(`- \`${name}\` ${ver}`);
    lines.push('');
  }
  if (scripts.length) {
    lines.push('**Scripts:**');
    lines.push('| Name | Command |');
    lines.push('|---|---|');
    for (const [name, cmd] of scripts) lines.push(`| \`${name}\` | \`${cmd}\` |`);
  }
  return lines.join('\n');
}

function buildEnvVariables(state) {
  const vars  = state.env_variables || [];
  if (vars.length === 0) return '';

  const guide      = state.setup_guide || {};
  const statusMap  = new Map((guide.env_status || []).map((e) => [e.name, e.configured]));

  const lines = [sectionHeader('🔑 Environment Variables')];
  lines.push('_All env vars referenced in source or .env files. Never invent undocumented ones. Status reflects whether a non-empty value is set in `.env` — values themselves are never read into this file._\n');

  if (statusMap.size > 0) {
    lines.push('| Variable | Status |');
    lines.push('|---|---|');
    for (const v of vars) {
      const configured = statusMap.has(v) ? statusMap.get(v) : false;
      lines.push(`| \`${v}\` | ${configured ? '✅ configured' : '⚠️ not set'} |`);
    }
  } else {
    for (const v of vars) lines.push(`- \`${v}\``);
  }
  return lines.join('\n');
}

function buildArchitecture(state) {
  const patterns = state.architecture_patterns || [];
  const details  = state.implementation_details || [];
  if (!patterns.length && !details.length) return '';

  const lines = [sectionHeader('🏗 Architecture & Implementation')];

  if (patterns.length) {
    lines.push('**Patterns in use:**');
    for (const p of patterns) lines.push(`- ${p}`);
    lines.push('');
  }
  if (details.length) {
    lines.push('**Implementation details:**');
    for (const d of details) lines.push(`- ${d}`);
  }
  return lines.join('\n');
}

function buildKeyFeatures(state) {
  const features = state.key_features || [];
  if (!features.length) return '';

  const lines = [sectionHeader('⚡ Key Features')];
  for (const f of features) lines.push(`- ${f}`);
  return lines.join('\n');
}

function buildWorkingContext(state) {
  const lines = [sectionHeader('🎯 Working Context')];
  let hasContent = false;

  if (state.current_focus) {
    lines.push(`**Current Focus:** ${state.current_focus}`);
    hasContent = true;
  }
  if (state.working_branch) {
    lines.push(`**Branch:** \`${state.working_branch}\``);
    hasContent = true;
  }

  const questions = state.open_questions || [];
  if (questions.length) {
    lines.push('');
    lines.push('**Open Questions:**');
    for (const q of questions) {
      lines.push(`- ${typeof q === 'string' ? q : q.question}`);
    }
    hasContent = true;
  }

  const decisions = state.decisions_made || [];
  if (decisions.length) {
    lines.push('');
    lines.push('**Decisions Made (do not contradict these):**');
    for (const d of decisions) {
      lines.push(`- ${typeof d === 'string' ? d : d.decision}`);
    }
    hasContent = true;
  }

  const notes = state.session_notes || [];
  if (notes.length) {
    lines.push('');
    lines.push('**Session Notes:**');
    for (const n of notes.slice(0, 5)) {
      lines.push(`- ${typeof n === 'string' ? n : n.note}`);
    }
    hasContent = true;
  }

  return hasContent ? lines.join('\n') : '';
}

function buildNextSteps(state) {
  const steps  = state.next_steps   || [];
  const issues = state.known_issues || [];
  if (!steps.length && !issues.length) return '';

  const lines = [sectionHeader('🚀 What To Do Next')];

  if (issues.length) {
    lines.push('**Known issues to resolve:**');
    for (const i of issues) lines.push(`- ⚠️ ${i}`);
    lines.push('');
  }
  if (steps.length) {
    lines.push('**Recommended next steps:**');
    for (const s of steps) lines.push(`- ${s}`);
  }
  return lines.join('\n');
}

function buildInstructions() {
  return [
    sectionHeader('📋 Instructions For The AI Reading This'),
    '1. Read **Getting Started** to know how to install and run this project.',
    '2. Read **Active Errors** first — fix those before anything else.',
    '3. Read **Resolved Issues** before writing any fix — avoid re-introducing old bugs.',
    '4. Read **Developer Notes In Code** for TODO/FIXME/HACK markers left by past sessions.',
    '5. Read **Recent Code Changes** to understand what just changed and why.',
    '6. Read **Code Catalogue** to know what each file/function/class does before calling anything.',
    '7. Read **Module Dependencies** to understand how files connect before moving code around.',
    '8. Read **API Routes** before adding or changing any endpoint.',
    '9. Read **Dependencies** before suggesting `npm install` — the package may already exist.',
    '10. Read **Working Context** to understand the current focus and locked-in decisions.',
    '11. Read **What To Do Next** for prioritised next actions.',
    '',
    '> This file is auto-generated by aibridge-context on every startup and file change.',
    '> Do not edit it manually — changes will be overwritten.',
    '> The full machine-readable state is in `.ai-context/state.json`.',
  ].join('\n');
}

// ─────────────────────────────────────────────────────────────────
//  Main generator
// ─────────────────────────────────────────────────────────────────

function generateBriefing(state, projectRoot) {
  const now       = new Date().toISOString();
  const projName  = state.project || path.basename(projectRoot || process.cwd());

  const sections = [
    `# AI Briefing — ${projName}`,
    '',
    `> **Auto-generated by aibridge-context** | Last updated: ${now}`,
    `> Paste this file into any AI assistant to immediately brief it on the full project state.`,
    '',
    buildInstructions(),
    buildOverview(state),
    buildSetupGuide(state),
    buildActiveErrors(state),
    buildResolvedIssues(state),
    buildCodeNotes(state),
    buildNextSteps(state),
    buildWorkingContext(state),
    buildRecentChanges(state),
    buildFileStructure(state),
    buildDependencyGraphSection(state),
    buildCodeCatalogue(state),
    buildApiRoutes(state),
    buildDependencies(state),
    buildEnvVariables(state),
    buildArchitecture(state),
    buildKeyFeatures(state),
    '',
    '---',
    `_Generated by [aibridge-context](https://github.com/npm/aibridge-context) • ${now}_`,
  ];

  return sections.filter((s) => s !== null && s !== undefined).join('\n');
}

module.exports = { generateBriefing };
