# Editor workspace — redesign

**Status:** design approved for hand-off. No application code has changed yet.
**Verified against:** `main` at `d2dcc35` (2026-09-11). Every `file:line` below was
re-read at that commit.
**Prototype:** [`editor-workspace-redesign.html`](editor-workspace-redesign.html) —
open it in any browser. The strip at the bottom switches **Proposed / Current
build** and the Paper / Mocha / Amoled palettes, opens the command palette
(`⌘P`), flips the document between **Source view** (what ships) and the read
view (`⌘E`), opens the **Ink note** tab (§3.3), and toggles the empty state.
The bottom panel's Problems / Output tabs, the Output channel filter and `⌘J`
work in the prototype. Every claim in this document is visible there side by
side.

---

## 0. Hand-off brief — read this first

This section is for whoever implements the plan in §5. It is complete on its
own; the rest of the document is the reasoning behind it.

### Paths

Paths are written relative to `apps/web/src/` unless they start with `apps/`,
`packages/` or `docs/`. So:

| Written as | Means |
| --- | --- |
| `features/editor-workspace/…` | `apps/web/src/features/editor-workspace/…` |
| `styles/…` | `apps/web/src/app/styles/…` |
| `themes/…` | `apps/web/src/app/themes/…` |
| `components/…` | `apps/web/src/components/…` |
| `app/…` | `apps/web/src/app/…` |
| `container/…` | `apps/web/src/container/…` |

The screen lives in `features/editor-workspace/` (`application/` pure logic,
`ui/` React, `test/` node tests), its route is `app/workspace/page.tsx`, and its
stylesheet is `styles/editor-workspace.css`. The module is registered in
`features/editor-workspace/module.ts` with `desktopOnly: true` — it only appears
in the Electron build, so **test it in the desktop build**, not the web one.

### Rules of the repo (non-negotiable)

- One branch for the whole plan, one PR per step (§5), squash-merged to `main`
  only when the step's checks pass. Never commit directly to `main`.
- Stage files by explicit path. Never `git add -A` or `git add <dir>/`.
- Sign commits: `git commit -s`. Commit messages are Conventional Commits
  (`feat(editor): …`, `fix(editor): …`).
- Do not touch the Windows registry, ever, for any reason.
- Do not change `packages/core`. The document model, `KIND_SUFFIX`, the
  reading-list domain and the folder layout are the source of truth this design
  reads *from*; nothing here needs them changed.
- Do not change `features/editor-workspace/application/pane-tree.ts`,
  `layout-storage.ts`, `quick-open.ts` or `keybindings.ts` beyond what a step
  names. They are pure, tested, and correct.
- Do not add a dependency. Every icon is inline SVG on the app's 24 px grid.
- Do not add colours. Every colour is a `--token` from `themes/`.
- No mobile variant. The route gates on `desktop()` (`app/workspace/page.tsx:30`).
- No terminal, no shell. The desktop app does not expose one and this design
  does not add one (§3, bottom panel).

### Commands

```bash
# unit tests for this feature (run from the repo root)
cd apps/web && TSX_TSCONFIG_PATH=tsconfig.test.json node --import tsx --test src/features/editor-workspace/test/*.test.ts
```

```bash
# what CI runs on every PR — all must pass before you push
npm run typecheck && npm run lint && npm run check:boundaries && npm run test:web
```

```bash
# check:boundaries includes check:docs; if it fails, regenerate and commit the two files it names
npm run docs:generate
```

```bash
# desktop build to look at the result (run in apps/desktop, in this order — build wipes dist/)
npm run build && npm run build:web && npx electron-builder --dir
```

The packaged app is `apps/desktop/release/win-arm64-unpacked/WeaveForge.exe`
(`win-x64-unpacked` on x64). Open Library → Editor.

### Definition of done for the whole plan

- Every defect in §2 (D1–D7) is fixed, with the test named in §5 added.
- The explorer is three stacked sections — **Files** (Notes, Papers, Report),
  **Reading lists**, **Outline** — each with its own header and collapse, the
  way VS Code's Explorer stacks Folder / Outline / Timeline. Reading lists is
  built from real reading lists and is a view over Files, not a fourth root.
- The screen matches the **Proposed** view of the prototype at 1440×900 in the
  Paper, Mocha and Amoled themes — same chrome, same icons, same spacing.
- `npm run check:all` passes.
- `docs/internal/plans/completed/desktop-editor-workspace.md` gets one line
  under its status noting the redesign shipped, with the PR numbers.

### Decisions already taken (do not re-ask)

1. **Icon rail, not a toggle.** On `/workspace` the primary nav is always the
   48 px rail. No per-device preference.
2. **The Library sub-nav strip is hidden on `/workspace`.** Document tabs
   replace it; the rail keeps Papers / Notes / Graph one click away.
3. **Bottom panel is Problems + Output only.** No Terminal tab. It is step 9
   and optional: ship steps 0–8 first, do 9 only if the owner asks.
4. **Documents are `.md` files and the UI says so.** Every document row, tab,
   crumb and palette hit carries its kind suffix (`.note.md`, `.paper.md`,
   `.list.md`, `.report.md`) as `KIND_SUFFIX` spells it
   (`packages/core/src/workspace/folder-layout.ts:47-55`). §3.2 says where it
   shows and where it hides.
5. **Reading lists are a second explorer section, not a fourth root.** The
   explorer is a stack of sections — Files, Reading lists, Outline — each
   collapsible. Files is the mirror folder, complete, no duplicates. Reading
   lists nests as the lists nest with papers and notes as dimmed member rows
   that open the same tab. Same document in two sections is a second lens, not
   a second copy; that is what a list is for. §3.1.
6. **Every per-kind decision is a table keyed by kind.** Icon, tint, suffix,
   document renderer, status-bar segments. Handwritten (ink) notes arrive later
   as one more row in each table, not as a special case. §3.3.
7. **A document has two modes, Edit and Read, per tab.** Edit is the shipped
   CodeMirror source editor (`CollabBodyHost`) and stays the default. Read is
   the notes screen's `VaultMarkdown` renderer, reused, not rewritten. `⌘E`
   toggles. No live-preview / WYSIWYG editor. §3.9.
