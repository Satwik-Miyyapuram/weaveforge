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
├── <project>/                    one folder per project: name--id, e.g. thesis--8d7317
│   ├── notes/  papers/  reading-lists/  report/  experiments/  plan/  logbook/
│   └── .weaveforge/
│       ├── mirror.json           the last-agreed copy of this project's files
│       ├── manifest.json         a summary of what is in this project
│       └── tags.json, relations.json …
├── assets/                       images and figures, shared by every project
└── .weaveforge/
    ├── db/                       the local database, shared by every project
    └── db-backups/               compressed snapshots of it
```

A project's folder is its name plus a short id, so two projects may share a name
and renaming one moves its folder rather than merging it with another's. Its
Markdown, its PDFs and its own bookkeeping travel together; the database and the
assets are shared, because a note in one project may show a figure from another.

Everything under a `.weaveforge/` is the app's own bookkeeping. Move the whole
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

### What the folder can change

Two things in the folder are read back in, through the same preview. The Markdown,
and the three JSON data files each project keeps in `<project>/.weaveforge/`:

- `relations.json` — the typed edges between papers,
- `tags.json` — the project's tags,
- `reading-list-items.json` — which papers and notes are in which reading list.

Add an edge by hand, rename a tag, drop a paper from a list: the import offers it
the way it offers an edited note — created, changed or removed, with the counts
shown and nothing written until you agree. A row whose id already exists is
updated rather than duplicated, and an edit made in the app *and* in the folder
since they last agreed is a conflict to settle rather than a guess.

Three things are the app's own and are never imported:

- the database and its backups — `.weaveforge/db`, `.weaveforge/db-backups`,
- the caches — `papers/pdf`, `papers/html`, `.weaveforge/cache`,
- the mirror's record of what it wrote — `mirror.json` and `manifest.json`. That
  record is what lets the app tell its own writes from yours: the mirror rewrites
  these files whenever the data changes, and without it every sync would report
  itself as an outside edit.

**The mirror never writes over a file you have edited since it last wrote it.**
A change made in the folder is left exactly where it is, reported as an outside
change, and applied only when you say so through the import. Once it has been
applied the two sides agree again, and the next sync writes normally.

### Resolving a conflict

A file both sides changed is only a conflict when the changes collide. A tag added
in the folder while a paragraph was rewritten here is two edits to one note, and
the import settles it without asking: a frontmatter key only one side moved is
taken from that side.

What is left is shown file by file, and settled the way git settles it:

- **Frontmatter, per key, three-way.** The base is the value the two sides last
  agreed on, which the mirror recorded, so a key is in dispute only when both
  sides moved it *differently* — and both values are shown against the base.
- **The body, hunk by hunk, two-way.** `-` is this app's copy and `+` the
  folder's, and each hunk is kept or taken on its own. A hunk you do not touch
  stays as this app has it. There is no base text to show, because the mirror
  keeps a digest of a body rather than a copy of it.
- **Whole-file shortcuts**, for when one side obviously wins: keep this app's
  copy, take the folder's, or keep both — the last imports the folder's copy as a
  second note named `… (from folder)` and discards nothing.

**Or settle it in your editor.** "Write conflict markers" puts both copies into
the file, marked:

```
<<<<<<< this app
…
=======
…
>>>>>>> the folder
```

Two-way on purpose: a three-way block needs the text the sides last agreed on,
and a digest is not text. Frontmatter is not marked at all — it is key-value
data, and where two keys disagree the app settles them one at a time. A file
still carrying markers is **unresolved**: it is never imported, the mirror never
writes over it, and it keeps being reported as an outside change. Take the
markers out and the file as it stands is the answer — the next import shows it as
an ordinary edit.

Nothing on any of these paths is written until you say so, and a conflict you
leave alone keeps this app's copy.

**Handwriting overlaps.** An ink note's strokes are pages in `.ink/<note id>/`,
written beside the note rather than inside it, so settling a conflict decides the
note's *text* and nothing else: both sides' pages stay and are drawn together.
Strokes have one home — the workspace folder while one is open, the account's
storage otherwise — so two devices' handwriting meets where their homes meet.


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
