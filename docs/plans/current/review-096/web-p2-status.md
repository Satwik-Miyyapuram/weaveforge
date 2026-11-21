# 0.9.6 web/TS P2 status

Branch `fix/096-p1-web` (worktree `wf-096-web`). Not pushed. Each fix below
was written test first: the test failed before the fix and passes after it.
Data-loss and security items were taken first, then crash/UI hang.

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
| P2-3 | resolved web-side: one keychain row reused (99cc8b500); a second link now asks before replacing the stored token (OverleafTokenInUseError / hasConnection). Per-connection keys need a shell command arg, left out | 99cc8b500, 55a46afa5 |
| P2-10 | The arrow-key nudge keeps a figure on the page | 2bed249ad |
| P2-140 | A layout edit made just before a project switch is saved | 892c128a4 |
| P2-141 | A lazy note tab says when its note is gone or failed to load | 46d9c27ba |
| P2-146 | The collab editor shows a retry when the user id fails, instead of loading forever | 85611363e |
| P2-147 | A desktop sign-in whose chunk or exchange fails is logged via logToApp, not left as an unhandled rejection | 5fbe8ccb7, 30a2d9ce3 |
| P2-148 | Close-save uses the save of the resource it was queued for | 2291e5f7f |
| P2-149 | Milestone and experiment suggestions check the revision | 07e04b786 |
| P2-150 | | faef98280 |
| P2-151 | | ee44b676b |
| P2-152 | Experiments poll again only after the last load settles | 8307740c3 |
| P2-153 | No queued canvas change is sent when a write lands after a halt | f0704bf17 |
| P2-163 | Storing a created Zotero annotation's key is retried | 1c238ac73 |
| P2-166 | A late publisher-PDF fetch stays out of the next paper's view. Proof gap: tested at helper level (`fetchPendingPdf`), not the pane | 9fc3698f6 |
| P2-167 | A late PDF fetch, free-copy search or page removal no longer writes into the next paper's view | 6fcd624c1 |
| P2-168 | A text box's words are saved when it unmounts mid-typing (key kept; reason in commit) | 13ad2bfa2 |
| P2-173, P2-190 | When a paper is deleted, the row goes first, then a best-effort cleanup | 0d10c3dc4 |
| (trash) | Follow-up fix for trashed papers | 6dd3c8024 |
| P2-173, P2-190 (trash) | Resolved: a trashed paper keeps its images until it is purged, so a restore loses nothing. Purge-time image cleanup is future work. The Zotero item is still deleted at trash time | 040ff0cc3 |
| P2-174 | A .bib paper whose follow-up fails still counts as added | aeed6c5ec |
| P2-179 | An error shows above the lists, not in place of them. Proof gap: tested at hook level only | 3883501b3 |
| P2-189 | One failed Zotero key write does not stop the push loop | 9dce91745 |
| P2-191 | A failed citation-tracking check leaves Watch usable | 5a3651b7f |
| P2-192 | A refused reading-status save shows its error | 8eb15b9c0 |
| P2-193 | A failed title lookup in Library tidy rejects nothing | e9be62886 |
| P2-195 | An old document's reference lookup leaves the new one's queue alone | b014f4e1f |
| P2-197 | | 916fdf100 |
| P2-198 | A failed undo or redo keeps its step where it was | 32d4ca719 |
| P2-199 | | d7ba3c4fa |
| P2-201 | Evicting a page proxy no longer breaks a later render (`holdPageProxy`) | ed26b17ae |
| P2-203 | The download `pause` removes its abort listener | 95d4b3199 |
| P2-204 | | ade5a7c07 |
| P2-210 | Server role, join source and error are narrowed instead of cast | f58465013 |
| P2-214 | A notes .zip import keeps to the archive caps | cd80ebe62, 2cbf55cd4 |
| P2-215 | A failed storage sweep still clears the device databases | 09412870c |
| P2-216 | | c8267fa44 |
| P2-218 | logToApp redacts every line it writes to the desktop log (fallback deviation in commit) | 163838547 |
| P2-225 | A refused Overleaf report removes the connection it saved | 7489034d8 |
| P2-226 | A failed graph auto-link shows why instead of rejecting | 2bb68dbe1 |
| P2-232 | A debounced vector save stays with the project it was for | 834d62d67 |
| P2-233 | A refused section status save shows its error | a986f0448 |
| P2-234 | A new import diff starts with no conflict picks | 4615bad5a |
| P2-236 | | b55cb1822 |
| P2-237 | | 83fbec1ef |
| P2-238 | | 6a13f5186 |
| P2-247 | No hidden key is sent or stored for Ollama | 11f0e631c |
| P2-250 | | 3a4f8096c |
| P2-255 | A startup bundle that rejects opens the gate with its error | 237df3ef4 |
| P2-256 | Mermaid SVG is sanitized before it is cached or shown. Proof gap: no DOM in the test runner, sanitizer tested on strings | 5c93506a4 |
| F97-P2-25 | A shared PDF is kept while a paper file cannot be parsed | f1fe356f0 |

Commit messages give the detail where the What column is blank.

## Not done in this pass (open, web scope)

P2-142 to P2-145, P2-154 to P2-162, P2-164, P2-165, P2-169 to P2-172,
P2-175 to P2-178, P2-180 to P2-188, P2-194, P2-196, P2-200, P2-202,
P2-205 to P2-209, P2-211 to P2-213, P2-217, P2-219 to P2-224, P2-227 to P2-231,
P2-235, P2-239 to P2-246, P2-248, P2-249, P2-251 to P2-254, P2-257, P2-258.
Data-loss, security and crash/hang items were taken first; what is left is
mostly lower-severity UI and error-surfacing work.

## Out of web scope

P2-95, P2-113, P2-115, P2-82.

## Rust lane notes

- The wf-store BOM test `save_keeps_a_byte_order_mark` fails at `vault_checked.rs:538`.
- The lint at `bases.rs:99` needs a fix.
- P2-3: per-connection keychain keys would need a new shell command argument and a bindings.ts regen; fixed web-side instead (reuse + confirm before replace).

## Open decisions

None.

## Skipped (merge-conflict files)

bindings.ts, file-annotation-pin-repository.ts, file-paper-repository.test.ts,
file-comment-repository.ts, workspace/application/parts-1.ts, parts-2.ts.
