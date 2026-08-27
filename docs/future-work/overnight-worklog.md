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

## Round 2 — reading YAML we did not write

The frontmatter parser was deliberately narrow: scalars and flow lists, no
YAML library, no deserialization surface to attack. Right for a format we
emit; wrong the moment the folder is two-way, because every other editor
writes lists as indented blocks, not `[a, b]`. A file round-tripped through
Obsidian would have come back with its tags silently gone.

**Done** — the *reader* widened, the writer untouched, so output stays
byte-identical and git diffs stay meaningful:
- block lists (`tags:` then `  - alpha`) parse as lists
- single-quoted scalars unquote, including YAML's doubled-quote escape
- a nested map under a key is consumed and leaves *no* key, rather than a
  misleading empty string — a half-read map is worse than an absent one
- indentation now decides what belongs to which key, so a key following a
  block list is still read

7 more tests (core 950 → 957), including one asserting that what we write
still reads back and re-serializes byte-identically.

Still deliberately absent: anchors, multi-line scalars (`|`, `>`), comments.
Comments were skipped on purpose — stripping an unquoted `#` would eat the
`#tag` values people actually write.

## Round 3 — code reduction, then Phase 1 of the vault folder

**Reduction first, and it is exhausted.** Wrote a scanner over every tracked
`.ts`/`.tsx` looking for exports referenced exactly once — the declaration and
nothing else. Result: **zero**. The commit before this branch (`0dac0e4`,
"drop eight exports nothing calls") already took what there was. A looser scan
finds 499 exports with no consumer outside their own file, but those are
mostly `export const` on things used one line below; dropping the keyword
tightens the surface without removing a line, and churns a lot of files to do
it. Not worth it unattended.

Current size: 91,254 lines of source, 117,291 including tests. The one real
outlier is `apps/web/src/features/reader/ui/pdf-reader/pdf-reader.tsx` at
1,726 lines — 2.4× the next largest file. That is the reduction target worth
having, and it is a careful extraction rather than a sweep, so it is queued
rather than done at 3am.

**Phase 1 of `live-vault-folder.md` instead**, which activates dead code
rather than adding to the pile:
- `NodeWorkspaceFs` implements the existing `IWorkspaceFs` against a real
  directory. Every path is checked twice — `safeWorkspacePath` for `..` and
  absolutes, then a `realpath` containment check, because the one way out that
  string checking cannot see is a symlink planted inside the folder
- `verifyRoot` decides which directories may be handed to us at all: empty, or
  already carrying `.weaveforge/`. Anything else is refused, because writing a
  workspace scatters a file per entity and pointing it at `Documents/` would
  bury a person's own files among a thousand of ours
- Six IPC channels, and the renderer names no path on any of them. It asks for
  a dialog; the chosen root stays in the main process
- 18 tests (desktop 54 → 72), including the symlink escape and the "forgetting
  the folder is the app looking away, not a delete" case

The `DesktopBridge` contract in the web app is the single definition both
sides compile against, so the preload could not be written wrong here.

## Round 4 — the two operations the mirror needs, and a folder that persists

`mirrorWorkspace` calls `stat` before every write and `remove` for every file
that has left the workspace. Round 3 shipped neither over IPC, so the port was
real but the mirror still could not run against it. Two channels close that:

- `vault-stat` and `vault-remove`. `removeVaultFile` is never recursive, on
  purpose: the mirror only ever deletes files it wrote, and a recursive delete
  reachable from the renderer is a much larger thing to get wrong than the
  convenience is worth
- The chosen folder is remembered in the preference store under `vault-root`
  and taken up again on launch — but **re-verified**, not trusted. A path in a
  preference file is a claim about last week's disk. `restoreRoot` runs it back
  through `verifyRoot`, and a folder that is now somebody else's is dropped
  *and* un-remembered rather than silently refused every launch
- The restore is deliberately not awaited at startup. A remembered root can be
  a disconnected network share, and the window should not wait on it

Desktop tests 72 → 78.

## Round 5 — the mirror finally has a caller

`mirrorWorkspace` has existed, tested, with zero callers since it was written.
Two pieces in a new `apps/web/src/features/vault-mirror/` give it one:

- `DesktopVaultFs` wears `IWorkspaceFs` over the bridge's six folder calls.
  Two methods have no channel and are satisfied locally: `mkdirp` is a no-op
  because a write creates its parents on the far side, and a channel that makes
  empty directories is a channel that can litter a folder with them; `rename`
  is a copy and a delete, which is what a rename across a process boundary
  would be anyway
- `createMirrorRunner` debounces, coalesces, and — the part that matters —
  remembers what the last run wrote. `previousPaths` is how the mirror knows
  which files have departed, and it has to outlive the process. It lives in
  `.weaveforge/mirror.json` **inside the folder**, not in local storage: the
  folder can be opened on another machine, and a manifest that travelled
  separately from the files it describes would name paths that were never
  written there and delete files it did not own. A missing manifest degrades to
  "remove nothing" — a stale file is visible and fixable; a wrongly deleted one
  is not
- A request that lands mid-run is re-run afterwards rather than folded into a
  snapshot taken before the save happened, and a `suspended` flag lets the
  Phase 3 read-back stand the mirror down so the two directions cannot chase
  each other
- A mirror failure is reported through `onError`, never thrown. Supabase is the
  source of truth; losing a mirror write costs a stale file, failing the save
  that triggered it would cost the user their edit

12 tests (web 897 → 909). Phase 2 of `live-vault-folder.md` is done bar the
wiring into the save path, which needs a UI affordance for choosing the folder
and is the next round's work.


### Correction to Round 5

