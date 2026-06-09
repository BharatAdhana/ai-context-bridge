Step 1 is confirmed good. Now do Steps 2, 3, and 4 in sequence without stopping.

STEP 2 — Update package.json.
Edit package.json and make these exact changes:
- Change "version": "1.5.2" to "version": "2.0.0"
- Change the description to: "Zero-config CLI that auto-generates an AI briefing file for any project. Tracks code changes with real diffs, errors, fixes, file structure, API routes and dependencies. One command: npx aibridge-context start"
- Add these to the keywords array (keep existing ones): "briefing", "diff", "changelog", "code-tracking"
Show me the final package.json contents after editing.

STEP 3 — Stage, commit, tag, and push to GitHub.
Run each of these separately and show me the output of each:

  git add .

  git status

  git commit -m "feat: v2.0.0 - real diffs, briefing.md, issue tracker, auto-init, one-command start"

  git tag v2.0.0

  git push origin main

  git push origin v2.0.0

If git push fails for any reason, show me the exact error and do not continue to Step 4.

STEP 4 — Publish to npm.
Only do this after Step 3 push succeeds.

First run the dry run and show me the file list:
  npm pack --dry-run

Then if the file count is 19 or more and all core/ files are included, run:
  npm publish

Show me the full npm publish output including the final line with the package URL.

After all steps are done, tell me:
- The GitHub URL of the repo
- The npm URL of the published package
- The exact version now live on npm