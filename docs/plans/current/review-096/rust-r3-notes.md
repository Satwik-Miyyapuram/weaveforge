# 0.9.6 review r3: Rust notes

Branch `fix/096-review-r3`. Large wf-core / wf-store modules no earlier round
reviewed, data-loss and security paths first. Each P0-P2 was fixed test-first
in its own commit; this file keeps the P3s that were left as they are.

## Reviewed, no P0-P2

- Batch 3: `wf-core` `canvas/excalidraw.rs`, `repos/papers.rs`,
  `repos/reader_annotations.rs`, `repos/crdt_updates.rs`, `repos/shares.rs`,
  `repos/members.rs`, `repo_query.rs`, `repos/report_sections.rs`;
  `wf-store` `git/repo.rs`.

## P3s (not fixed)

| Module | Note |
| --- | --- |
| `wf-store/src/checked_write.rs` | `written()` reads the target back after the rename, so a write from another process landing in that small window is reported as ours. |
| `wf-store/src/vault.rs` | `Vault::rename` checks the target is free, then calls `fs::rename`; another process can create it in between. Only tests call it; the shell uses `rename_checked`. |
| `wf-core/src/repos/report_sections.rs` | `mutate()` reads the row, then upserts all of it, so a concurrent edit to another field is lost. Same as the TS repo it replaced. |
| `wf-core/src/repos/report_sections.rs` | The module doc says titles are end-to-end encrypted; nothing in the web app encrypts them. The comment is stale. |
