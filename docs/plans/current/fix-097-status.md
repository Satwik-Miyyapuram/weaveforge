# 0.9.7 review fixes: status

Branch `fix/097-review` (worktree `wf-097`, based on `origin/main`). Spec:
`wf-096/docs/plans/current/review-096/fix-list-097.md`. Not pushed.

Every fix has a test that failed on the old code first, unless the test column says otherwise.
The skip rule: the item's file also changed on release/0.9.6 in a conflicting way
(`git diff 1cebdc339 bd1444e18 -- <file>`).

| item | status | commit | test |
| --- | --- | --- | --- |
| P1-1 | done | a2283781a | apps/web/src/features/workspace/test/remove-project-folder.test.ts; crates/wf-core/tests/sync_folder_helpers.rs |
| P1-2 | done | 9207a0402 | apps/relay/server/tests/collab_ws.rs `lagged_client_gets_the_whole_doc` |
| P1-3 | done | c1668ce39 | apps/web/src/features/ink/test/use-ink-note-store.test.tsx |
| P2-1 | skipped: ws.rs and hub.rs changed on 0.9.6 | - | - |
| P2-2 | done | 9207a0402 | compile-time assert: queue length x max frame <= 128 MiB |
| P2-3 | done | 9207a0402 | apps/relay/server/tests/sdk_artifacts.rs |
| P2-4 | done | 9207a0402 | apps/relay/server/tests/auth.rs |
| P2-5 | skipped (conflict): 0.9.6 rewrites `delete_to_trash`'s head (hunk -203,13: `symlink_metadata` check) and `free_path` (hunk -353,11: `first_free`); the claim-then-rename fix edits both | - | - |
| P2-6 | skipped (conflict): 0.9.6 rewrites `settle_prev`/`copy_prev_to` (hunks -394,11 and -406,17) and `read_disk`/`make_prev` (-540, -571), the exact lines the raw-bytes hash changes | - | - |
| P2-7 | done | e5cbe4a7d | crates/wf-store/tests/git_remote.rs `f97_p2_7_keep_both_never_overwrites_an_untracked_file` |
| P2-8 | done | 5bb5df2a3 | crates/wf-store/tests/git_repo.rs `f97_p2_8_*` (2 tests) |
| P2-9 | done | 81cd39770 | crates/wf-store/tests/gitfiles.rs `f97_p2_9_gitfiles_never_write_through_a_link`. It skips on Windows when no link can be made, so it was not red here. |
| P2-10 | done | 4a2d419fb | crates/wf-store/tests/metrics_chunks.rs `f97_p2_10_two_batches_with_one_id_both_keep_their_points` |
| P2-11 | done | fac38e8f3 | wf-core chunk.rs `f97_p2_11_*` |
| P2-12 | done | 8cfefc1ba | wf-core vault_page_guard.rs `f97_p2_12_two_copies_in_one_save_are_both_reported` |
| P2-13 | done | 797601a09 | wf-core entity_file.rs `f97_p2_13_*` (2 tests; keeps-next-field is an edge guard that also passes on the old code) |
| P2-14 | done | a2283781a | crates/wf-core/tests/sync_file_kind.rs `f97_p2_14_a_trash_path_never_leaves_the_trash` |
| P2-15 | done | 23be4dd83 | wf-core page.rs `f97_p2_15_a_deep_parent_chain_builds_without_overflow` (old code: exit 253, a stack overflow) |
| P2-16 | done | 6126eab27 | scripts/lib/test/legacy-write-revoke.test.mjs, migration-numbers.test.mjs |
| P2-17 | done | a1d5d851c | scripts/lib/test/workspace-pins.test.mjs |
| P2-18 | done | a1d5d851c | scripts/lib/test/workspace-pins.test.mjs |
| P2-19 | done | 1e64dfe57 | apps/web/src/features/workspace/test/folder-adopt.test.ts |
| P2-20 | done | 1e64dfe57 | apps/web/src/container/test/workspace-facade.test.ts |
| P2-21 | done | 1e64dfe57 | apps/web/src/container/test/workspace-facade.test.ts |
| P2-22 | done | f626d72a9 | apps/web/src/app/test/start-citation-alerts.test.ts |
| P2-23 | partial: milestone part done; paper part skipped (conflict): 0.9.6 replaces `readAll` with `scan()` returning `failures` (hunk -175,22), the same loop the fix moves `readText` into | 5b95ade27 | apps/web/src/features/plan/infrastructure/test/file-milestone-repo.test.ts |
| P2-24 | done | 5b95ade27 | apps/web/src/features/plan/infrastructure/test/file-milestone-repo.test.ts |
| P2-25 | skipped (not on main): the PDF-trashing `delete` at :158-161 exists only on 0.9.6 (hunk -105,10); on main `delete` moves the paper file alone, so no PDF can be lost here | - | - |
| P2-26 | done | 45ad09a4f | apps/web/src/features/workspace/test/opfs-clone.test.ts |
| P2-27 | fixed | 8e6ba6308 | apps/web/src/features/reader/ui/pdf-reader/test/reader-wheel-and-swatch-keys.test.ts |
| P2-28 | fixed | 8e6ba6308 | apps/web/src/features/reader/ui/pdf-reader/test/reader-wheel-and-swatch-keys.test.ts |
| P2-29 | done | c24bf49b9 | apps/web/src/features/ink/test/ink-action-failures.test.tsx |
| P2-30 | done | c24bf49b9 | apps/web/src/features/ink/test/ink-action-failures.test.tsx |
| P2-31 | done | c24bf49b9 | apps/web/src/features/ink/test/ink-action-failures.test.tsx |
| P2-32 | skipped (conflict): 0.9.6 edits `appendStroke`/`removeStroke` (hunk -158,10) and the paint path (-272..-339); main's renderer differs from 0.9.6 by 176 lines, so the z-order fix belongs on the merged renderer | - | - |
| P2-33 | skipped: ws.rs and hub.rs changed on 0.9.6 | - | - |
| P2-34 | skipped: ws.rs and hub.rs changed on 0.9.6 | - | - |
| OPT-8 | done, with P2-15 | 23be4dd83 | covered by the page.rs tree tests |
| OPT-10 | skipped (design + conflict): `find` takes a note id, and on main strokes sit in `<note>.ink/` folders found by reading each `.md`'s `weaveforge-id`, so there is no `<note>.inkb` name to stat; `FolderInkNotes` is also added on both sides with differing text (HEAD vs 0.9.6: 11/16 lines) | - | - |
| OPT-13 | skipped: conflicts with 0.9.6 | - | - |
| OPT-16 | fixed (comment only) | 620f8b9d7 | - |
| OPT-1 to OPT-7, 9, 11, 12, 14, 15, 17 | not done: not cheap, or not safe enough for this pass | - | - |

