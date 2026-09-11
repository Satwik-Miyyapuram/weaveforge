# Editor workspace — redesign

**Status:** design approved for hand-off. No application code has changed yet.
**Verified against:** `main` at `d2dcc35` (2026-09-11). Every `file:line` below was
re-read at that commit.
**Prototype:** [`editor-workspace-redesign.html`](editor-workspace-redesign.html) —
open it in any browser. The strip at the bottom switches **Proposed / Current
build** and the Paper / Mocha / Amoled palettes, opens the command palette
(`⌘P`), and toggles the empty state. Every claim in this document is visible
there side by side.

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
- The explorer shows the four roots of §3.1 — Notes, Papers, Lists, Report —
  with the Lists root built from real reading lists.
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
5. **Reading lists are folders in the explorer.** A fourth root, Lists, nested
   as the lists nest, with papers and notes as leaves. §3.1.
6. **Every per-kind decision is a table keyed by kind.** Icon, tint, suffix,
   document renderer, status-bar segments. Handwritten (ink) notes arrive later
   as one more row in each table, not as a special case. §3.3.

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

**Rendered and checked.** The prototype was rendered in headless Chromium
(Edge) at 1440×900 in all six mode × theme combinations. Two rendering bugs
were found and fixed in the file: the inline `<svg>` elements had no `viewBox`,
so the 24-grid paths were cropped instead of scaled; and the brand mark used
React's camelCase attribute names (`strokeWidth`), which raw HTML ignores. Both
are the kind of thing a source read cannot catch — if you change the prototype,
render it again.

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

### 3.1 Lists — reading lists as folders (step 3b)

The explorer has three roots today (`workspace-tree.ts:1-13`: notes, papers,
report). The product's organising object — the reading list — is missing from
it, so the only way to group papers in the editor is not to. The proposal adds
a fourth root, **Lists**, and treats each reading list as a folder.

**The data is already there.** `ReadingList` nests through `parentId`
(`packages/core/src/features/reading-lists/domain/reading-list.ts:15-24`) and
`ReadingListItem` is the many-to-many join — each row is a `paperId` **or** a
`vaultPageId`, with an optional per-membership `note` (`:26-40`).
`container.readingLists.loadScreenData()` returns the lists and
`listItemsForLists(ids)` returns every membership in one round trip
(`container/facades/reading-lists.ts:19-21,51-53`).

**Tree shape.** One `nestedRoot("Lists", "reading_list", lists)` exactly as
Notes and Report are built, then each list node gets its members appended as
children, papers first then notes, each sorted by label:

