# File-safety laws

The rules the workspace folder lives by: what a write, a trash, a rename, a read of a note and the git excludes may and may not do to the user's files. Each law is one line, binds named code, and has a test that fails when the code breaks it. The mutation column will record that test failing against a deliberate bug; the runs are pending (they need a build, done on the combined 0.9.6 branch).

They exist because of the 2026-11-19 incident: the folder mirror deleted vault files that had left the database (`remove_departed`), and a stamp gave notes new ids. S5 forbids the first and V8 sends a user's delete to the trash; S2 and S4 forbid the second. A file is known by its path: the laws hold for files with or without an id.

Run them with `cargo test -p wf-core --test laws_sync` and `cargo test -p wf-store --test laws`. The bounded checks inside `checked_write.rs` run with `cargo test -p wf-store --lib law_tests`.

## Sync layer (`wf-core`)

Property tests in `crates/wf-core/tests/laws_sync.rs`, 256 cases each.

| Law | Statement | Binds | Test | Mutation |
| --- | --- | --- | --- | --- |
| S1 | A canonical file survives a read and a re-render byte for byte. | `write_frontmatter`, `read_frontmatter` (`sync/frontmatter.rs`) | `s1_canonical_file_round_trips` | pending |
| S2 | Reading a file never mints an id and never changes one it read: a file is known by its path, and a file without an id stays without one. | `parse_workspace_file` (`sync/deserialize.rs`) | `s2_parse_never_mints_an_id` | pending |
| S3 | `created-at` comes from the file, unchanged. | `parse_workspace_file` | `s3_created_at_comes_from_the_file` | pending |
| S4 | Stamping never changes an id it did not read: a file that declares one is left alone, with LF or CRLF, with or without a BOM. | `stamp_workspace_id`, `claims_id` (`sync/stamp_workspace_id.rs`) | `s4_stamp_never_changes_a_read_id` | pending |
| S5 | The folder mirror never deletes: a file the snapshot no longer holds stays where it is, and no remove is attempted. | `mirror_workspace` (`sync/folder_mirror.rs`) | `sync_never_deletes_a_file_the_snapshot_no_longer_holds`, `a_departed_file_is_left_in_place_and_no_remove_is_attempted` (`sync_folder_mirror.rs`) | pending |

S5 is a plain test, not a property: it binds the absence of a delete, which one departed file shows. It came with the `remove_departed` removal on `fix/095-l0-safety`.