## Notes

- **Deviations from the spec.**
  - P1-1: the removal resolves the folder through the sync folder layout, in both web and wasm, rather than through a name guess.
  - P1-2: a lagged client is rechecked and then sent the whole document as a sync step 2. The test client lifts tungstenite's 16 MiB frame cap, because a resync can be larger than that.
  - P1-3: the save ref moves in a layout effect, after the flush cleanup.
  - P2-3: an allow-list of inert content types replaces the default; anything else is served as the default type.
  - P2-8: the exclude file is written to a temp file and renamed into place, and a failed write leaves no temp file.
  - P2-20: a sync checks the folder is still active both before it writes and before it commits.
  - P2-22: the start-up logic moves to start-citation-alerts.ts.
- **P2-14:** the check sits at the wasm boundary. `checked_trash_path` refuses an unsafe rel, and `trashPathFor` throws for one.
- **P2-12:** `conflictCopyIds` is new; `conflictCopyId` stays and still names the last copy.
- **P2-9:** the fix refuses to write through a symlink. The test skips on Windows when no link can be made.
- **P2-10:** chunk names are now `b<id>-<digest>`. The read-time dedupe on (run, step, metric) makes the old `b<id>` chunks harmless.
- **P2-26:** the fix covers new paths only.
- **P2-17:** the relays now pick up the workspace serde_json features, preserve_order among them. The relay tests pass with it.
- **Coordinator heads-up:** the ink_paths.rs:115 and sync_folder_mirror.rs compile breaks are not present in this base.
- **Checks run:**
  - `npm run typecheck` passes.
  - `cargo clippy -D warnings` passes on wf-core, wf-store, wf-relay-server and wf-wasm.
  - The full `cargo test -p wf-relay-server` run passes.
  - The wf-store git and file test files pass.
  - The wf-core targeted tests pass.
  - The web tests listed in the table pass.
  - The full `npm run preflight` was not run.
- **Full check (second pass):**
  - `npm run typecheck` (tsgo: web, core, wf-wasm): exit 0.
  - Web tests (run-tests.mjs, --test-concurrency=1): 5514/5514 pass.
  - packages/core node:test: 951/951 pass. packages/wf-wasm TS tests: 288/288 pass.
  - cargo test, one crate at a time: wf-core 4862 pass; wf-store 231 pass, 2 ignored; wf-wasm 19 pass; wf-relay-server all pass.
  - Only failure: my P2-3 relay test `f97_p2_3_active_content_types_are_stored_as_octet_stream` uploaded `a.bin` while the storage mock serves `model.pt` (404 -> 500). Fixed in the test; sdk_artifacts 15/15.
  - No failures already on main.
  - Vitest: the repo has no vitest config or suite; all JS tests run on node:test.
