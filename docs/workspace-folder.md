# The workspace folder

WeaveForge can keep a folder of plain Markdown on your disk that mirrors your
workspace, and read your edits back in. The folder is a normal folder: open it
in Obsidian, VS Code, or Finder, and everything in it is a file you can read
without WeaveForge installed.

Settings → Folder is where all of this lives.

## What gets written

One directory per kind of thing — `notes/`, `papers/`, `reading-lists/`,
`report/`, `experiments/`, `plan/`, `logbook/` — plus `assets/` for images and
a `.weaveforge/` directory holding the mirror's own bookkeeping.

Every file carries a `weaveforge-id` in its frontmatter. **That id is the
identity, and the filename is not.** Rename a note in Finder and it stays the
same note; move it to another directory and it is still that note. Filenames
carry a slug and a kind suffix (`methods--a1b2c3.note.md`) purely so the folder
is navigable by a human.

Links between notes are written as Obsidian-style `[[wikilinks]]`, so the folder
resolves as a vault in Obsidian with no plugin and no import step.

## Which direction things flow

Writing out is automatic. Reading back is not.

The mirror follows your workspace: save something in the app, and the folder
catches up a moment later. It is one-way and best-effort by design — the
database is the source of truth, and a folder that cannot be written (disk
unplugged, permission revoked) must never take your save down with it.

Pulling folder edits back in is always an explicit action, and always shows you
a diff first — "12 updated, 1 conflict" — before anything is applied. Applying
blind would overwrite the app's copy with no way back.

On desktop, WeaveForge watches the folder and tells you when something out there
changed. It reports; it does not apply. (Recursive watching works on Windows and
macOS. Linux gets no notification — a native watcher would mean a compiled
dependency in the installer for a convenience.)

## When both sides changed

The folder keeps a record of what each file said the last time the two sides
agreed. That record is what makes it possible to tell an edit made out there
from an edit made in here — without it, an import can only see that two copies
differ, and carrying the older one over the newer is a silent loss.

With it, most double edits are not conflicts at all. A tag added in Obsidian and
a paragraph rewritten in the app are two edits to one note, not two answers to
one question: frontmatter merges field by field, and the body follows whichever
side moved it. What is left — the same field set two different ways, or a body
both sides rewrote — is reported as a conflict naming the fields that actually
collided, and nothing is written over until you say which copy wins.

Three ways out, per file: keep this app's copy, take the folder's, or keep both.

## Dropping a file in by hand

Write `notes/My idea.md` yourself, with or without frontmatter, and import it.
WeaveForge creates the note and then writes the new `weaveforge-id` back into
your file, so the two are connected from then on. Without that step the same
file would import again on every pass, and one note would become two, then four.

The file you wrote is otherwise left exactly as you wrote it — the stamp adds an
id line and touches nothing else.

## Letting other apps in

The desktop app can serve the folder over HTTP, on this machine only, using the
same routes as Obsidian's local REST API — so tools already written for that
work against a WeaveForge folder without being changed.

It is off until you switch it on, in Settings -> Folder. Switching it on issues
a token and shows it once; every request needs it, and nothing shows it again.
Switching the surface off throws the token away, so turning it back on issues a
new one and the old one stops working.

What is served: reading, writing, deleting and listing files under `/vault/`,
and `POST /search/simple/?query=...`. What is not: the active note and the
command list. Both belong to the running app rather than to the folder, and a
shell answering for them would be guessing about a window it does not own.

The socket binds to `127.0.0.1` and nothing else, in code rather than in a
setting. Every path goes through the same containment check the mirror uses, so
the network surface is not the one way into the folder that skips it.

## Keeping a history

The desktop app can commit the folder after each write, giving you file-level
history in ordinary git that your own tools can read. Off unless you ask for it,
when you choose the folder.

It refuses in one case even when switched on: a folder sitting inside somebody
else's repository. Their history is not ours to write into, and a stray commit
in it is noticed long after it is easy to explain. A folder with no repository
gets one of its own.

## Safety

- Paths are folded and checked before any write: `..`, absolute paths, and drive
  letters are refused, so nothing the app writes can land outside the folder you
  picked.
- Only files the serializer owns are ever removed. Your own notes, a
  `.obsidian/` directory, an editor's scratch files — all left alone.
- The mirror's record lives in the folder it describes, not in local storage, so
  a manifest can never name paths belonging to a different folder.
- Browser folder permission is per-session and deliberately not persisted;
  silently reacquiring write access to a folder you picked days ago is not
  something to do on your behalf.

## Related

- `docs/plans/future/live-vault-folder.md` — the plan and its phases.
- `docs/plans/future/interop-surface.md` — what else talks to WeaveForge.