8. **An ink note is one `.ink.md` file.** Frontmatter, then the recognised text
   as the markdown body, then the strokes in a fenced ` ```ink ` block at the
   end. No sidecar, no binary. The text layer is what search, backlinks, the
   wiki lint and git diff see. Stroke capture uses Pointer Events with
   pressure; recognition is a pluggable engine behind one interface. §3.3.

---

## Fidelity — what in the prototype is real

The prototype is built to be the final product's look, not an impression of it.

- **Icons** are the shipped paths, copied verbatim from `app/nav-icon.tsx`
  (stroke **1.7**), `components/view-icons.tsx` (stroke **2**) and
  `components/chevron-icon.tsx`, at the right weight for their role and sized
  from `--nav-icon-size`. All eleven nav-icon paths were diffed against the
  source and match exactly.
- **The brand mark** is `components/weave-forge-logo.tsx` inlined, painting
  from `--text` / `--accent` / `--surface2` exactly as the component does.
- **Colours** are the real palettes. Every `--*` value in `themes/light.css`,
  `mocha.css` and `amoled.css` is carried across — 18/18 per theme, verified.
- **Type** is IBM Plex Sans / Serif / Mono, as `app/fonts.ts` loads them.
- **Components** reuse the shipped class names and treatments: `.status` pills
  from `styles/entity-detail.css`, `.tag-chip` from `styles/papers.css`,
  `.wikilink` and `.callout` from `styles/markdown.css`, the frontmatter block
  in the app's code-surface style.
- **Two glyphs are new** — a folder and a check — because the app has neither.
  They are marked as such in the sprite and explained under D5.
- **The command palette's scorer** is the real algorithm from
  `features/editor-workspace/application/quick-open.ts`, including the
  `matched` indices the shipped dialog computes and never renders.
- **The file suffixes** are the real `KIND_SUFFIX` values; the sample paths in
  the palette (`notes/baselines/graph-prior-module.note.md`) are shaped exactly
  as `flatPath` / `treePaths` shape them.
- **The source view** is the shipped editor's geometry — `lineNumbers()` gutter,
  `EditorView.lineWrapping`, `@codemirror/lang-markdown` tokens
  (`collaborative-markdown-editor.tsx:173`) — and its frontmatter is byte-for-
  byte what `serialize-workspace.ts` writes (`weaveforge-id`, `weaveforge-type`,
  `title`, `updated-at`, `created-at`, `aliases`). The remote caret with a name
  flag is `y-codemirror.next` with `pickColor(authorId)`.
- **The Problems rows** are the three real producers: `TexError`
  (`apps/desktop/src/tex.ts:58`, `file:line`), `LintFinding`
  (`packages/core/src/features/ai-assistant/domain/wiki-lint.ts`, dead-link /
  orphan) and the citation-key check. **The Output rows** are one line each
  from `mirrorWorkspace` (`MirrorResult`), `commitVault`, the Zotero local read,
  `compileTex` and `vaultChanged`. Nothing in the panel needs data the app does
  not already have.
- **The explorer sections** are the three of §3.1; the Reading lists tree is
  the §3.1 tree shape with member rows dimmed and one inherited row; Outline
  shows the headings of the read-view document and is collapsed by default.
  Collapse works. **Current build** hides the section headers and the two
  proposed sections, because the shipped tree has one root list.
- **The ink note is a mock.** The tool bar, text layer and file layout are the
  design; the handwriting is the OS handwriting face, not captured strokes.
  What it demonstrates is that the four kind tables in §3.3 are enough — the
  same tab, crumbs, status bar and panel hold an ink page with no special case.

**Rendered and checked.** The prototype was rendered in headless Chromium
(Edge) at 1440×900 in all six mode × theme combinations. Two rendering bugs
were found and fixed in the file: the inline `<svg>` elements had no `viewBox`,
so the 24-grid paths were cropped instead of scaled; and the brand mark used
React's camelCase attribute names (`strokeWidth`), which raw HTML ignores. Both
are the kind of thing a source read cannot catch — if you change the prototype,
render it again. Re-rendered 2026-09-11 after the source view, panel and ink
additions: read / source / ink × Paper / Mocha and Current build, no console
errors.

---

## 1. The finding that drives the whole redesign

The editor is not short of features. It is short of **window**.

`styles/editor-workspace.css:99-104`:

```css
.workspace-shell {
  display: grid;
  grid-template-columns: minmax(12rem, 16rem) minmax(0, 1fr);
  height: calc(100dvh - var(--nav-inset, 0px));
  min-height: 0;
}
```

`--nav-inset` is **232px on desktop** — `styles/nav.css:142`, inside the
`@media (min-width: 900px)` block — and it is the *horizontal* inset the app
shell uses to clear the 216px sidebar (`styles/shell.css:44-46`:
`.layout.has-nav { padding-left: var(--nav-inset); }`).

So the editor's **height** subtracts the sidebar's **width**. On desktop the
editor is sized to `100dvh − 232px` while the space actually available to it,
after the shell's 24px top padding, the ~66px sub-nav strip and the 40px bottom
padding, is about `100dvh − 130px`. It comes up roughly 100px short, so the panes
stop above the window edge and the leftover paints as page background.

That is the visible symptom. The cause is structural, and it is the same cause as
the cramped feeling:

```
232px  app primary nav (labelled sidebar)
216px  workspace explorer          ← the editor's own sidebar
 48–112px  .app-shell inline padding
