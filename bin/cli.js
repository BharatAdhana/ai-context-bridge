#!/usr/bin/env node
'use strict';

/**
 * cli.js — aibridge-context
 *
 * One command to rule them all:
 *   npx aibridge-context start
 *
 * That single command:
 *   1. Auto-inits .ai-context/ if it doesn't exist yet
 *   2. Scans the whole project and builds state.json, changelog.json,
 *      brain.txt, context.md, and briefing.md
 *   3. Starts the file watcher (real diffs on every save)
 *   4. Starts the local HTTP server (port 3333)
 *   5. Auto-syncs to GitHub if a remote is already configured
 *   6. Regenerates briefing.md on every file change automatically
 *
 * Other commands:
 *   error   <msg>     Record an active error
 *   fix     <msg>     Mark an error resolved
 *   note    <text>    Append a session note
 *   focus   <text>    Set current_focus
 *   decide  <text>    Record an architectural decision
 *   question <text>   Add an open question
 *   status            Print a summary
 *   briefing          Print the path to briefing.md
 */

const path     = require('path');
const fs       = require('fs');
const fsp      = require('fs/promises');
const readline = require('readline');

const projectRoot = process.cwd();

function sm()    { return require('../core/stateManager'); }
function initer(){ return require('../core/init'); }
function gs()    { return require('../core/gitSync'); }

// ─────────────────────────────────────────────────────────────────
//  Argument parsing
// ─────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = argv.slice(2);
  const cmd  = args[0] || 'help';
  const flags = {};
  const pos   = [];
  for (let i = 1; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      flags[key] = (args[i+1] && !args[i+1].startsWith('--')) ? args[++i] : true;
    } else {
      pos.push(args[i]);
    }
  }
  return { cmd, positional: pos, flags };
}

// ─────────────────────────────────────────────────────────────────
//  Logger
// ─────────────────────────────────────────────────────────────────

const logger = require('../utils/logger').createLogger({ level: 'info' });

// ─────────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────────

async function readState() {
  const { getContextPaths, readJsonFile } = sm();
  return readJsonFile(getContextPaths(projectRoot).stateFile, null);
}

async function patchState(patchFn) {
  const { getContextPaths, readJsonFile, writeJsonAtomic } = sm();
  const paths = getContextPaths(projectRoot);
  const state = await readJsonFile(paths.stateFile, null);
  if (!state) {
    logger.error('No .ai-context/state.json found. Run: npx aibridge-context start');
    process.exit(1);
  }
  const next = patchFn(state);
  await writeJsonAtomic(paths.stateFile, next);
  // Regenerate briefing after any patch
  try {
    const { generateBriefing } = require('../core/briefingGenerator');
    const { writeTextAtomic }  = sm();
    await writeTextAtomic(paths.briefingFile, generateBriefing(next, projectRoot));
  } catch (_) {}
  return next;
}

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => { rl.question(question, (a) => { rl.close(); resolve(a.trim()); }); });
}

function contextExists() {
  const { getContextPaths } = sm();
  return fs.existsSync(getContextPaths(projectRoot).stateFile);
}

// ─────────────────────────────────────────────────────────────────
//  Auto-init (runs silently inside start if .ai-context missing)
// ─────────────────────────────────────────────────────────────────

async function autoInit() {
  logger.info('No .ai-context/ found — initialising automatically…');
  const { initProject } = initer();
  const result = await initProject(projectRoot, {
    logger,
    force: false,
    requestPublicSyncConsent: false   // silent auto-init, no public sync prompt
  });
  logger.info(`✅ Auto-initialised: ${result.metadata.project} v${result.metadata.version}`);
  logger.info(`   Stack: ${result.metadata.stackLabel}`);
  return result;
}

// ─────────────────────────────────────────────────────────────────
//  Auto GitHub sync check
// ─────────────────────────────────────────────────────────────────

async function autoGitSync(config) {
  // If sync already enabled, nothing to do — gitSync.js handles it
  if (config.gitSync && config.gitSync.enabled) return;

  // Check if a git remote exists and offer to enable
  try {
    const { getRemoteOriginUrl } = gs();
    const remoteUrl = await getRemoteOriginUrl(projectRoot);
    if (!remoteUrl) return; // no remote, skip silently

    logger.info(`💡 Git remote found: ${remoteUrl}`);
    logger.info('   Run: npx aibridge-context link-github  to enable public AI sync');
  } catch (_) {}
}

// ─────────────────────────────────────────────────────────────────
//  START — the main command, does everything automatically
// ─────────────────────────────────────────────────────────────────

