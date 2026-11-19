# Files-first server (0.9.4)

From 0.9.4 your notes, papers and annotations live as files in your workspace
(and in your GitHub repo). The server keeps only what files cannot do alone:
who may see what, the live copy of a document people are editing together, and
a short queue for SDK results. This page explains those three parts.

Code: `apps/relay/server/src/collab/` and `apps/relay/server/src/sdk_inbox.rs`.
Tables: `db/migrations/0161_files_first_server.sql`.

## Grants: who may see what

A grant says "this person may view, comment on or edit this item (or every item
in this project)". Only the owner creates or revokes a grant. A project grant
counts only for documents the same owner shared, so nobody can give themselves
access to someone else's document.

| Route | What it does |
| --- | --- |
| `POST /grants` | Create a grant (`scope` item or project, `target_id`, `grantee_user`, `permission`, optional `expires_at`). Item grants need you to own the shared doc. |
| `GET /grants?target_id=…` | List your grants for one item or project. |
| `DELETE /grants/{id}` | Revoke. Everyone connected re-checks their access at once; a revoked user is told `revoked` and disconnected. |

Revoked grants stop counting straight away. Expired grants stop counting on the
next update a socket sends (the SQL function `shared_doc_access` checks the
expiry); an open socket with no edits is not re-checked on a timer yet. Grants by share link are stored but not used
by the live socket yet.

## Shared documents: editing together

When you share a document, the app sends its current Yjs state with
`POST /shared-docs/{item_id}`. People with access then connect to
`GET /collab/ws/{item_id}` (a WebSocket). Your session token travels in the
`Sec-WebSocket-Protocol` header next to `wf.v1`, never in the URL.

What happens on the server:

1. **Every edit is written to disk first.** Each update is appended to a small
   log file (`COLLAB_LOG_DIR/<item>.ylog`) and flushed before anyone else sees
   it. If the relay crashes, it replays these logs when it starts again.
2. **Every 2 seconds** the server saves the full document to `shared_docs` and
   empties the log. It also saves when the last person leaves and when the
   relay shuts down.
3. **Only people who may write can write.** Viewers get every change but their
   edits are refused (`read-only`). Access is re-checked while you edit, so a
   revoked grant takes effect within seconds.
4. **One device writes the file back.** Devices ask for a 90-second lease
   (`lease.acquire`) and renew it. Only the lease holder writes the shared doc
   back into the owner's workspace files. When it hands over, others hear
   `lease.handover`.
5. **The save log is part of the document.** Who saved what and when is a map
   inside the Yjs doc itself, so it survives restarts like any other edit.

### Stopping sharing

`DELETE /shared-docs/{item_id}` (owner only):

- If a device holds the lease, the doc is marked `closing` and everyone hears
  `closing`. New edits are refused. The lease holder writes its final copy back
  to the files, sends `final`, and then the server deletes the doc. The reply
  is `202 {"status":"closing"}`.
- If no device holds the lease, the doc is deleted at once:
  `200 {"status":"deleted"}`.

### Restoring an older version

`POST /shared-docs/{item_id}/state` (owner only) replaces the state and bumps
the doc's **epoch**. Everyone connected gets a `rejoin` message with the new
epoch and reconnects. A client that connects with an old `?epoch=` is told to
rejoin instead of mixing old edits into the restored copy.

### Feeds

Docs of kind `feed` are not opened over the socket (`409`).

## SDK inbox

With `SDK_INBOX=1` on the relay, SDK metrics and artifact metadata are queued in
`sdk_inbox` instead of written to tables. The desktop app picks them up and
writes them into your files:

| Route | What it does |
| --- | --- |
| `GET /api/sdk/inbox?device=…&after=…` | Claim up to 100 rows for this device for 90 seconds. |
| `POST /api/sdk/inbox/ack` | `{"ids":[…],"device":"…"}` deletes the rows this device claimed that are now in your files. Repeating an ack is harmless. |

While the inbox is on, artifact *files* are refused (`415`); send JSON metadata. A JSON body with a
`dataBase64` or `data` field is refused (`415`) too, and nothing is queued.

Rollout order: set `SDK_INBOX=1` on the relay first, then apply migration `0162`. With it off,
SDK metrics are written as the user, and `0162` revokes that write.
With `SDK_INBOX` unset, nothing changes.

## Legacy tables

`0162_legacy_write_revoke.sql` stops signed-in users writing the old per-item
tables (papers, notes, experiments and so on). They can still read them for the
one-time import. Apply it only with the 0.9.4 release: older clients still write.

## Running it

| Setting | Default | Notes |
| --- | --- | --- |
| `COLLAB_LOG_DIR` | `./collab-log` | Must be a persistent volume, or unsaved edits are lost on redeploy. |
| `SDK_INBOX` | unset (off) | `1` turns the inbox on. |

Tests: `cargo test -p wf-relay-server` (see `tests/collab_*.rs` and
`tests/sdk_inbox.rs`).
