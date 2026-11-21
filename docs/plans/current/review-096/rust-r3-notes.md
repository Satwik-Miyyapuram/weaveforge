# 0.9.6 review r3: Rust notes

Branch `fix/096-review-r3`. Large wf-core / wf-store modules no earlier round
reviewed, data-loss and security paths first. Each P0-P2 was fixed test-first
in its own commit; this file keeps the P3s that were left as they are.

## Reviewed, no P0-P2

- Batch 3: `wf-core` `canvas/excalidraw.rs`, `repos/papers.rs`,
  `repos/reader_annotations.rs`, `repos/crdt_updates.rs`, `repos/shares.rs`,
  `repos/members.rs`, `repo_query.rs`, `repos/report_sections.rs`;
  `wf-store` `git/repo.rs`.
- Batch 4: `wf-relay` (`relay/*`, `fetch/safe.rs`, `fetch/url_shape.rs`);
  shell `local_files.rs`, `protocol.rs`, `cmd_files.rs`, `cmd_vault.rs`,
  `local_http/route.rs`; `tauri-plugin-ink` (Rust side only registers the
  Kotlin class). One P2 fixed: `vault_write_bytes` and the local API PUT
  skipped the config secret guard.

## P3s (not fixed)

| Module | Note |
| --- | --- |
| `wf-store/src/checked_write.rs` | `written()` reads the target back after the rename, so a write from another process landing in that small window is reported as ours. |
| `wf-store/src/vault.rs` | `Vault::rename` checks the target is free, then calls `fs::rename`; another process can create it in between. Only tests call it; the shell uses `rename_checked`. |
| `wf-core/src/repos/report_sections.rs` | `mutate()` reads the row, then upserts all of it, so a concurrent edit to another field is lost. Same as the TS repo it replaced. |
| `wf-core/src/repos/report_sections.rs` | The module doc says titles are end-to-end encrypted; nothing in the web app encrypts them. The comment is stale. |
| `wf-relay/src/relay/shared.rs` | The html/pdf relays check only the literal host (`is_private_host`) and do not pin the dialled address, so a public name that resolves to 127.0.0.1 passes (DNS rebinding). Same as the TS `proxy-shared.ts`; `fetch/safe.rs` does resolve and pin. |
| `wf-relay/src/relay/address.rs` | TEST-NET-2/3 (198.51.100.0/24, 203.0.113.0/24) count as public. Same as the TS `isPublicIpv4`. |
| `apps/shell/src/cmd_vault.rs` | `vault_write` and `vault_remove` note a self-write but do not `forget_self` when the write fails, unlike `file_write`'s `settle_write` and `file_delete`; a later external edit to that path can be skipped once. |
| `apps/shell/src/cmd_files.rs` | `file_rename` reads the source for the secret guard, then renames; the file can change in between. |