async function cmdStart() {
  // ── Step 1: Auto-init if needed ────────────────────────────────
  if (!contextExists()) {
    await autoInit();
  }

  const { startWatcher } = require('../core/watcher');
  const { startServer }  = require('../server/server');
  const config = await sm().loadRuntimeConfig(projectRoot);

  // ── Step 2: Check git sync ──────────────────────────────────────
  await autoGitSync(config);

  // ── Step 3: Start watcher + server in parallel ──────────────────
  logger.info('Starting watcher and server…');
  const [watcherHandle, serverHandle] = await Promise.all([
    startWatcher(projectRoot, { logger }),
    startServer({ port: config.port, projectRoot, logger })
  ]);

  // ── Step 4: Print status ────────────────────────────────────────
  const { getContextPaths } = sm();
  const paths = getContextPaths(projectRoot);

  logger.info('');
  logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  logger.info('  ✅ aibridge-context running');
  logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  logger.info('');
  logger.info('  📄 AI Briefing (paste into any AI):');
  logger.info(`     ${paths.briefingFile}`);
  logger.info(`     http://localhost:${config.port}/briefing.md`);
  logger.info('');
  logger.info('  🌐 All endpoints:');
  logger.info(`     http://localhost:${config.port}/briefing.md    ← start here`);
  logger.info(`     http://localhost:${config.port}/state.json`);
  logger.info(`     http://localhost:${config.port}/changelog.json`);
  logger.info(`     http://localhost:${config.port}/brain.txt`);
  logger.info(`     http://localhost:${config.port}/context.md`);
  logger.info('');
  logger.info('  🔄 Watching for file changes — briefing.md auto-updates on every save');
  if (config.gitSync && config.gitSync.enabled) {
    logger.info('  ☁️  GitHub sync enabled — changes push automatically');
  }
  logger.info('');
  logger.info('  Press Ctrl+C to stop');
  logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // ── Step 5: Graceful shutdown ───────────────────────────────────
  async function shutdown() {
    logger.info('\nShutting down…');
    await watcherHandle.close();
    await serverHandle.close();
    process.exit(0);
  }
  process.on('SIGINT',  shutdown);
  process.on('SIGTERM', shutdown);
}

// ─────────────────────────────────────────────────────────────────
//  INIT (explicit, with GitHub consent prompt)
// ─────────────────────────────────────────────────────────────────

async function cmdInit() {
  const { initProject } = initer();
  const result = await initProject(projectRoot, {
    logger,
    force: false,
    requestPublicSyncConsent: true,
    promptForPublicSyncConsent: async () => {
      const answer = await prompt('Enable GitHub sync? This makes your context PUBLIC. (y/N): ');
      return answer.toLowerCase() === 'y';
    }
  });
  const { getContextPaths } = sm();
  const paths = getContextPaths(projectRoot);
  logger.info('');
  logger.info(`✅ Initialised: ${result.metadata.project} v${result.metadata.version}`);
  logger.info(`   Stack:    ${result.metadata.stackLabel}`);
  logger.info(`   Briefing: ${paths.briefingFile}`);
  logger.info('');
  logger.info('Tip: Create a .aibridge-ignore file to exclude runtime folders from scanning.');
  logger.info('Next step:  npx aibridge-context start');
}

// ─────────────────────────────────────────────────────────────────
//  UPDATE
// ─────────────────────────────────────────────────────────────────

async function cmdUpdate() {
  const { updateProjectState } = sm();
  logger.info('Refreshing AI context…');
  const state = await updateProjectState(
    projectRoot,
    { timestamp: new Date().toISOString(), action: 'manual_update', file: '.' },
    { logger }
  );
  const { getContextPaths } = sm();
  logger.info(`✅ Done — ${state.file_list.length} files tracked`);
  logger.info(`   Briefing updated: ${getContextPaths(projectRoot).briefingFile}`);
}

// ─────────────────────────────────────────────────────────────────
//  LINK GITHUB
// ─────────────────────────────────────────────────────────────────

async function cmdLinkGithub() {
  const repoUrl = await prompt('GitHub repository URL (e.g. https://github.com/user/repo): ');
  if (!repoUrl) { logger.error('No URL provided.'); process.exit(1); }

  logger.info('Linking GitHub repository…');
  const { linkGithubRepository } = gs();
  const result = await linkGithubRepository(projectRoot, repoUrl, logger);

  if (result.ok) {
    await sm().updateRuntimeConfig(projectRoot, { gitSync: { enabled: true, repoUrl } });
    logger.info('✅ Linked and sync enabled');
    if (result.urls) {
      logger.info('');
      logger.info('  Share this with any AI:');
      logger.info(`  "${result.urls.stateUrl}"`);
    }
  } else {
    logger.error(`Failed: ${result.error}`);
  }
}

