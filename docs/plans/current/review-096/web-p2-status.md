# 0.9.6 web/TS P2 status

Branch `fix/096-p1-web` (worktree `wf-096-web`). Not pushed. Each fix below
was written test first: the test failed before the fix and passes after it.
Data-loss and security items were taken first.

## Typecheck

| Check | Result |
| --- | --- |
| `apps/web` `npx tsc --noEmit -p tsconfig.json` | 1 error, base only: `folder-import-keep-id.test.ts(158,43)` TS2554. Fixed on main in 7ee3c9369; it goes away on rebase. |
| `packages/core` `npx tsc --noEmit -p tsconfig.json` | clean |

## Base failures (not from this branch)

| Failure | State |
| --- | --- |
| tsc `folder-import-keep-id.test.ts(158,43)` TS2554 | fixed on main, 7ee3c9369 |
| `ink-chunk-store.test.ts`: 8 failures (recursion) | fixed on main, 843759224 |
| `ink-note-paths.test.ts`: 1 failure, "Unsafe workspace path" | base failure. The file does not import anything this branch changed. |

## Fixed P2s

| Item | What | Commit |
| --- | --- | --- |
| P2-1 | | 1ccf9e3e7 |
| P2-2 | The native Google sign-in times out after 60 s and falls back to the web sign-in | 883a1f1e6 |
| P2-3 | (keychain keys per connection: see Rust lane) | 99cc8b500 |
| P2-10 | The arrow-key nudge keeps a figure on the page | 2bed249ad |
| P2-146 | The collab editor shows a retry when the user id fails, instead of loading forever | 85611363e |
| P2-147 | A desktop sign-in whose chunk or exchange fails is logged via logToApp, not left as an unhandled rejection | 5fbe8ccb7, 30a2d9ce3 |
| P2-150 | | faef98280 |
| P2-151 | | ee44b676b |
| P2-167 | A late PDF fetch, free-copy search or page removal no longer writes into the next paper's view | 6fcd624c1 |
| P2-173, P2-190 | When a paper is deleted, the row goes first, then a best-effort cleanup | 0d10c3dc4 |
| (trash) | Follow-up fix for trashed papers | 6dd3c8024 |
| P2-197 | | 916fdf100 |
| P2-199 | | d7ba3c4fa |
| P2-201 | Evicting a page proxy no longer breaks a later render (`holdPageProxy`) | ed26b17ae |
| P2-203 | The download `pause` removes its abort listener | 95d4b3199 |
| P2-204 | | ade5a7c07 |
| P2-216 | | c8267fa44 |
| P2-236 | | b55cb1822 |
| P2-237 | | 83fbec1ef |
| P2-238 | | 6a13f5186 |
| P2-250 | | 3a4f8096c |

Commit messages give the detail where the What column is blank.

## Not done in this pass (open, web scope)

P2-140 to P2-145, P2-148, P2-149, P2-152 to P2-166, P2-168 to P2-172,
P2-174 to P2-189, P2-191 to P2-196, P2-198, P2-200, P2-202, P2-205 to P2-215,
P2-217 to P2-235, P2-239 to P2-249, P2-251 to P2-258.

## Out of web scope

P2-95, P2-113, P2-115, P2-82.

## Rust lane notes

- The wf-store BOM test `save_keeps_a_byte_order_mark` fails at `vault_checked.rs:538`.
- The lint at `bases.rs:99` needs a fix.
- The P2-3 per-connection keychain keys belong in the Rust lane.

## Open decisions

- P2-173/P2-190: images are still deleted when a paper is trashed, so a
  restored paper comes back without them. Recommendation: keep images until
  the paper is purged from trash, not when it is trashed. This needs the
  user's OK because it changes when storage is freed.

## Skipped (merge-conflict files)

bindings.ts, file-annotation-pin-repository.ts, file-paper-repository.test.ts,
file-comment-repository.ts, workspace/application/parts-1.ts, parts-2.ts.