`crates/wf-core/tests/sync_frontmatter.rs` already holds the wider round-trip properties; S1 is the law-level statement over random fields and multi-line bodies. Known limit, shared with that file: a list item that ends in `\` reads back as an escaped quote, so the generators leave it out. S1 also needs at least one field: the reader takes an empty `---`/`---` block as body text, and the app never writes one because every note has an id.

## Workspace folder (`wf-store`)

Property tests in `crates/wf-store/tests/laws.rs`, 48 cases each (every case builds a real folder on disk). Each test snapshots every file in the folder before and after, so "only the target changed" is checked over the whole folder, not one path.

| Law | Statement | Binds | Test | Mutation |
| --- | --- | --- | --- | --- |
| V1 | A checked write never replaces bytes the caller has not seen: on a mismatch it reports `Changed` and no file in the folder changes. | `check_expected`, `may_replace` (`checked_write.rs`) | `v1_checked_write_never_replaces_unseen_bytes`; `may_replace_only_seen_bytes_for_every_byte_pair` | pending |
| V2 | A write changes only its target and leaves no temp or `.wfprev` behind, checked or not. | `write_checked_with_hook`, `settle_prev`, `Vault::write_file` | `v2_write_changes_only_its_target` | pending |
| V3 | A write that dies before its swap leaves the old bytes in place; only the generated temp is new. | `write_checked_with_hook` (temp, fsync, then rename) | `v3_interrupted_write_keeps_old_bytes`; also `killed_writer_never_leaves_a_torn_file`, `file_write_crash_mid_rename` (`vault_crash.rs`) | pending |
| V4 | Trash never overwrites: a name already used that day gets the next free number, and every earlier trashed file keeps its bytes. | `delete_to_trash`, `free_path`, `first_free` | `v4_trash_never_overwrites`; `free_name_is_never_taken_for_every_taken_set`; `trash_name_clash_gets_suffix` (`vault_checked.rs`) | pending |
| V5 | A rename never overwrites: a different file at the destination moves to a conflict copy first. | `rename_checked`, `is_other_file` | `v5_rename_never_overwrites`; `rename_keeps_displaced_target` (`vault_checked.rs`) | pending |
| V6 | An existing `.wfprev` is never overwritten; the next one gets a numbered name. | `free_prev`, `first_free` | `write_never_overwrites_existing_prev` (`vault_checked.rs`) | pending |
| V7 | The stale-temp sweep removes only temps the app generated, never a user's own `*.wftmp` file. | `sweep_dir`, `is_stale_temp`, `is_generated_temp` | `sweep_keeps_user_wftmp_files` (`vault_checked.rs`) | pending |
| V8 | A delete the user asks for never destroys the file: it moves into `.weaveforge/trash/` with its bytes, a dangling link included. `Vault::remove` stays a plain unlink for temps, internal state, caches and rename sources, and never fills the trash. | `delete_to_trash` (`checked_write.rs`, shell `file_delete`); `Vault::remove` (`vault.rs`) | `v8_user_delete_moves_into_the_trash`; `v8_user_delete_takes_a_dangling_link`; `v8_plain_remove_does_not_fill_the_trash` | pending |
| V9 | A plain write goes through the checked write: a change another process makes while it runs is kept in a conflict copy, not lost. | `Vault::write_file`, `write_file_with_hook` (`checked_write.rs`) | `v9_plain_write_keeps_a_change_made_mid_write` | pending |

## Git policy

| Law | Statement | Binds | Test | Mutation |
| --- | --- | --- | --- | --- |
| G1 | The excludes the app writes never hide a synced settings file (`SYNCED_META_FILES`), whatever the exclude file already held, including the stale `/.weaveforge/` line, and still hide this machine's own `.weaveforge/*.json`. | `write_excludes` (`git/repo.rs`), `meta_exclude_lines` (`wf-core` `sync/git_policy.rs`) | `g1_excludes_never_hide_synced_settings` (`laws.rs`); `write_excludes_is_idempotent` (`git_repo.rs`) | pending |

## Kani proofs

V1 and V4 rest on two small pure functions in `crates/wf-store/src/checked_write.rs`: `may_replace` (may these bytes be replaced?) and `first_free` (the first free name; trash, conflict copies and `.wfprev` all take their names from it). Their laws are written once in `mod laws` and checked two ways. The Kani proofs cover only these two functions; every other law here is a property or plain test, not a proof:

- `cargo test` runs them over every input in a small range (`mod law_tests`): all 256 x 257 byte pairs, and all 65,536 taken-sets of 16 names, starting at 0 or 1, with 0 to 15 tries.
- Kani proves them for every input in the same bounds (`mod proofs`, built only under `cfg(kani)`): `may_replace_only_seen_bytes` (K1) and `free_name_is_never_taken` (K2).

Kani is not installed on the dev machines or in CI yet. To run the proofs:

```sh
cargo install --locked kani-verifier
cargo kani setup
cargo kani -p wf-store
```

The workspace `Cargo.toml` declares `cfg(kani)` under `unexpected_cfgs`, so the gated module builds without warnings when Kani is absent. A CI job is not added: it would need the Kani toolchain on every runner. When it is wanted, add a job (for example a `kani` job in `.github/workflows/nightly.yml`) that runs the three commands above.

## Why there is no TypeScript twin

The web app and the desktop app reach this logic through Rust: the core through wasm (`@/lib/rust-core`), the folder through the shell. There is no TypeScript copy of these functions to keep in step, so the laws have no fast-check twin.

## Known gaps

Places the laws do not cover yet. Each needs a decision.

- A write with no expected digest (`Vault::write_file`, or `expected = None`) is last-writer-wins against bytes that were on disk before it started: it takes them as seen. V9 covers only a change that lands while it runs.
- Trash and rename pick a free name, then move. Another process can take that name between the two steps, and `std::fs::rename` replaces an existing file. `write_checked_with_hook` documents the same window before its swap.
- `Vault::write_file` now runs the full checked write (hash, hard-link `.wfprev`, re-check, rename), so a plain write of a big binary costs more I/O than the old temp-and-rename.
