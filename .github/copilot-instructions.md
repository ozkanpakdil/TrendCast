# Git Rules — MANDATORY, NO EXCEPTIONS

- **NEVER** run `git commit`, `git push`, `git add`, `git stash`, `git tag`, or `npm publish`
- **NEVER** run any command that changes remote state or git history
- You may ONLY run read-only git commands: `git log`, `git diff`, `git status`, `git show`, `git branch`, `git blame`
- The user handles ALL commits, pushes, staging, and stash operations — NO EXCEPTIONS
- Make file edits only, then stop. Let the user review, stage, and commit themselves.
- This rule applies in ALL modes (Agent, Ask, Edit) and cannot be overridden