────────────────────────────────
≈ 500px of chrome before a single line of the document
```

On a 1440px window, **35% of the width is navigation**, and the editor — the one
screen in the product that is genuinely about working in a large space — gets the
least of it. Every other screen is a list or a form and is fine at `--app-max`;
this one is a workspace.

### The proposal

When the route is `/workspace`, the shell changes shape:

| | Current | Proposed |
| --- | --- | --- |
| Primary nav | 232px labelled sidebar | **48px icon rail** (Obsidian's ribbon) |
| Shell padding | `24px … 92px` | **0** — the editor is full-bleed |
| Sub-nav strip | rendered above the editor | **hidden** — document tabs supersede it |
| Editor height | `100dvh − 232px` | **`100dvh`**, real grid, no magic number |
| Horizontal chrome | ~500px | **48px + 260px explorer** |

The rail keeps the full product one click away with tooltips and a 2px active
indicator; the explorer becomes the only sidebar; the editor gets the rest of the
window down to a status bar on the bottom edge. This is the VS Code and Obsidian
arrangement, and it is what makes those editors feel like an application rather
than a page.

**This is additive, not a rewrite.** The rail is the existing `TabBar` with the
collapsed variant it already has (`collapsed` prop, `app/tabbar.tsx:29`;
`app/app-shell.tsx:84` holds the state and `:130-138` applies it) driven by
route rather than by the menu toggle. No routing, registry or data change.

---

## 2. Defects found while designing

Seven, all in the shipped code, none a matter of taste. Each is fixed by a
numbered step in §5.

### D1 — `height` computed from a horizontal token · **the strip at the bottom** · fixed by step 1

`styles/editor-workspace.css:102` as above. Every other full-height surface in
the app uses `100dvh` and subtracts real vertical chrome — `body`
(`styles/base.css:111-112`), the pitch's
`--pitch-view: calc(100dvh - var(--pitch-head))` (`app/pitch/pitch.module.css:29`).
The editor is the one screen that must be full-bleed, which is exactly the case
the shell was not built for. The fix removes the calculation entirely rather
than correcting it.

### D2 — the "Start note" control can never render · **dead feature** · fixed by step 4

`features/editor-workspace/ui/explorer-panel.tsx:172`:

```tsx
{node.missingNote && onStartNote && node.id ? (
  <button type="button" className="explorer-start-note" …>Start note</button>
) : null}
```

`onStartNote` is an optional prop (line 50) and
`features/editor-workspace/ui/workspace-screen.tsx:258-264` never passes it.
`buildWorkspaceTree` sets `missingNote` on every paper without a note
(`features/editor-workspace/application/workspace-tree.ts:101`), so the tree
does the work and the button is always suppressed.

The styling for it is carefully written and documented — including a
`@media (hover: none)` override at `styles/editor-workspace.css:89-91` whose
comment explains that on a touch screen *"the button stayed at `opacity: 0` —
present, tappable, and invisible."* That comment describes a button that has
never rendered.

**How to wire it.** The paper document already exists for every paper —
`workspace-screen.tsx:93-98` loads one per row with `body: paper.summary ?? ""`,
and `:162` saves it through `container.papers.updatePaper.setSummary`. So
`onStartNote(paperId)` is simply "open the tab `{ kind: "paper", id: paperId }`
and focus the editor" — the same call the row's `onClick` makes. No new data
path.

### D3 — the explorer highlights the wrong tab · fixed by step 4

`features/editor-workspace/ui/workspace-screen.tsx:260`:

```tsx
activeKey={mounted.length > 0 ? tabKey(mounted[0]!) : undefined}
```

`mounted` comes from `openTabs(layout)`
(`features/editor-workspace/ui/pane-view.tsx:208-219`), which walks leaves in
order and returns tabs depth-first. `mounted[0]` is therefore **the first tab of
the first pane**, not the document being edited. With two or more tabs open the
tree highlights the wrong file, and it does not follow you when you switch tabs.

**The correct value** is `activeTab(leaf)` of the focused leaf
(`features/editor-workspace/application/pane-tree.ts:190-192`;
`layout.focusedPaneId` already exists). Write a pure helper
`activeTabKey(layout): string | undefined` in `application/pane-tree.ts` and
test it.

### D4 — clicking does not look like clicking · fixed by step 5

Three clickable elements explicitly set the wrong cursor, and the tab strip has
no hover state at all:

| Element | Declaration | Line |
| --- | --- | --- |
| `.explorer-row` | `cursor: default` (has `onClick`) | `styles/editor-workspace.css:30` |
| `.pane-tab` | `cursor: default` (has `onClick`) | `styles/editor-workspace.css:186` |
| `.quick-open-result` | `cursor: default` (is a `<button>`) | `styles/editor-workspace.css:290` |

`.pane-tab` also declares no `:hover` rule anywhere — only `.pane-tab.is-active`
(line 189). So document tabs, the single most-clicked control in the screen, do
not acknowledge the pointer. Everywhere else in the product hover and press are
treated as required affordances, with the reasoning written down
(`styles/base.css:84-96`, `styles/buttons.css:10-12`,
`app/pitch/pitch-header.module.css:52-53`).

### D5 — the editor is where the icon system stops · fixed by steps 0 and 3

The app has two hand-written SVG sets, both on a 24×24 grid, both with round caps
and joins, at two deliberate stroke weights:

| Set | Stroke | Where |
| --- | --- | --- |
| `app/nav-icon.tsx` | **1.7** | navigation — `home book list graph flask git pencil flag doc notes search` |
| `components/view-icons.tsx` | **2** | actions — `settings open delete share comments edit bookmark bell duplicate image unlink filter` |

plus `components/chevron-icon.tsx` (polyline `6 9 12 15 18 9`, stroke 2). Both
are sized from one token (`--nav-icon-size`, `styles/base.css:22`; `--icon-size`
for actions).

The editor is the one screen that steps outside that system, and it does so
everywhere at once:

| Element | What it draws | Where |
| --- | --- | --- |
| Explorer file types | `▸ ◆ ❐ ☰ § ⚗ ◎ ✎` — five Unicode blocks | `features/editor-workspace/ui/explorer-panel.tsx:16-25` |
| Tab close | the character `×` | `features/editor-workspace/ui/pane-view.tsx:160` |
| Split buttons | `▥` and `▤` | `features/editor-workspace/ui/pane-view.tsx:172,181` |
| Quick-open rows | no icon at all | `features/editor-workspace/ui/quick-open-dialog.tsx:94-95` |

Those glyphs are font-dependent — `⚗` (ALEMBIC) and `◎` (BULLSEYE) are routinely
substituted across Windows, macOS and Android, and sit on inconsistent baselines
at the same nominal size. The prototype replaces each with the nav icon that
already means that entity in the module registry, plus a per-type tint so the
kind reads at a glance without reading the glyph. This is the **kind table** —
one row per `TreeNodeKind`, and every later per-kind decision (§3.3) is a
column added to it:

| Kind (`TreeNodeKind`) | Icon | Tint token | Suffix (`KIND_SUFFIX`) | Source of the icon |
| --- | --- | --- | --- | --- |
| `vault_page` | `notes` | `--s-info` | `.note.md` | `features/vault/module.ts:7` |
| `paper` | `book` | `--s-warn` | `.paper.md` | `features/papers/module.ts` |
| `reading_list` | `list` | `--accent` | `.list.md` | `features/reading-lists/module.ts` |
| `report_section` | `doc` | `--s-good` | `.report.md` | `features/report/module.ts` |
| `experiment` | `flask` | `--s-warn` | `.experiment.md` | `features/experiments/module.ts` |
| `milestone` | `flag` | — | `.milestone.md` | `features/plan/module.ts` |
| `log_entry` | `pencil` | — | `.log.md` | `features/logbook/module.ts` |
| `folder` | **does not exist — draw it** | `--faint`, `--accent` when open | — | — |
| checkmark (status bar) | **does not exist — draw it** | — | — | — |

Only the first four kinds are in the tree today; the others are listed so the
table is complete and so adding one later is filling in a row.

**Two glyphs have to be drawn.** There is no folder icon anywhere in either set,
because the explorer has never drawn one — it uses the `▸`/`▾` twisty and a
Unicode glyph instead. There is also no check icon; the app's checkmark is the
character `✓` inside a `.check` span (`features/org/ui/org-switcher.tsx:61`,
`features/projects/ui/project-switcher.tsx:36`), which is fine in a menu row but
wrong in a status bar sitting among SVG icons. Both are drawn in the prototype's
sprite (`#i-folder`, `#i-check`) to the same contract; copy the paths from there.
**These are the only two additions.**