// ─────────────────────────────────────────────────────────────────
//  BRIEFING — just print the path
// ─────────────────────────────────────────────────────────────────

async function cmdBriefing() {
  const { getContextPaths } = sm();
  const paths = getContextPaths(projectRoot);
  if (!fs.existsSync(paths.briefingFile)) {
    logger.error('briefing.md not found. Run: npx aibridge-context start');
    process.exit(1);
  }
  console.log('');
  console.log('📄 AI Briefing file:');
  console.log(`   ${paths.briefingFile}`);
  console.log('');
  console.log('   Open this file and paste its contents into any AI assistant.');
  console.log('   It contains everything the AI needs to know about your project.');
  console.log('');
  if (fs.existsSync(paths.stateFile)) {
    try {
      const state = JSON.parse(fs.readFileSync(paths.stateFile, 'utf8'));
      const errs  = (state.issue_tracker || {}).active_errors || [];
      if (errs.length > 0) {
        console.log(`   ⚠️  ${errs.length} active error(s) recorded. AI will see these first.`);
      }
    } catch (_) {}
  }
}

// ─────────────────────────────────────────────────────────────────
//  ERROR / FIX
// ─────────────────────────────────────────────────────────────────

async function cmdError(positional, flags) {
  const message = positional.join(' ') || flags.message;
  if (!message) {
    logger.error('Usage: npx aibridge-context error "<message>" [--file <path>] [--stack "<trace>"]');
    process.exit(1);
  }
  await sm().updateProjectState(projectRoot, [{
    type:      'error',
    timestamp: new Date().toISOString(),
    message,
    file:      flags.file  || '',
    stack:     flags.stack || ''
  }], { logger });
  logger.info(`🔴 Error recorded: "${message}"`);
  logger.info('   Run "npx aibridge-context status" to see all active errors.');
}

async function cmdFix(positional, flags) {
  const message    = positional.join(' ') || flags.message;
  const resolution = flags.resolution || flags.r || 'Fixed';
  if (!message && !flags.id) {
    logger.error('Usage: npx aibridge-context fix "<message>" --resolution "<what fixed it>"');
    process.exit(1);
  }
  await sm().updateProjectState(projectRoot, [{
    type:       'resolve',
    timestamp:  new Date().toISOString(),
    message,
    errorId:    flags.id   || undefined,
    file:       flags.file || '',
    resolution
  }], { logger });
  logger.info(`✅ Resolved: "${message}"`);
  if (resolution !== 'Fixed') logger.info(`   Fix: ${resolution}`);
}

// ─────────────────────────────────────────────────────────────────
//  NOTE / FOCUS / DECIDE / QUESTION
// ─────────────────────────────────────────────────────────────────

async function cmdNote(positional) {
  const text = positional.join(' ');
  if (!text) { logger.error('Usage: npx aibridge-context note "<text>"'); process.exit(1); }
  await patchState((s) => Object.assign({}, s, {
    session_notes: [{ timestamp: new Date().toISOString(), note: text }, ...(s.session_notes||[])].slice(0,50)
  }));
  logger.info(`📝 Note saved: "${text}"`);
}

async function cmdFocus(positional) {
  const text = positional.join(' ');
  if (!text) { logger.error('Usage: npx aibridge-context focus "<text>"'); process.exit(1); }
  await patchState((s) => Object.assign({}, s, { current_focus: text }));
  logger.info(`🎯 Focus: "${text}"`);
}

async function cmdDecide(positional) {
  const text = positional.join(' ');
  if (!text) { logger.error('Usage: npx aibridge-context decide "<text>"'); process.exit(1); }
  await patchState((s) => Object.assign({}, s, {
    decisions_made: [{ timestamp: new Date().toISOString(), decision: text }, ...(s.decisions_made||[])].slice(0,50)
  }));
  logger.info(`📌 Decision: "${text}"`);
}

async function cmdQuestion(positional) {
  const text = positional.join(' ');
  if (!text) { logger.error('Usage: npx aibridge-context question "<text>"'); process.exit(1); }
  await patchState((s) => Object.assign({}, s, {
    open_questions: [{ timestamp: new Date().toISOString(), question: text }, ...(s.open_questions||[])].slice(0,30)
  }));
  logger.info(`❓ Question: "${text}"`);
}

// ─────────────────────────────────────────────────────────────────
//  STATUS
// ─────────────────────────────────────────────────────────────────

