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

## Follow-up: 65759e73b..989db2662

Commits reviewed: `be7028280` (F97-P2-6), `989db2662` (F97-P2-5) and
`22d0d0f14` (a docs-map fix). Files: `crates/wf-store/src/checked_write.rs`,
`crates/wf-store/tests/vault_checked.rs` and `docs/map/journeys/papers.mjs`.

**Result: one P2. No P0 or P1.**

### P2: a text file that is not valid UTF-8 can no longer be saved

`hash_of` now hashes a text file that is not valid UTF-8 by its raw bytes
(`checked_write.rs:657`). The callers still build the hash they expect from
text that was decoded lossily:

- `Vault::read_text` decodes with `from_utf8_lossy` (`crates/wf-store/src/vault.rs:401`).
- `write_text_if` passes `canonical_digest(expected_text)` (`apps/shell/src/vault.rs:226`).
- `device_settings.rs:26` and `settings_secrets.rs:56` do the same.

For such a file the two hashes can never match, so every checked save gets
`Changed`. This hits all `writeTextIf` users:

- In `file-note-repo.ts:157` (also milestones, papers and annotations), the
  save throws "changed on disk; reload before saving" on every try. A reload
  does not help, because the read is lossy again.
- The user's edits to such a note can never be saved. If they close the note,
  the edits are lost.
- The bytes on disk are never lost, so this fails safe.

This is a regression: before this change the save went through. Callers should
get the hash from the raw bytes, for example by having the read return
`hash_of(bytes)` and passing that on. Another option is for `write_text_if` to
accept the old lossy digest only when the disk bytes are not valid UTF-8. Add a
test that saves a Latin-1 `.md` file through `write_text_if`.

### Checked and OK

- **F97-P2-5, the trash move**
  - A file moves by hard link with no replace, and a taken name tries the next
    free one.
  - If the link succeeds but removing the source fails, the error is returned
    and both names exist, so nothing is lost.
  - Without hard-link support it falls back to a plain rename, as before.
  - A folder rename never lands on a non-empty folder.
  - A name collision runs up to 1000 tries.
- **F97-P2-6 inside `checked_write`**
  - The merge (`:367`), `settle_prev` (`:444`) and `written` all hash with the
    same `hash_of`, so they agree with each other.
- **Docs map**
  - `images.remove` is gone from `DeletePaperUseCase` (`parts-1.ts:41`).
  - The renumbered hops and the debug `check: 12` line up.

### P3 (record only)

- A symlink, or a Windows file without hard-link support, is still trashed with
  a plain `rename`. That rename can replace a name another process takes in the
  race window.
- `docs/building/core/laws.md:73` still says that the trash move uses a
  replacing rename. That is now true only for those two cases.
- If the hard link succeeds and the source removal then fails (on Windows, a
  file open without share-delete), a hard link is left in the trash next to
  the live file.