Round 5 above says `mirrorWorkspace` had zero callers. That is wrong, and the
commit message repeats it. `syncToFolder` in
`apps/web/src/features/workspace/application/workspace-folder.ts` has driven it
against a browser-picked folder or OPFS all along; the "zero callers" line came
from a Round 3 measurement of `packages/core` alone and I carried it forward
without re-checking.

The consequence was worse than a wrong sentence: the new `vault-mirror` feature
was a second copy of machinery that already existed — `activeFs`,
`lastWrittenPaths`, the mirror call itself. It has been deleted and folded into
the `workspace` feature instead, which is a net reduction rather than an
addition:

- `DesktopWorkspaceFs` joins `BrowserWorkspaceFs` in
  `features/workspace/infrastructure/`, so the desktop folder is a third
  backing for a port the app already targets, not a parallel path
- `mirror-manifest.ts` holds the persisted `previousPaths` and the coalescer.
  They live apart from `workspace-folder.ts` because that module reaches for
  the app container on its first line, and neither of these needs one — which
  is what makes them testable against an in-memory filesystem alone
- The manifest fixes a real defect in the existing code, not just a gap in the
  new: `lastWrittenPaths` was in-memory, so a reload lost the record and every
  file the workspace had since dropped stayed in the folder for good

25 tests across the two files (web 897 → 915). Registry untouched.

### Round 6 — The folder becomes reachable, and the reduction goal runs out

**Shipped.** Settings -> Folder now offers the desktop shell's own dialog when
there is a shell, replacing the browser picker rather than joining it, and takes
up the remembered root on mount. Every piece built in Rounds 4 and 5 -- the IPC
channels, `DesktopWorkspaceFs`, the persisted manifest -- is now reachable from
the app, which it was not before.

Auto-sync is still not wired, and the plan doc now says why instead of calling
it unfinished. `requestSync` needs a chokepoint the app does not have. There is
no mutation bus; `Outbox.append` is the nearest thing and only runs when offline
sync is switched on, so hanging the mirror there would give a folder that
updates itself for some users and not others. Recorded as Phase 2b, and it turns
out to have three consumers rather than one.

**Measured, before doing any more reduction work.** The standing instruction is
to reduce what we have written. The measurements say there is very little left
to take:

- 118,602 lines across 1,279 tracked source files -- mean 97 lines per file
- One file above 1,000 lines (`pdf-reader.tsx`, 1,726). The next largest is 712
- Duplicated 10-line windows across the whole tree: **2**, one of them an import
  block in two sibling tests
- Exports referenced nowhere outside their own file: 310, but every one that is
  a function or a value is used *inside* its own file. None is deletable. They
  are over-exported, not dead

So the honest read is that the size is feature breadth, not bloat, and the two
reductions still available are cosmetic: narrowing over-wide exports, and
splitting one outlier file. Splitting `pdf-reader.tsx` into three files of 570
lines is not less code, and its logic closes over roughly thirty pieces of
component state -- extraction would produce a props bag, which is relocation
dressed as reduction. Not done, deliberately.

**Researched.** Written up in full as `docs/plans/future/interop-surface.md`.
Two findings worth the round:

1. Hosting Obsidian plugins is not achievable -- a plugin is handed the live
   `App` object and Obsidian's Electron internals, so emulating it means
   reimplementing Obsidian against a contract nobody offers us. The ecosystem
   converged on a *local HTTP surface* instead, and that is what the browser
   extensions, scripts, and MCP servers are actually written against. Matching
   those routes gets the compatibility without the emulation, and Tier 1 -- the
   folder we already ship -- covers every plugin that works by reading and
   writing vault files, because the user runs it inside Obsidian against our
   folder.
2. Zotero has no working API for creating PDF annotations that appear in its
   reader; it is an open request as of 2026, and it blocks precisely the
   AI-assisted-reading and cross-reader-sync workflows people now want. We
   already store anchors in Zotero's position shape, so this is a much smaller
   piece of work for us than for a reader starting cold, and the resulting claim
   is checkable in one sentence: annotate here, open Zotero, the highlights are
   there.

Verification: core 957, web 915, desktop 78, 0 fail. `tsc` clean, `next lint`
clean, solid/dry/hygiene pass. Registry untouched.

### Round 7 — The seam, and the folder starts keeping itself up to date

Phase 2b, which Round 6 had recorded as the blocker. Three things wanted to
know that the workspace had changed and the app had nowhere to tell them from.

The chokepoint turned out to be the Supabase client itself. Every repository
base class was checked first -- `ProjectRepository` and
`ProjectScopedSupabaseRepository` hold a constructor and a project id, no write
helper -- so the shared thing further down is `db.from(table)`, which roughly
forty repositories reach for and none reach past. `watchWrites` wraps the client
once, at the single place it is created, and reports the table after a write
resolves without error. No call site changed.

The per-write alternative was rejected on maintenance grounds rather than
taste: forty edits that every repository written afterwards has to repeat, and
forgetting one leaves the folder silently stale for exactly one kind of edit.

Details that took the thinking:
- PostgREST answers errors in the payload rather than by rejecting, so success
  is `!result.error`, not "the promise settled"
- a write chain continues past the mutation (`.insert(...).select().eq(...)`),
  so the wrapper stays attached through the rest of the chain and reports from
  whichever object is finally awaited
- a listener that throws cannot fail a write that already succeeded, and cannot
  stop the other listeners hearing about it
- the mirror subscribes when a folder is opened, not when the module loads: a
  listener running with no folder would debounce, wake, find nothing to write,
  and sleep again on every edit for the rest of the session

Phase 2 is now complete end to end. A desktop user picks a folder in
Settings -> Folder and it keeps itself up to date from then on.

Verification: web 924 (was 915, +9 new), core 957, desktop 78, 0 fail. `tsc`
clean, `next lint` clean, solid/dry/hygiene pass. Registry untouched.
