# WeaveForge Workspace Rules & Security Guardrails

## 1. Safety & Permissions Policy
- **Never Run Destructive Commands:** The agent must NEVER execute destructive git operations (`git reset --hard`, `git clean -fd`, `git restore .`, `git checkout .`) or bulk deletion commands (`rm -rf`, `del /f`, `Remove-Item -Recurse`).
- **Safe Read-Only Inspections:** The agent may run safe inspection commands without prompting: `git status`, `git diff`, `git log`, `git branch`. For reading file contents and searching code, the agent MUST use native IDE tools (`view_file`, `grep_search`, `find_by_name`, `list_dir`) rather than shell commands.
- **No File Deletions Without Explicit Approval:** Files must never be deleted or overwritten without explicit user request.
- **Strict Planning Mode Integrity:** During research and planning phases, the agent must NEVER modify, create, or delete codebase files until the user has reviewed and explicitly approved the implementation plan.