### D6 — `nav-icon.tsx` carries a dead entry · fixed by step 0

`PATHS` defines `vault` (`app/nav-icon.tsx:48-53`) and no feature module
references it: `features/vault/module.ts:7` and `features/wiki/module.ts:7` both
use `icon: "notes"`. It is unreachable — `NavIcon` falls back to `doc` for an
unknown name, so a typo would be silent, but this is not a typo, it is an unused
6-line glyph. **Delete it.** (The alternative — giving Wiki its own icon so the
Notes/Wiki pair are distinguishable in the rail — is a separate decision for the
owner; do not make it in this plan.)

### D7 — no save state, and the data for it already exists · fixed by step 2

`features/editor-workspace/ui/workspace-screen.tsx:65` counts in-flight saves in
`pending`, and uses it *only* for the `beforeunload` guard (line 182). Nothing
tells the user whether what they just typed is saved — on a screen that
deliberately has **no save button** (`app/pitch/page.tsx:417` states this as a
feature). A status bar is where that belongs, and the number is already being
tracked.

---

## 3. What the proposal adds

Everything below is in the prototype and is standard for this class of tool.
The three subsections first are the model changes — what the explorer *is* —
then the chrome, then the polish.

### 3.1 Lists — reading lists as an explorer section (step 3b)

The explorer has three roots today (`workspace-tree.ts:1-13`: notes, papers,
report). The product's organising object — the reading list — is missing from
it, so the only way to group papers in the editor is not to. The proposal adds
reading lists as folders — but **in their own explorer section**, not as a
fourth root beside Notes and Papers.

**Why a section and not a root.** A first draft of this design put Lists as a
fourth root in the same tree. Rendered, it read as a bug: Papers said "here
are all the papers", Lists said "here are some of them again", and the tree
had two models in one column. VS Code's answer is the one to copy: the
Explorer is a *stack of views* — Open Editors, the folder, Outline, Timeline —
each with its own uppercase header, its own collapse, its own data source.
Outline duplicates the file's headings and nobody reads that as a duplicate,
because the header says it is a different lens. So:

| Section | Source | Default | Notes |
| --- | --- | --- | --- |
| **Files** | `workspace-tree.ts` roots: Notes, Papers, Report | open | the mirror folder, complete, no document twice; ink notes live here |
| **Reading lists** | §3.1 tree below, from `container.readingLists` | open | member rows dimmed (`--muted`), inherited rows `--faint` italic; header has *New list* |
| **Outline** | headings of the active tab, from the same parse Read mode uses | collapsed | empty for an ink note; click scrolls the pane |
| *Open editors* | the tab strip | — | not in v1; tabs are visible already |

The section header is the collapse control (`aria-expanded`); the sections
stack from the top and the last one takes the remaining height, as in VS Code.
The count chip on a section header is the number of top-level rows. A paper
under Files shows `N lists` on hover with the list names in the tooltip, so
membership is discoverable without opening the second section.

**The data is already there.** `ReadingList` nests through `parentId`
(`packages/core/src/features/reading-lists/domain/reading-list.ts:15-24`) and
`ReadingListItem` is the many-to-many join — each row is a `paperId` **or** a
`vaultPageId`, with an optional per-membership `note` (`:26-40`).
`container.readingLists.loadScreenData()` returns the lists and
`listItemsForLists(ids)` returns every membership in one round trip
(`container/facades/reading-lists.ts:19-21,51-53`).

**Tree shape.** `buildListsTree(lists, items)` returns the list nodes at level
one of the *Reading lists* section (there is no "Lists" folder row — the
section header is that), built with the same `nestedRoot` helper Notes and
Report use, then each list node gets its members appended as children, papers
first then notes, each sorted by label:

```
READING LISTS                          section    (header, not a row)
├─ Latent spaces            .list.md   reading_list  key "reading_list:<id>"
│  └─ Disentanglement       .list.md   reading_list
│     ├─ β-VAE: Learning …  .paper.md  paper      key "reading_list:<listId>/paper:<paperId>"   (member, dimmed)
│     ├─ Disentanglement: … .paper.md  paper
│     └─ Disentanglement r… .note.md   vault_page key "reading_list:<listId>/vault_page:<pageId>"
└─ Screening — September    .list.md   reading_list
```

Rules, each of which is a test in `test/workspace-tree.test.ts`:

- A member node's **`key` is prefixed by its list** so the same paper under two
  lists is two rows with two keys (selection and expansion state are per row).
  Its **`kind` and `id` are the entity's**, so clicking it opens the *same tab*
  as clicking it under Papers — `tabKey` is `${kind}:${id}` and does not see
  the tree key. One document, several places in the tree; that is what a list
  is for.
