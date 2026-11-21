# r4: review of the 0.9.7 diff

Scope: `git diff release/0.9.6...origin/fix/097-review` with release/0.9.6 at
`eaa3a4080` and origin/fix/097-review at `65759e73b`. That is 80 files,
+2040/-672. The review was read-only and looked for P0/P1/P2, with data loss
and security first.

## Result

**No P0, P1 or P2 found.**

## What was checked

| Area | Change | Verdict |
| --- | --- | --- |
| Relay auth (`auth.rs` `get_user`) | A 4xx other than 429 gives 401. A 5xx, a 429 or a network error gives 503. A 2xx with no id gives 401. | OK: fails closed |
| Relay SDK artifacts (`is_inert_type`) | Refuses html, xml, svg, script, xsl and multipart. Only a token/token type made of printable ASCII is let through. | OK |
| Collab lag (`hub.rs`, `ws.rs`) | After a lag, the auth check runs again, then the full doc is resent. A room holds at most 64 × 2 MB. | OK |
| Remove project folder (`parts.ts`, `folder_layout.rs`) | The folder must match by exact name, or by an id suffix that no other project shares. It must hold the project layout. Files move to `.weaveforge/trash/<day>/` and are never deleted. A late file keeps the folder. The desktop `remove` refuses folders. `trashPathFor` now throws, and both callers let the throw abort before anything moves. | OK: nothing is unlinked |
| Ink page move (`moveInkStrokes`) | The source page goes only after the copy reads back with the same bytes. A different page already at the destination keeps the source. | OK |
| Ink note-switch flush (F97-P1-3) | The persist ref moves in a layout effect, after the flush cleanup. Each tab's `DocumentHost` is keyed (`pane-view.tsx:325`), so the refs never span two notes. | OK |
| Milestone delete | Moves to the trash with a numbered free name. An unreadable file is skipped and logged. | OK |
| Papers scan | A failed `readText` is recorded as a failure instead of emptying the list. | OK |
| Folder switch (F97-P2-19/20/21) | The old folder closes before the new one is adopted. A sync aborts if the folder changed during a run. The snapshot cache is shared only within the same project, and a late read never becomes the new project's baseline. | OK |
| Web clone scan (F97-P2-26) | A new local file is read only if `decideGitSyncPath` admits it. The size cap applies through the wrapper's default `maxFileBytes`. | OK |
| Vault conflict copies | Returns every copy (`conflictCopyIds`) plus the last one. | OK |
| Tree loops (`vault/page.rs`) | Depth is capped at 256, and one shared mark vector keeps each walk linear. | OK |
| Git (`remote.rs`, `repo.rs`, `gitfiles.rs`) | A free remote name skips names that are on disk. Excludes are written to a temp file and renamed, and the temp is removed on error. `ensure_file` refuses to write through a symlink. | OK |
| Metrics, entity_file `set_field`, ink chunk clip | Chunk names carry the points digest. The replaced key's list lines are skipped. The clip stops on a char boundary. | OK |
| db (`0162` → `0163`, held) | The rename is consistent across the SQL, the rollback, the record table and the test. Nothing applies `db/held/`. | OK |
| CI and Cargo pins | Tests run with `--no-fail-fast`. tokio and reqwest are pinned once in the workspace. | OK |

## Below the bar (P3, for the record only)

- `hub.rs`: each room is capped, but nothing caps the total across rooms. Many
  rooms that lag at once could hold 128 MB each.
- `gitfiles.rs` `ensure_file`: there is a gap between the symlink check and the
  write (TOCTOU). Only a local attacker could use it.
- `metrics_csv.rs`: a row stored under the old `b{id}` chunk name and fetched
  again after the upgrade, before its ack, would be stored a second time under
  `b{id}-{digest}`.
- `removeProjectFolder` in the browser: rename is copy-then-delete for each
  file, so a failure part way leaves the project split between its folder and
  the trash. Nothing is lost.
