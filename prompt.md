We have two things to fix.

ISSUE 1 — GitHub push blocked (npm token in prompt.md)
GitHub rejected the push because prompt.md contains the npm token in plain text.
We need to rewrite history to remove it.

Run these one at a time:

  git log --oneline -3

Then remove the token from prompt.md — replacement complete.

Then amend the last commit to overwrite it:
  git add prompt.md
  git commit --amend --no-edit

Then force push (this is safe — it is only our own branch and we are 
rewriting the last commit to remove a secret):
  git push origin main --force
  git push origin v2.3.0 --force

Show me the output of each command.

ISSUE 2 — Remove stray "updated files" folder if it was committed
Check if a folder called "updated files" or "Updated files" exists 
in the repo:
  git ls-files | grep -i "updated files"

If any results appear, remove them:
  git rm -r --cached "updated files"
  git rm -r --cached "Updated files"
  git add .
  git commit -m "chore: remove stray updated files folder"
  git push origin main

If no results appear, skip this step and say "No stray files found".

ISSUE 3 — Verify Architecture Flow and Module Capabilities work (they 
are MISSING on aibridge's own JS repo because it has no Python classes 
with docstrings — this is CORRECT behavior, not a bug).

To confirm they work, run this quick test:
  node -e "
    const { buildArchitectureFlow, rankCoreFiles } = require('./core/codeIntel');
    const testGraph = {
      graph: {
        'main.py': ['signals/fusion.py', 'config/settings.py'],
        'signals/fusion.py': ['config/settings.py']
      },
      mostUsed: [{ file: 'config/settings.py', count: 2 }]
    };
    const flow = buildArchitectureFlow(testGraph, 'main.py');
    console.log('Architecture flow test:');
    console.log(flow ? flow.join('\n') : 'null');
  "

Expected output:
  main.py
  ├─ signals/fusion.py
  │  └─ config/settings.py (↺ shown above)
  └─ config/settings.py

Show me the exact output.

After all three are done, tell me:
- GitHub push status (succeeded or still blocked)
- npm version live: should be 2.3.0
- Whether stray files were found and removed