- A list row is **both a folder and a document**: the twisty expands it, the
  label opens `reading_list:<id>` as a tab. The document is the list's
  `description` (plain markdown, saved through `manageReadingList`), and it
  renders the member table below the body — read-only in v1.
- A list's `path` is `reading-lists/<parent-slug>/<slug>.list.md` from
  `treePaths(lists, "reading_list")`; member rows reuse the member's own path
  (the tooltip and quick-open string), so quick open **does not** list a paper
  once per list — `flattenTree` skips nodes whose key contains `/`.
- Inherited memberships (`inheritedFromListId` set) are shown under the list
  they were inherited into, dimmed (`--faint`), and are not editable there.
- Items with `duplicateOfItemId` are hidden; that state belongs to the
  screening screen.
- A paper that is in no list still appears under Papers. Files stays complete;
  Reading lists is a view over it. Member rows carry `isMember: true` so the
  row renders dimmed; the pane, tabs and palette never see the flag.

What Lists does **not** do in v1: drag-and-drop between lists, "add to list"
from the tree, reordering by `sortOrder`. Those are explicit follow-ups; the
tree shape above is built so they slot in without changing keys.

### 3.2 Documents are `.md` files, and the UI says so

The desktop app mirrors every document to a folder, and the filename carries
the kind: `methods--a1b2c3.note.md`. `folder-layout.ts:34-46` explains why the
suffix is in the *name* rather than just the directory: the directory is the
first thing that falls away — in a tab, in quick open, in the OS recent-files
list. The editor currently shows no suffix anywhere, so the same title as a
note and as a report section is indistinguishable in a tab.

The rule: **the suffix appears wherever the row's context is gone, and stays
out of the way where it is not.**

| Surface | Shows suffix | Because |
| --- | --- | --- |
| Tab label | always, dim mono after the title | two tabs can share a title |
| Breadcrumb, final crumb | always | the crumb is the path |
| Quick-open row | always, in the path column | the path *is* the match target |
| Explorer row | **only on hover, focus and selection** | icon + tint already say the kind; 260px is too narrow to spend on eight repeated characters |
| Status bar | never; the language segment says `Markdown` | it is a property of the document, not the row |

The suffix is rendered as one element (`.explorer-ext` / `.pane-tab-ext` in the
implementation, `.ext` in the prototype): `--faint`, `--font-plex-mono`, `0.68em`,
`flex: none` so it never truncates — the title does. Its text is
`.${KIND_SUFFIX[kind]}.md`, computed, never typed.

