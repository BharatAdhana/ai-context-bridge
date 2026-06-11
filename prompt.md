We're integrating aibridge-context v2.1.0. Six files changed: 
core/codeDiff.js, core/fileSnapshot.js, core/stateManager.js, 
core/briefingGenerator.js, package.json (all REPLACE existing), 
and core/codeIntel.js (NEW file).

I've attached all 6 files. Do this in order:

STEP 1 — Replace/create the files
- Replace core/codeDiff.js with the new version
- Replace core/fileSnapshot.js with the new version
- Replace core/stateManager.js with the new version
- Replace core/briefingGenerator.js with the new version
- Replace package.json with the new version (version 2.1.0)
- Create core/codeIntel.js (new file)

STEP 2 — Verify everything loads
Run:
  node -e "require('./index.js'); console.log('OK')"
Show me the output. If there's an error, show me the full stack trace.

STEP 3 — Regenerate .ai-context with the new schema
Run:
  node -e "
    const sm = require('./core/stateManager');
    async function run() {
      const state = await sm.updateProjectState('.', 
        { timestamp: new Date().toISOString(), action: 'manual_update', file: '.' },
        { logger: null }
      );
      console.log('version:', state.version);
      console.log('has setup_guide:', !!state.setup_guide);
      console.log('has code_notes:', !!state.code_notes);
      console.log('has dependency_graph:', !!state.dependency_graph);
      console.log('code_notes count:', state.code_notes.length);
      console.log('briefing.md regenerated, lines:', 
        require('fs').readFileSync('.ai-context/briefing.md','utf8').split('\n').length);
    }
    run().catch(console.error);
  "
Show me the exact output.

STEP 4 — Show me the new briefing.md sections
Run:
  node -e "
    const fs = require('fs');
    const content = fs.readFileSync('.ai-context/briefing.md', 'utf8');
    const sections = ['Getting Started', 'Developer Notes In Code', 'Module Dependencies', 'Code Catalogue'];
    for (const s of sections) {
      console.log('--- ' + s + ' ---');
      console.log(content.includes('## ' + s) || content.includes('## 🧭 ' + s) || content.includes('## 📌 ' + s) || content.includes('## 🕸 ' + s) || content.includes('## 🔍 ' + s) ? 'FOUND' : 'MISSING');
    }
  "
Show me the output. All 4 should say FOUND.

STEP 5 — Commit, tag, and push
  git add .
  git commit -m "feat: v2.1.0 - setup guide, dev notes from TODO/FIXME, dependency graph, function/class purpose summaries"
  git tag v2.1.0
  git push origin main
  git push origin v2.1.0
Show me the output of each.

STEP 6 — Publish to npm
  npm pack --dry-run
Check the file count includes core/codeIntel.js as a new file (should be 20 total now).
Then:
  npm publish
If 2FA is required, I'll provide a fresh granular token with bypass-2FA when you ask.
Show me the full publish output.

After everything succeeds, tell me:
- npm version now live
- A short excerpt from the new briefing.md showing the Getting Started and Developer Notes sections

Note: files added in folder name: New Updated Files