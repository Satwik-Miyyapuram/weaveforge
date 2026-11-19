# web-clone

TS home (web only, no desktop path): `apps/web/src/features/workspace/infrastructure/`
`opfs-clone.ts` (`WebClone`, the `GitRemote` port, `gitBlobSha`), `github-remote.ts`
(`createGithubRemote`), `github-token-memory.ts` (`createGithubToken`) and the OPFS adapter
`BrowserWorkspaceFs` in `parts.ts`.
Tests: `apps/web/src/features/workspace/test/` `opfs-clone.test.ts`, `github-remote.test.ts`,
`github-token-memory.test.ts`, `browser-workspace-fs.test.ts`.
Plan: decision D-1a and lane L12 in `docs/plans/current/files-first-093.md`.

## What it does

The web app keeps a full clone of the user's workspace repo in the browser's private file
storage (OPFS), so it works on the same files as the desktop app.

1. `clone()` reads the branch head and its whole tree (`GET /git/ref`, `/git/commits`,
   `/git/trees/<tree>?recursive=1`). No file bytes are fetched. The result is written to
   `.weaveforge/local/web-clone.json`: the head commit and, per path, the git blob id and whether
   the bytes are here. A tree GitHub reports as `truncated` is an error, never a partial clone.
2. `read(path)` fetches a file's bytes (`GET /git/blobs/<sha>`, raw) the first time it is opened.
3. `changes()` compares each file's git blob id (SHA-1 of `blob <size>\0<bytes>`) with the
   manifest. An unopened file counts as unchanged. A file missing from disk whose bytes were
   here is a delete. `remove(path)` deletes a file, opened or not, so the next push deletes it.
4. `pull()` takes in the remote's changes, file by file:
   - changed only there: take theirs (an unopened file stays unopened);
   - changed on both sides: the remote text stays at the path, the web text is written beside it
     as `<name>.conflict-<YYYYMMDDTHHMMSSZ>.<ext>` (the desktop's `conflict_copy_path` name),
     with `-2`, `-3` added when that name is taken;
   - deleted there, edited here: the file stays, as a new local file;
   - deleted here, changed there: the remote file comes back.
5. `push(message)` makes one commit on top of the manifest's head: blobs (`POST /git/blobs`), a
   tree on the parent's tree (`POST /git/trees`, `sha: null` deletes), the commit, then
   `PATCH /git/refs/heads/<branch>` with `force: false`. GitHub's 422 there means the branch moved
   on: the push returns `behind` and nothing is changed locally.
6. `sync(message)` pulls, pushes, and on `behind` pulls and pushes once more, then gives up with an
   error. Nothing is ever reset or force-pushed.

Shared-item files are left out of pushes unless this tab holds the write-back lease (D-8a): the
`isShared` and `leaseHeld` options. The lease protocol itself is not built yet.

The GitHub token is an 8-hour access token held in a closure (`createGithubToken`), never in
localStorage, sessionStorage, IndexedDB or a cookie. A token with under 5 minutes left is
refreshed before use, asks during a refresh share it, and a 401 refreshes once and retries once.
When the server reports the grant revoked, `onReconnect` runs once.

`BrowserWorkspaceFs.writeFile` writes through a writable stream. When a write fails (a full
disk: `QuotaExceededError`), the stream is aborted, the old bytes stay, and the error reaches the
caller.

Not wired yet: the server routes that hand out and refresh the token, the connect UI, and the
lease. File modes are always `100644`.

## Laws

Each law is a fast-check property test over random inputs.

| Law | Test |
| --- | --- |
| A pull never loses a local edit: after any history of local and remote edits, deletes and pulls, every local edit is at its path or in a conflict copy. | `opfs-clone.test.ts` "law: a pull never loses a local edit; it stays at its path or in a conflict copy" |
| After `sync`, local files match the remote and nothing is unpushed. | `opfs-clone.test.ts` "law: after a sync, every local file matches the remote and nothing is unpushed" |
| A token handed out never runs out within the next minute. | `github-token-memory.test.ts` "law: a token handed out never runs out within the next minute" |
| The last write to each OPFS path is what a read returns. | `browser-workspace-fs.test.ts` "law: the last write to each path is what a read returns" |
