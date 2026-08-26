# Overnight worklog — `feat/obsidian-vault-interop`

Running record of unattended work, newest last. Branch is not merged; review
before merging to `main`.

## Round 1 — Obsidian vault interop, groundwork

**Researched first.** The question was whether we can support Obsidian
plugins. We cannot, and should not try: plugins compile against
`obsidian.d.ts`, run inside Obsidian's renderer against its `App`/`Vault`/
`MetadataCache` singletons, and the popular ones reach past the public API
into private internals. Hosting them is a permanent breakage treadmill for a
small subset that happens to work.

What *is* worth doing is making our workspace folder a folder Obsidian can
open. Then the user's plugins work on our data and we implement no API. Three
gaps were found; two are closed by this round.

**Done**
- `aliases: [<title>]` on every mirrored file. Our filenames carry a kind
  suffix (`methods.note.md`), so an editor resolving `[[Methods]]` against
  basenames finds `methods.note` and gives up — every wikilink we emit was
  dangling outside the app. `aliases` is the key Obsidian consults before
  failing, so declaring the title there fixes resolution without giving up the
  suffix.
- Tags hyphenated in the mirror (`obsidianTags`). A tag with a space is not a
  tag in Obsidian's grammar and is dropped silently; the stored tag is
  untouched, only the mirror is normalized.
- 7 tests in `packages/core/test/workspace/obsidian-interop.test.ts`, including
  the round trip proving the new key is ignored on the way back in.

**Not done, and why**
- Note tags: `VaultPage` has no tag field. Tags are paper-only in this model,
  so there was nothing to emit. Not a gap — a wrong assumption, corrected.
- Widening the frontmatter *reader* to tolerate YAML an outside editor writes
  back. That only matters once the folder is two-way, so it is Phase 3 of the
  plan below rather than work done blind now.

**Docs**
- `offline-first-sync.md` and `desktop-editor-workspace.md` moved from
  `plans/future/` to `plans/completed/` — both shipped, both still listed as
  proposals. Inbound links in `billing-and-quota-plan.md` and
  `pricing-strategy.md` repointed.
- New proposal `plans/future/live-vault-folder.md`. The finding behind it: of
  1,396 lines in `packages/core/src/workspace/`, only `serializeWorkspace` and
  `workspaceSnapshotCounts` have callers outside the directory.
  `deserializeWorkspace`, `snapshotDelta`, `FsPort`, `GitPort` and
  `folderMirror` have none. The folder is a download with no way back; the
  half of the design that made it *the* representation was built and never
  wired.