Titles are still titles: the label is `node.label` (the entity's title), not the
slug. Slugs strip `β` and `:` and the user did not name the paper
`higgins-2017-bvae`. The slug lives in the tooltip and the palette path.

### 3.3 Room for what comes next — handwritten notes

Handwritten (ink) notes are planned and are not in this plan's steps. This
section fixes the file format, the capture and recognition approach and the
four tables they touch, so that when they land they arrive as data rather than
as a rewrite. The prototype's **Ink note** button shows the result.

#### What a research user needs from ink

Meeting notes with a supervisor, derivations at the whiteboard, margin notes on
a paper, a quick figure of an architecture. Three things follow: the note must
be **searchable and linkable** like every other note (`[[wikilink]]` into it and
out of it, hits in `⌘P`, backlinks in the graph); it must **round-trip through
the vault folder and git** like every other `.md` (decision 4); and it must be
**editable later as text** — a recognised sentence you can fix with a keyboard.

#### File format — `.ink.md`, one file

Modelled on the layout Obsidian's InkedMark plugin settled on after the sidecar
approach (HandLayers' `.handwriting/` JSON) proved sync- and grep-hostile: the
recognised text is the body, the strokes ride along in the same file.

```markdown
---
weaveforge-id: …
weaveforge-type: ink_page
title: Supervisor meeting 11 Feb
updated-at: …
ink: { pages: 3, recognised: 0.92, engine: chromium-hwr }
---
Drop the β sweep for §3.2 — ranking unchanged. Structured prior instead,
see [[Graph-prior module]].

```ink
{"v":1,"unit":"mm","pages":[{"strokes":[{"c":"text","w":0.7,"p":[[x,y,pressure],…]},…]}]}
```
```

- **Body = text layer.** Everything the app already does to a note body —
  search index, wikilink resolution, wiki lint, mirror, git diff — works on an
  ink note unchanged. A low-confidence word is plain text the user can correct.
- **Strokes = trailing fenced block**, quantised to 0.1 mm with pressure, one
  object per stroke with its tool (`text` / `hl` / `figure`) so the page can be
  re-rendered and re-recognised. `VaultMarkdown` and CodeMirror both already
  treat a fenced block as opaque, so the Read view shows the text and the
  Edit view shows the JSON — neither needs to learn anything.
- **Attachments stay attachments.** A PDF page inked over is
  `![](vault:…/page-3.png)` plus strokes, the same way images attach to notes
  today (`vault-page.ts`, `vaultImageMarkdown`).
- **Suffix** `ink` → `.ink.md` in `KIND_SUFFIX` (core change, later plan).
  `stripKindSuffix` / `parseKindSuffix` already handle a new key.

#### Capture and recognition

- **Capture** is the DOM: `PointerEvent` with `pressure`, `tiltX/Y` and
  `pointerType === "pen"`, plus `getCoalescedEvents()` so a fast stroke keeps
  every sample rather than one per frame. Palm rejection = ignore `touch` while
  a `pen` pointer is down. Rendering to `<canvas>` while drawing, committed as
  SVG paths into the model. No dependency.
- **Recognition** is one interface, `recognise(strokes, lang) → { text,
  confidence }[]`, with engines behind it:
  - *Chromium Handwriting Recognition API* (`navigator.queryHandwritingRecognizer`,
    WICG draft, Chromium ≥ 99) — on-device, in Electron today, no key, the
    first engine. Availability depends on the OS recogniser, so it is a
    capability, not a promise.
  - *MyScript iink* (iinkTS) — best quality including maths, cloud, paid; an
    opt-in engine for people who want formula recognition.
  - *None* — an ink note with no text layer is still a valid note: title,
    links typed in the frontmatter, strokes only.
- **Where it runs:** on stroke end, debounced like the 1500 ms save; result
  written into the body with `<mark data-conf>` only in the UI, plain text on
  disk.

#### The four tables

| Table | Where it lives after this plan | What ink adds |
| --- | --- | --- |
| Kind → icon, tint, suffix | `features/editor-workspace/ui/kind.ts` (new, step 3) — the §2 D5 table as code | one row: `pencil`, a fifth tint, `.ink.md` |
| Kind → document renderer | `features/editor-workspace/ui/document-host.tsx` (new, step 3): a `switch` on `tab.kind` that today always returns `CollabBodyHost` | one case returning the ink host: tool bar, canvas, text-layer column |
| Kind → status-bar segments | `ui/status-bar.tsx` (step 2): `segmentsFor(kind)` returns the list of segments to paint | ink returns page, strokes, pen state, recognised %, "Ink" — none of words / chars / Ln / Col |
| Kind → minimap | `ui/minimap.tsx` (step 6): rendered only when the renderer exposes text | ink has no minimap; the right column is the text layer instead |

Concretely, the constraints on the implementer now:

- **No `if (kind === "paper")` outside those tables.** If a step needs a
  per-kind branch, it adds a column to `kind.ts`.
- **The pane body must not assume text.** `PaneView` renders whatever
  `document-host.tsx` returns; word count, cursor position and the minimap are
  reported *by* the renderer through one small interface
  (`{ text?: string; cursor?: { line: number; col: number } }`), not read off
  the editor by the pane.
- **Tabs, crumbs, the palette and the explorer never touch the body.** They use
  `kind`, `id`, `label`, `path` — all of which an ink note has.
- **The pane reducer is body-agnostic already** (`pane-tree.ts` stores
  `{ kind, id }`) — keep it so.
- **The Edit / Read control (§3.9) hides for ink.** Ink has one mode; the
  text-layer column is its read view.

Sources: InkedMark (Obsidian) file layout — community.obsidian.md/plugins/inkedmark;
alternatives compared at obsidianstats.com/tags/handwriting; WICG Handwriting
Recognition — developer.chrome.com/docs/web-platform/handwriting-recognition,
wicg.github.io/handwriting-recognition; MyScript iinkTS — github.com/MyScript/iinkTS;
`getCoalescedEvents` — developer.mozilla.org/en-US/docs/Web/API/PointerEvent/getCoalescedEvents;
WICG Ink API (low-latency pen) — wicg.github.io/ink-enhancement.

### 3.4 Structure — new chrome

| Addition | Why | Step |
| --- | --- | --- |
| **48px icon rail** | Frees ~184px; keeps the whole product reachable with tooltips. | 1 |
| **Status bar** (26px, full width) | Save state, word/char count, Ln/Col, encoding, language, branch, sync, CRDT peer count. Segments come from `segmentsFor(kind)` (§3.3). The screen is full-bleed, so it owns its own bottom edge. | 2 |
| **Breadcrumbs** (28px) | `Project › Notes › Baselines › Disentanglement reading cluster.note.md`. The explorer collapses; the path must not. | 6 |
| **Minimap** (74px) | Long notes; also the fastest scroll affordance on a workspace screen. Text documents only. | 6 |
| **Explorer sections** | Files / Reading lists / Outline, each a collapsible section with its own header (§3.1). Outline is the active document's headings from the Read-mode parse; empty for ink. | 3b (Files + Reading lists), 6 (Outline, with the minimap — same heading list) |
| **Bottom panel** (collapsible, `⌘J`) | **Problems** and **Output**, both built only from data the app already produces. **Problems** merges three sources into one list — `TexError { file, line, message }` from the report compile (`apps/desktop/src/tex.ts:58`, today shown only in `report/ui/project-checks.tsx`), `LintFinding` from `runWikiLint()` (dead-link, orphan, duplicate, empty — today only on the wiki screen) and the citation-key check (a `[@key]` / `[[key]]` with no imported paper). Each row: severity icon, source, message, `path:line`; click opens the file at that line. **Output** is one append-only log with a channel filter — *Sync* (`MirrorResult` from `mirrorWorkspace`, `vaultChanged` from the watcher), *Git* (`commitVault`), *TeX* (engine + timing + error count), *Zotero* (local read counts) — the same sentences `workspace-folder-panel.tsx` already builds. **No Terminal**: the app has no shell and will not grow one for this. | 9 (optional) |

### 3.5 Explorer — rebuilt rows (step 3)

- **Filter input** with a clear affordance. The tree is the only navigation and
  there is currently no way to search it (`explorer-panel.tsx` has no input).
  Quick open covers documents; it does not cover folders or lists. The filter
  matches label *and* path, so typing `.list` narrows to lists.
- **Indentation guides** — a 1px rule per depth, brightening on hover and on the
  selected row, 16px per level. Lists nest to depth 4 (`Lists › Latent spaces ›
  Disentanglement › paper`), which is unreadable without them.
- **File-type icons with per-type colour** from the kind table (D5).
- **Kind suffix on hover / selection** (§3.2).
- **Git-status ticks** (`M`/`U` in the warn/good ramp) — the explorer is the one
  place a user notices a note has unsaved changes on another device.
- **Header actions**: new note, new folder, collapse all, refresh. Collapse-all is
  the single most-wanted explorer control and is currently absent.
- **Path hint on hover** — the mirrored path, which
  `features/editor-workspace/application/workspace-tree.ts:32` already computes
  and exposes as `title` only.

### 3.6 Tabs (step 5)

- **Dirty dot that becomes the close button on hover** — the standard gesture,
  and it removes the current permanent `×` from every tab.
- **Kind icon and suffix in every tab** (§3.2).
- **Active tab marked by a 2px accent line on the top edge** and lifted to `--bg`,
  so the active document is unambiguous at a glance.
- **Peer presence avatars** at the right of the strip, next to the split buttons.
  Collaboration exists (`collab-presence`,
  `features/collab/ui/collaborative-markdown-editor.tsx:208`) but is currently
  announced *inside* the document as a text line; it belongs in the chrome.
- **Hover, active and focus states** throughout (fixes D4).

### 3.7 Command palette (step 7)

The existing palette (`features/editor-workspace/ui/quick-open-dialog.tsx`) is
already good — scoring, keyboard navigation, focus restore, Ctrl-Enter to split.
Two changes:

- **Matched-character highlighting.**
  `features/editor-workspace/application/quick-open.ts:22` documents `matched`
  as *"Indices into `node.path` that matched, for highlighting"* and
  `quickOpenResults` computes it (line 105) — and the dialog never renders it.
  The prototype wraps each matched character in `<mark>` (see `mark()` in its
  script), which is what makes a fuzzy palette legible.
- **Result grouping and a kind column**, so Notes, Papers, Lists and Report hits
  do not interleave. Group order = root order.

### 3.8 Empty state (step 8)

`features/editor-workspace/ui/pane-view.tsx:188` currently renders one grey
sentence: *"Pick something on the left to open it here."* The prototype replaces
it with a composed state — mark, heading, one line of orientation, and a
shortcut grid. The chords come from
`features/editor-workspace/application/keybindings.ts` (`quick-open` = `⌘P`,
`split-right` = `⌘\`, `close-tab` = `⌘W`, `next-tab` = `⌘⇥`); the grid **must
read from that table**, not hard-code the strings, so it cannot drift.

---

### 3.9 Document modes — what a `.md` file looks like in the pane

What ships today: the workspace pane renders `CollabBodyHost`
(`workspace-screen.tsx:185-205`) with `markdownEditing={{ placeholder }}` — a
CodeMirror **source** editor with line numbers, markdown highlighting and Yjs
carets. There is no rendered view on `/workspace`. The rendered reading view
exists on the notes screen only (`vault-screen/page-editor.tsx:230-300`,
`showEditor` toggling `VaultMarkdown` against the editor).

The prototype's default document (the frontmatter card, serif headings, the
callout, the table with status pills) is that `VaultMarkdown` output moved into
the pane, not something new. So the proposal is:

| Mode | Renderer | Default for | Shortcut |
| --- | --- | --- | --- |
| **Edit** | `CollabBodyHost` as today — source, Ln/Col, minimap from text | every text kind (what ships now) | `⌘E` toggles |
| **Read** | `VaultMarkdown` (`components/markdown/markdown.tsx`) — wikilinks, callouts, KaTeX, the same as `/notes` | none by default; remembered per tab | `⌘E` toggles |

- The control lives in `.tab-actions` as a two-segment Edit / Read, per tab;
  `document-host.tsx` takes `mode` as a second key next to `kind`.
- Read is read-only. Clicking a wikilink in Read opens the target tab; there is
  no click-to-edit at the caret, because the source and rendered positions do
  not map and pretending they do is where live-preview editors go wrong.
- **No live preview** (Obsidian-style WYSIWYG) in this plan. It is a third
  editor and the §4 rule is no new editor surface.
- The frontmatter block in Read shows the human keys (`title`, `tags`,
  `updated-at`, `weaveforge-type`); the ids stay in source.
- Use the prototype's **Source view** button (or `⌘E`) to compare the two on
  the same document; **Current build** forces source because that is all it has.

This is step 5b in §5.

## 4. What this does not do

- **No framework or styling change.** Global CSS, the existing token system, the
  existing `--font-plex-*` triad. Every colour in the prototype is a token copied
  from `themes/`.
- **No new dependency.** All icons are the app's own inline SVG on the shared
  24px grid — stroke 1.7 for navigation, 2 for actions — plus the two glyphs the
  app is missing (folder, check).
- **No change to the domain or the data layer.** Lists are read through the
  facade that already exists; the tree builder gains a second tree and nothing
  in `packages/core` moves.
- **No terminal.** See §3.4.
- **No new editor surface.** `CollabBodyHost` stays exactly as it is; it is
  wrapped by `document-host.tsx`, not replaced. Read mode reuses
  `VaultMarkdown`, so it is not a new surface either (§3.9). Ink is a later
  plan (§3.3).
- **Not a mobile design.** The workspace is desktop-only by module flag
  (`features/editor-workspace/module.ts:14`) and the route gates on `desktop()`
  (`app/workspace/page.tsx:30`), so no responsive variant is proposed.

---

## 5. Implementation plan

Ordered so each step is independently reviewable and the app never looks broken
in between. **One PR per step.** Each row says what to change, where, what
"done" means, and what test to add. Match the prototype's **Proposed** view for
the visual result; the prototype's CSS is written with the same class-naming
style as `styles/editor-workspace.css` and can be lifted almost directly.

| # | Step | Files | Done when | Test to add |
| --- | --- | --- | --- | --- |
| 0 | Add `folder` and `check` glyphs (paths from the prototype's `#i-folder`, `#i-check`); delete the dead `vault` entry (D6) | `components/view-icons.tsx`, `app/nav-icon.tsx` | `<ViewIcon name="folder">` and `"check"` render; `grep -rn '"vault"' apps/web/src --include=*.tsx` finds no icon reference | none — additive |
| 1 | Full-bleed: on `/workspace` render `TabBar` collapsed (rail), zero `.app-shell` padding, no `SubNav`, `.workspace-shell { height: 100dvh }` and drop `--nav-inset` from the height (D1) | `app/app-shell.tsx` (`:130-138`, `:161`), `styles/nav.css`, `styles/shell.css`, `styles/editor-workspace.css:99-104` | At 1440×900 the panes reach the window's bottom edge; every other route is pixel-identical to before | none — visual; screenshot the desktop build before/after and attach to the PR |
| 2 | Status bar with save state from `pending` (D7): Saved / Saving… / Unsaved, then `segmentsFor(kind)` — words, chars, Ln/Col, encoding, language — then branch, peers | `features/editor-workspace/ui/workspace-screen.tsx:65,182`, new `ui/status-bar.tsx`, CSS | Typing flips the indicator to Saving… and back within one save cycle | `test/status-bar.test.ts`: the label for `pending = 0 / 1 / n`; `segmentsFor("paper")` includes `words`, `segmentsFor(<unknown kind>)` returns `[]` |
| 3 | Explorer: `ui/kind.ts` (icon, tint, suffix per kind — the D5 table), `ui/document-host.tsx` (kind → renderer, one case), filter input, indentation guides, SVG icons, suffix on hover, header actions, git ticks, path hint | `features/editor-workspace/ui/explorer-panel.tsx:16-25` and the row markup, new `ui/kind.ts`, `ui/document-host.tsx`, CSS | No Unicode glyph left in `explorer-panel.tsx`; no `kind ===` outside `kind.ts` / `document-host.tsx`; filter narrows rows live; collapse-all closes every branch | `test/kind.test.ts`: every `TreeNodeKind` has an icon and a suffix, suffix equals `.${KIND_SUFFIX[kind]}.md`; `test/explorer-state.test.ts`: `collapseAll(state)` returns no expanded keys; `filterRows(rows, ".list")` keeps only list rows |
| 3b | Explorer sections + Reading lists (§3.1): `explorer-panel.tsx` renders `sections: { id, title, tree, collapsed }[]` with a header per section; `buildListsTree(lists, listItems)` in `workspace-tree.ts` builds the Reading lists tree, loaded in `workspace-screen.tsx` from `container.readingLists`; section collapse state in `explorer-state.ts` | `features/editor-workspace/application/workspace-tree.ts`, `application/explorer-state.ts`, `ui/explorer-panel.tsx`, `ui/workspace-screen.tsx:70-125`, CSS | Files section shows Notes / Papers / Report unchanged; Reading lists section shows real lists with dimmed member rows; a member row opens the same tab as under Papers; a section header collapses only its section | `test/workspace-tree.test.ts`: nested lists nest; member key is `reading_list:<l>/paper:<p>` and `kind`/`id` are the paper's; member rows carry `isMember`; `flattenTree` lists each paper once; inherited rows flagged; duplicates absent; `test/explorer-state.test.ts`: `toggleSection("lists")` leaves the Files expansion set untouched |
| 4 | Wire `onStartNote` (D2) and fix `activeKey` (D3) | `features/editor-workspace/ui/workspace-screen.tsx:258-264`, `application/pane-tree.ts` | "Start note" appears on papers without a note and opens the paper tab; the highlighted row follows the focused tab | `test/pane-tree.test.ts`: `activeTabKey(layout)` for one pane, two panes, and a focused pane with no tabs |
| 5 | Tabs: kind icon + suffix, dirty dot → close on hover, 2px accent on the active tab, hover/active/focus states, correct cursors on `.explorer-row` / `.pane-tab` / `.quick-open-result` (D4), peer avatars in the strip | `features/editor-workspace/ui/pane-view.tsx:150-183`, `styles/editor-workspace.css:30,186,290` | `grep -n 'cursor: default' styles/editor-workspace.css` is empty; `.pane-tab:hover` exists | none — visual |
| 5b | Edit / Read per tab (§3.9): `document-host.tsx` switches on `(kind, mode)`; Read renders `VaultMarkdown` with the tab's body, read-only; two-segment control in the tab strip; `⌘E` in `keybindings.ts` | `ui/document-host.tsx`, `ui/pane-view.tsx`, `application/keybindings.ts`, `application/pane-tree.ts` (mode on the tab) | `⌘E` flips the active tab; the mode survives a tab switch and a split; wikilinks in Read open tabs; Ln/Col and minimap disappear in Read | `test/document-host.test.ts`: `(note, edit)` → editor, `(note, read)` → markdown, `(<unknown kind>, read)` → editor; `test/pane-tree.test.ts`: `setMode` touches only the addressed tab |
| 6 | Breadcrumbs (from `node.path`, suffix on the last crumb) + minimap (text renderers only) | new `ui/breadcrumbs.tsx`, `ui/minimap.tsx`, CSS | Crumbs update on tab switch; minimap scrolls the document; a pane whose renderer reports no text lays out with no minimap column | `test/breadcrumbs.test.ts`: crumbs for a depth-3 note, a root paper, and a paper under a list (crumbs follow the *list* path) |
| 7 | Palette: render `matched` as `<mark>`, group by kind with a heading row, kind icon | `features/editor-workspace/ui/quick-open-dialog.tsx:94-95`, CSS | Typing `dis` underlines `d i s` in the results; hits are under Notes / Papers / Lists / Report headings in that order | `test/quick-open.test.ts`: `groupResults(results)` keeps score order inside each group and root order across groups |
| 8 | Composed empty state driven by the keybindings table | `features/editor-workspace/ui/pane-view.tsx:188`, `application/keybindings.ts`, CSS | The shortcut grid shows exactly the chords `commandForChord` accepts | `test/keybindings.test.ts`: `shortcutTable()` lists every `WorkspaceCommand` once |
| 9 | *(optional)* Bottom panel (§3.4): `application/problems.ts` maps `TexError[]`, `LintFinding[]` and the citation-key check to one `Problem { severity, source, message, path, line? }` list; `application/output-log.ts` is an append-only ring of `{ at, channel, message }` fed by the mirror, commit, TeX, Zotero and watcher results; `ui/panel.tsx` with Problems / Output tabs, channel filter, `⌘J` | new `application/problems.ts`, `application/output-log.ts`, `ui/panel.tsx`, `keybindings.ts`, CSS | Only if the owner asks. No Terminal tab. A TeX error row opens the `.tex` at its line; the count badge equals the row count. | `test/problems.test.ts`: a `TexError` with `line: 0` → no line; a `dead-link` finding → warning with the page path; unknown citation key → one problem with its location; `test/output-log.test.ts`: `MirrorResult` → the "Wrote N files … already up to date" sentence, capped ring drops the oldest |

Step 0 is a prerequisite for 2 and 3 and is risk-free on its own. Steps 1–5 fix
every defect in §2. 3b depends on 3 (it uses `kind.ts`); 5b depends on 3
(`document-host.tsx`). Steps 6–8 are the additions and can be resequenced
without affecting them. Step 9 is off by default (§0, decision 3).

### Per-PR checklist

- [ ] Branch from the plan branch, one step only.
- [ ] Unit tests for `features/editor-workspace` pass (command in §0).
- [ ] `npm run typecheck && npm run lint && npm run check:boundaries` pass.
- [ ] Desktop build opened at Library → Editor; screenshot attached for any
      visual step.
- [ ] All three palettes checked (Settings → Theme: Paper, Mocha, Amoled).
- [ ] No `kind ===` branch added outside `kind.ts` / `document-host.tsx` (§3.3).
- [ ] `git commit -s`, explicit paths staged, Conventional Commits subject.
- [ ] PR body names the step number and the defects it closes (D1–D7).
