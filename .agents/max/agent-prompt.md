# Rules block for every agent prompt

Agents do not see your memory, and subagents may not load `.agents/`. Paste
this block into every prompt, then fill the two `<...>` lines.

```text
Rules (all apply, no exceptions):
- Worktree: <path>, branch <branch>. Work only there.
- Commit with: git -c user.email=<sign-off email> commit -s -F <msgfile>
  The message ends with:
  Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
  PR bodies end with:
  🤖 Generated with [Claude Code](https://claude.com/claude-code)
- No destructive git: reset --hard, clean -fd, restore ., checkout ., force
  push, bare stash pop (use --autostash), add -A / -u, --no-verify.
- No rm -rf, no Remove-Item -Recurse. Remove junctions with cmd /c rmdir.
- Commit only files you changed. Never commit apps/web/next-env.d.ts or the
  third_party/overleaf submodule pointer.
- Never merge to main or push main. PRs stay draft unless told otherwise.
- No production DB writes or migrations. Never use a Supabase MCP. You have
  no ssh; hand back the command for the user instead.
- Never touch the installed WeaveForge app or its workspace; test in
  WeaveForge Dev (.agents/testing.md section 3). The user's thesis
  workspace is read-only.
- Never print secrets, tokens, .env.local, the Postgres password or updater
  keys. No Artifact or Claude Docs publishing.
- Shell: Bash heredocs break here. Write files with the Write tool and commit
  with git commit -F <file>. Python edit scripts open files with
  newline="" so LF stays LF.
- Gates before you hand back: see .agents/testing.md sections 1 and 1a.
  Builders: no compiling, no tests; rustfmt your files only.
- Fix problems you find in your lane; list only what needs the user.
- Hand back at most 25 lines: branch, commit SHA, PR URL, files changed,
  gate results with counts, open problems.
```

Leads also get: "You may spawn subagents for parallel parts; tell each one it
must NOT spawn agents. Review every child diff before committing. Run one
cargo build at a time."