async function cmdStatus() {
  const state = await readState();
  if (!state) {
    logger.error('No .ai-context/state.json found. Run: npx aibridge-context start');
    process.exit(1);
  }
  const it     = state.issue_tracker || {};
  const active = (it.active_errors   || []).length;
  const fixed  = (it.resolved_issues || []).length;
  const { getContextPaths } = sm();

  console.log('');
  console.log(`📦  ${state.project}  v${state.version}  [${state.current_stage}]`);
  console.log(`    ${state.ai_summary}`);
  console.log('');
  console.log(`🗂   Files tracked:   ${(state.file_list||[]).length}`);
  console.log(`🔀  Code changes:    ${(state.code_changes||[]).length}`);
  console.log(`🛤   API routes:      ${(state.api_routes||[]).length}`);
  console.log(`📦  Dependencies:    ${Object.keys((state.dependencies||{}).production||{}).length} prod`);
  console.log('');
  console.log(`🔴  Active errors:   ${active}`);
  for (const e of (it.active_errors||[]).slice(0,5)) {
    console.log(`    • [${e.id}] ${e.message}${e.file ? ' ('+e.file+')' : ''}`);
  }
  console.log(`✅  Resolved issues: ${fixed}`);
  console.log('');
  if (state.current_focus)  console.log(`🎯  Focus:   ${state.current_focus}`);
  if (state.working_branch) console.log(`🌿  Branch:  ${state.working_branch}`);

  const qs = state.open_questions || [];
  if (qs.length) {
    console.log(`❓  Open questions:`);
    for (const q of qs.slice(0,3)) console.log(`    • ${typeof q==='string'?q:q.question}`);
  }
  const recent = state.recent_updates || [];
  if (recent.length) {
    console.log('');
    console.log(`📝  Recent changes:`);
    for (const u of recent.slice(0,4)) {
      console.log(`    • ${u.summary}`);
      for (const s of (u.signals||[]).slice(0,2)) console.log(`        ${s}`);
    }
  }
  console.log('');
  console.log(`📄  Briefing: ${getContextPaths(projectRoot).briefingFile}`);
  console.log('');
}

// ─────────────────────────────────────────────────────────────────
//  HELP
// ─────────────────────────────────────────────────────────────────

function printHelp() {
  console.log(`
aibridge-context — AI context bridge

USAGE
  npx aibridge-context <command>

MAIN COMMAND (does everything automatically)
  start              Auto-init if needed, start watcher + server,
                     generate briefing.md, watch for changes

OTHER COMMANDS
  init               Explicit init with GitHub sync prompt
  update             Manual context refresh
  link-github        Link GitHub remote, enable public sync
  briefing           Show path to the AI briefing file
  status             Summary of current project state

ISSUE TRACKING
  error  "<msg>"     Record an active error
         --file <path>
         --stack "<trace>"
  fix    "<msg>"     Resolve a recorded error
         --resolution "<what fixed it>"

WORKING CONTEXT
  focus    "<text>"  Set what you are working on right now
  decide   "<text>"  Record an architectural decision
  question "<text>"  Add an open question
  note     "<text>"  Append a session note

HOW TO USE WITH AN AI
  1. Run:  npx aibridge-context start
  2. Open: .ai-context/briefing.md
  3. Copy the entire file and paste it into any AI chat
  4. The AI now knows everything about your project
  `);
}

// ─────────────────────────────────────────────────────────────────
//  Entry point
// ─────────────────────────────────────────────────────────────────

(async () => {
  const { cmd, positional, flags } = parseArgs(process.argv);
  try {
    switch (cmd) {
      case 'start':        await cmdStart();                    break;
      case 'init':         await cmdInit();                     break;
      case 'update':       await cmdUpdate();                   break;
      case 'link-github':  await cmdLinkGithub();               break;
      case 'briefing':     await cmdBriefing();                 break;
      case 'status':       await cmdStatus();                   break;
      case 'error':        await cmdError(positional, flags);   break;
      case 'fix':          await cmdFix(positional, flags);     break;
      case 'note':         await cmdNote(positional);           break;
      case 'focus':        await cmdFocus(positional);          break;
      case 'decide':       await cmdDecide(positional);         break;
      case 'question':     await cmdQuestion(positional);       break;
      case 'help':
      case '--help':
      case '-h':           printHelp();                         break;
      default:
        logger.error(`Unknown command: "${cmd}"`);
        printHelp();
        process.exit(1);
    }
  } catch (err) {
    logger.error(`Failed: ${err.message}`);
    if (process.env.DEBUG) console.error(err.stack);
    process.exit(1);
  }
})();