```
Lists                                  folder     key "reading-lists"
├─ Latent spaces            .list.md   reading_list  key "reading_list:<id>"
│  └─ Disentanglement       .list.md   reading_list
│     ├─ β-VAE: Learning …  .paper.md  paper      key "reading_list:<listId>/paper:<paperId>"
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
- A paper that is in no list still appears under Papers. Papers stays flat and
  complete; Lists is a view over it.

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

Handwritten (ink) notes are planned and are not in this design. What *is* in
this design is the shape that lets them arrive as data rather than as a
rewrite. When they land they will be a new `WorkspaceEntityType` in core with
its own `KIND_SUFFIX` (say `ink` → `.ink.md`, frontmatter plus an attached
stroke file, the same way images attach to notes today). On the editor side
they touch exactly four tables, and every one of those tables must exist by
the end of this plan:

| Table | Where it lives after this plan | What ink adds |
| --- | --- | --- |
| Kind → icon, tint, suffix | `features/editor-workspace/ui/kind.ts` (new, step 3) — the §2 D5 table as code | one row; the icon will be `pencil` or a new glyph |
| Kind → document renderer | `features/editor-workspace/ui/document-host.tsx` (new, step 3): a `switch` on `tab.kind` that today always returns `CollabBodyHost` | one case returning the ink canvas |
| Kind → status-bar segments | `ui/status-bar.tsx` (step 2): `segmentsFor(kind)` returns the list of segments to paint | ink returns none of words / chars / Ln / Col / language — the bar shows save state, branch and peers only |
| Kind → minimap | `ui/minimap.tsx` (step 6): rendered only when the renderer exposes text | ink has no text, so no minimap — the pane must lay out correctly without one |

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

### 3.4 Structure — new chrome

| Addition | Why | Step |
| --- | --- | --- |
| **48px icon rail** | Frees ~184px; keeps the whole product reachable with tooltips. | 1 |
| **Status bar** (26px, full width) | Save state, word/char count, Ln/Col, encoding, language, branch, sync, CRDT peer count. Segments come from `segmentsFor(kind)` (§3.3). The screen is full-bleed, so it owns its own bottom edge. | 2 |
| **Breadcrumbs** (28px) | `Project › Notes › Baselines › Disentanglement reading cluster.note.md`. The explorer collapses; the path must not. | 6 |
| **Minimap** (74px) | Long notes; also the fastest scroll affordance on a workspace screen. Text documents only. | 6 |
| **Bottom panel** (collapsible) | **Problems** and **Output**. Problems shows checks this product can actually run — the prototype's example is a citation key with no matching imported paper. Output is the sync and folder-mirror log the app already writes. **No Terminal**: the app has no shell and will not grow one for this. | 9 (optional) |

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

## 4. What this does not do

- **No framework or styling change.** Global CSS, the existing token system, the
  existing `--font-plex-*` triad. Every colour in the prototype is a token copied
  from `themes/`.
- **No new dependency.** All icons are the app's own inline SVG on the shared
  24px grid — stroke 1.7 for navigation, 2 for actions — plus the two glyphs the
  app is missing (folder, check).
- **No change to the domain or the data layer.** Lists are read through the
  facade that already exists; the tree builder gains a fourth root and nothing
  in `packages/core` moves.
- **No terminal.** See §3.4.
- **No new editor surface.** `CollabBodyHost` stays exactly as it is; it is
  wrapped by `document-host.tsx`, not replaced. Ink is a later plan (§3.3).
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
| 3b | Lists root (§3.1): extend `WorkspaceTreeInput` with `lists` + `listItems`, build the fourth root, load it in `workspace-screen.tsx` from `container.readingLists` | `features/editor-workspace/application/workspace-tree.ts`, `ui/workspace-screen.tsx:70-125` | Lists appears between Papers and Report with real lists; a paper under a list opens the same tab as under Papers | `test/workspace-tree.test.ts`: nested lists nest; member key is `reading_list:<l>/paper:<p>` and `kind`/`id` are the paper's; `flattenTree` lists each paper once; inherited rows flagged; duplicates absent |
| 4 | Wire `onStartNote` (D2) and fix `activeKey` (D3) | `features/editor-workspace/ui/workspace-screen.tsx:258-264`, `application/pane-tree.ts` | "Start note" appears on papers without a note and opens the paper tab; the highlighted row follows the focused tab | `test/pane-tree.test.ts`: `activeTabKey(layout)` for one pane, two panes, and a focused pane with no tabs |
| 5 | Tabs: kind icon + suffix, dirty dot → close on hover, 2px accent on the active tab, hover/active/focus states, correct cursors on `.explorer-row` / `.pane-tab` / `.quick-open-result` (D4), peer avatars in the strip | `features/editor-workspace/ui/pane-view.tsx:150-183`, `styles/editor-workspace.css:30,186,290` | `grep -n 'cursor: default' styles/editor-workspace.css` is empty; `.pane-tab:hover` exists | none — visual |
| 6 | Breadcrumbs (from `node.path`, suffix on the last crumb) + minimap (text renderers only) | new `ui/breadcrumbs.tsx`, `ui/minimap.tsx`, CSS | Crumbs update on tab switch; minimap scrolls the document; a pane whose renderer reports no text lays out with no minimap column | `test/breadcrumbs.test.ts`: crumbs for a depth-3 note, a root paper, and a paper under a list (crumbs follow the *list* path) |
| 7 | Palette: render `matched` as `<mark>`, group by kind with a heading row, kind icon | `features/editor-workspace/ui/quick-open-dialog.tsx:94-95`, CSS | Typing `dis` underlines `d i s` in the results; hits are under Notes / Papers / Lists / Report headings in that order | `test/quick-open.test.ts`: `groupResults(results)` keeps score order inside each group and root order across groups |
| 8 | Composed empty state driven by the keybindings table | `features/editor-workspace/ui/pane-view.tsx:188`, `application/keybindings.ts`, CSS | The shortcut grid shows exactly the chords `commandForChord` accepts | `test/keybindings.test.ts`: `shortcutTable()` lists every `WorkspaceCommand` once |
| 9 | *(optional)* Bottom panel: Problems + Output. Problems runs the citation-key check (report body `[@key]` / `[[key]]` against imported papers); Output tails the sync log | new `ui/panel.tsx`, CSS | Only if the owner asks. No Terminal tab. | `test/problems.test.ts`: unknown citation key → one problem with its location |

Step 0 is a prerequisite for 2 and 3 and is risk-free on its own. Steps 1–5 fix
every defect in §2. 3b depends on 3 (it uses `kind.ts`). Steps 6–8 are the
additions and can be resequenced without affecting them. Step 9 is off by
default (§0, decision 3).

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
