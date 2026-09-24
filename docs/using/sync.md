# How your work is stored and synced

This page is the whole picture: where your work physically lives, what syncs,
when it syncs, and what happens when two devices disagree. It is written to be
read before you trust it with something, not after.

Three things move, and they move on different paths. Keeping them apart in your
head is most of understanding the system:

| what | where it lives | how it travels |
| --- | --- | --- |
| **Your writing** — notes, papers, the logbook, plans | the app's local database, plus a Markdown mirror in your workspace folder | the folder is written locally; your account sees it only if you turn on Sync |
| **Files you attach** — PDFs, figures | your workspace folder, and the account if Sync is on | with the notes, as blobs |
| **The database itself** | `<your workspace folder>/.weaveforge/db` once it has moved, otherwise WeaveForge's own directory | never synced as a file; only its *contents* travel |

## One folder, one backup

The point of putting the database in your workspace folder is that backing the
folder up backs up the app. That is the arrangement:

```
<your chosen folder>/
├── notes/  papers/  reading-lists/  report/  experiments/  plan/  logbook/
├── assets/                       images and figures
└── .weaveforge/
    ├── db/                       the local database
    ├── db-backups/               compressed snapshots of it
    ├── manifest.json             what the mirror believes it wrote
    ├── mirror.json               the last-agreed copy of each file
    └── tags.json, relations.json …
```

Everything under `.weaveforge/` is the app's own bookkeeping. Move the whole
folder to another machine, point WeaveForge at it, and you have everything —
including the database.

**The move happens once.** The first time you choose a folder that has no
database of its own, the one in WeaveForge's directory is copied into it. After
that the destination is simply where the database is, and starting the app does
no copying at all. The original is deliberately **left in place** rather than
deleted: it costs disk, and it is the thing that saves you if the folder turns
out to be a USB stick that gets unplugged next week.

If the move cannot be completed safely, WeaveForge keeps using the database in
its own directory, says so in the log, and **does not try again for that
folder**. A failure costs you the convenience, never the data. Settings →
Workspace shows you the path actually in use, so you never have to guess which
of the two you are on.

## The Markdown mirror

Your writing is stored in the local database first and always. Writing the
Markdown files is a separate, one-way, automatic follow-up: save something in
the app and the folder catches up a moment later.

It is one-way and best-effort on purpose. The database is the source of truth,
and a folder that cannot be written — disk full, permission revoked, drive
unplugged — must never take your save down with it.

Reading folder edits back **in** is never automatic. It shows you a diff first
("12 updated, 1 conflict") and applies nothing until you agree. On desktop the
app watches the folder and tells you when something out there changed; it
reports, it does not apply.

Every file carries a `weaveforge-id` in its frontmatter, and that id — not the
filename — is the identity. Rename a note in Finder and it is the same note.

## Syncing to your account

Sync is **off until you turn it on**, and turning it on is the only thing in the
app that asks for an account. Everything works with the network off.

Once it is on, the shape is:

- **Every write is recorded locally first.** Nothing waits on a network.
- **Writes are queued in an ordered outbox**, each with an id the server
  de-duplicates on, so an operation whose fate is unknown after a dropped
  connection can be sent again safely. A create followed by an edit cannot
  arrive the other way round.
- **A cycle pushes, then pulls.** Sending first matters: if the pull went first
  it could overwrite a local edit and then send that edit as though it had been
  made against what the server already had, hiding a lost change. Pushing first
  means the server sees the collision and it is reported.
- **The pull reads a change feed** ordered by the server's own sequence number.
  The device remembers how far it has read, and the watermark only ever moves
  forward — a pull that answers out of order must not cause changes to be
  applied twice, which for a delete that has since been re-created locally would
  be data loss rather than wasted work.

### When it runs

Sync runs **while the app is open**, on three triggers:

1. **When you start the app**, because there may be a backlog from last time.
2. **When the network comes back**, because the machine tells us so.
3. **On a timer**, for the failure nobody announces: a socket that died without
   an event, a token that expired quietly.

There is no setting for the interval, and that is deliberate — it is a safety
net, not the mechanism. A cycle also cannot overlap itself: the interval and the
network-recovery event can fire together, and two concurrent pushes of the same
outbox rows would send what the first already sent, which the conflict log would
then report as a conflict with itself.

Sync does **not** run when the app is closed. Nothing is written in the
background, there is no daemon, and closing the window stops it.

### When two devices disagree

Every row carries a version. A queued write says which version it was based on,
and the server accepts it only if that is still the current one. If it is not,
the write is not applied and not silently discarded — it becomes a **conflict**,
with both sides kept.

That is what makes working offline safe: you can edit on a train, edit the same
thing on a laptop, and nothing is thrown away without you seeing it. Conflicts
are listed with the fields that actually collided, and resolved by choosing a
side, field by field. Nothing is written over until you choose.

What is *not* merged automatically is the body of a document — two people
rewriting the same paragraph is reported, not guessed at.

### Working together, live

Two people can edit one document at the same time and see each other's changes
as they happen. That document is a CRDT: each edit is a change that can be
applied in any order and still converge, so there is no "whoever saved last
wins" and no lock. This is the one place where the app is closer to real-time
than a file-sync tool, and it is why an open document does not fight the
row-level sync described above.

## What is not synced

- **The database as a file.** Only its contents travel. Two devices do not
  exchange database bytes.
- **The Markdown folder.** It is a local mirror, not a sync channel. If you want
  it in git, the desktop app can commit after each write — off unless you ask,
  and it declines to commit into a repository it does not own.
- **Your workspace choice itself.** Which folder you picked is a property of
  this machine, like a window position.
- **Anything, while the app is closed.**

## Related

- [The workspace folder](workspace-folder.md) — the mirror, in detail.
- [The desktop app](desktop.md) — the local database and its backups.
- [Collaborative editing](collaborative-editing.md) — two people in one document.
