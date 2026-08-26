# Desktop editor workspace

**Status:** proposal, nothing built.
**Question it answers:** the writing in WeaveForge is spread across three
screens — vault notes, a paper's notes field, report sections — and each is a
single-document page. Can the desktop app give that writing one workspace,
the way an editor does: a file tree on the left, tabs, split panes, and one
keyboard path to any document?

**Answer:** yes, and the folder layout it needs already exists. The workspace
mirror in [`packages/core/src/workspace/folder-layout.ts`](../../../packages/core/src/workspace/folder-layout.ts)
already gives every entity a directory and a slug. The editor is that layout,
rendered — not a second model of the same data. Where this design can go wrong
is by inventing a parallel "file" concept that drifts from the entities; every
phase below is written to avoid that.

---

## 1. Where we actually stand

Facts, not plans.

| Fact | Where | Consequence |
|------|-------|-------------|
| Every writable entity already has a folder path | `folder-layout.ts` — `ENTITY_DIRS`, `treePaths`, `flatPath` | The tree in the left panel is a **rendering** of an existing function, not a new hierarchy. |
| The path is disposable; `weaveforge-id` in frontmatter is identity | `folder-layout.ts` header | Renaming a tab renames the entity. No file→entity mapping table is needed. |
| Vault pages nest via `parentId` | `vault-page.ts:22` | Notes are a real tree. `treePaths` already handles the folder-note convention. |
| Report sections nest via `parentId` | `report-section.ts` | Report is a real tree too, with `sectionNo` for ordering. |
| A paper's note is a **field on the paper row**, not a page | `paper.ts:32` — `notes` | Papers are flat, and a paper note has no independent existence. It is opened *through* its paper. |
| All three bodies are markdown, edited by one component | `vault-screen/page-editor.tsx` | The editor pane is a reuse, not a rewrite. |
| Desktop is detected already, and has a preference store | `lib/desktop/desktop-bridge.ts`, `preference-store.ts` | Layout persistence has somewhere to go that the web build never reads. |
| Vault pages and log entries are Yjs CRDTs | `collab/infrastructure/encrypted-yjs-provider.ts` | Two panes open on the same note must **share one document**, not two editors racing. This is the single hardest constraint here. |
| Reader already splits into two panes | `features/reader` | Precedent for pane layout, but it is a fixed 2-pane split with a URL param — not general enough to extend. |

The honest summary: the data is ready, the editor component is ready, and what
is missing is the shell — a tree, tabs, panes, and a quick-open — plus one
naming change so a human reading the folder can tell a note from a paper note.

---

## 2. Extensions: what `.note.md` buys

Today every mirrored file is `<slug>--<id6>.md`, in a directory that carries
the type. That is unambiguous **inside the folder** and ambiguous everywhere
else: in a tab, in quick-open, in a search result, in Recent Files, the
directory is gone and `methods--a1b2c3.md` could be any of the three.

The change is to make the type part of the filename:

| Entity | Today | Proposed |
|--------|-------|----------|
| Vault page | `notes/methods--a1b2c3.md` | `notes/methods--a1b2c3.note.md` |
| Paper note | `papers/attention--d4e5f6.md` | `papers/attention--d4e5f6.paper.md` |
| Report section | `report/results--091a2b.md` | `report/results--091a2b.report.md` |
| Reading list | `reading-lists/…md` | `…list.md` |
| Experiment | `experiments/…md` | `…experiment.md` |
| Milestone | `plan/…md` | `…milestone.md` |
| Log entry | `logbook/2026/03/2026-03-14--ab12cd.md` | `…ab12cd.log.md` |

Two rules keep this from breaking anyone:

1. **The importer accepts both.** A folder written by today's build still
   imports. The suffix is a hint, never a requirement — `weaveforge-id`
   frontmatter and the containing directory remain authoritative, in that
   order. A file with a `.paper.md` suffix sitting in `notes/` is a note.
2. **The rename is a diff, not a migration.** The next mirror writes the new
   path and deletes the old one, which the existing `diffWorkspace` /
   `describeChanges` pass already reports to the user before touching disk.

Everything downstream of that — tab labels, quick-open, icons — reads the
suffix and therefore needs no per-kind branching of its own.

---

## 3. The shell

```
┌────────────┬──────────────────────────────────────────────┐
│ EXPLORER   │  methods.note.md ×  │ attention.paper.md ×    │  ← tab bar per pane
│            ├──────────────────────┴─────────────────────── │
│ ▾ notes    │                      │                        │
│   ▾ ch3    │   editor pane A      │   editor pane B        │  ← split
│     meth…  │                      │                        │
│   intro    │                      │                        │
│ ▾ papers   ├──────────────────────┴─────────────────────── │
│   atten…   │  results.report.md ×                          │
│ ▾ report   │   editor pane C                               │  ← nested split
│   ▾ 3 Res… │                                               │
└────────────┴──────────────────────────────────────────────┘
```

**Explorer (left).** One tree, three roots — `notes`, `papers`, `report` —
each expandable, each showing the entity's own nesting where it has any.
Papers are flat and show only those that *have* a note; a paper with no note
offers "Start note" rather than appearing as an empty file. Selection opens in
the active pane; ⌥-click opens in a new split.

**Panes.** A binary split tree: every node is either a **leaf** holding an
ordered list of tabs and an active index, or a **split** with a direction and
two children plus a ratio. That is the whole model — it nests arbitrarily,
serialises to JSON in about ten lines, and is the same structure every editor
that does this well converges on.

**Tabs.** One tab is `{ kind, id }` — never a file path, because the path
changes when the title does. The label is derived from the entity at render
time, so a rename updates every tab showing it, in every pane, for free.

**Quick open (Ctrl/Cmd-P).** Fuzzy match over `slug.kind.md` across all three
kinds. Enter opens in the active pane; Ctrl-Enter splits.

**What is deliberately *not* here:** no terminal, no extensions, no
side-by-side diff, no multi-cursor. Those are editor features, and the point
of this workspace is the *writing*, not a general editor.

---

## 4. The one hard part: two panes, one document

A note open in two panes must be one document. Two independent editor
instances on the same Yjs doc would each hold their own state and fight over
every keystroke; two independent editors on a plain-markdown entity would
last-write-wins each other, which is exactly the silent edit loss the
offline-sync plan spent six phases avoiding.

The rule: **the document is owned by the workspace, not by the pane.** An open
document is reference-counted — first pane to open it loads it, last pane to
close it releases it. Every pane showing that document binds to the same
instance. This is one module (`open-documents.ts`) and it is a precondition
for splits, not a refinement of them.

---

## 5. Phases

Each phase is a PR onto one feature branch, each independently shippable, each
leaving the app working.

### Phase 1 — Kind suffixes in the folder layout
- [x] `KIND_SUFFIX` map in `folder-layout.ts`; `flatPath`, `treePaths`,
      `logPath` emit `<slug>.<kind>.md`
- [x] `parseKindSuffix(path)` → kind or null, used by the tree and quick-open
- [x] Importer strips a known suffix when deriving a title, and accepts files
      without one
- [x] Tests: round-trip both spellings; a mismatched suffix defers to the
      directory; the title never keeps the suffix

### Phase 2 — The document registry
- [x] `open-documents.ts`: `acquire(ref)` / `release(ref)`, reference-counted,
      one instance per `{kind, id}`
- [x] Dirty tracking (`markReady` / `shouldSave` / `markSaved`, one baseline
      shared by every holder). Wiring the editor onto it lands in Phase 4,
      where a second pane exists to make it observable
- [x] Tests: two acquires return the same instance; release only on the last;
      a save from one holder is visible to the other

### Phase 3 — Explorer tree
- [ ] `workspace-tree.ts`: builds the three roots from the loaded entities,
      reusing `treePaths` for nesting
- [ ] `explorer-panel.tsx`: expand/collapse, keyboard nav, per-kind icon,
      "Start note" affordance on a paper with none
- [ ] Tests: tree shape for nested notes; a paper with no note is offered, not
      listed; collapse state survives a reload

### Phase 4 — Panes and tabs
- [ ] `pane-tree.ts`: the leaf/split model, plus `split`, `close`,
      `moveTab`, `focus` — pure, fully tested
- [ ] `editor-workspace.tsx` renders the tree; each leaf is a tab bar over the
      existing markdown editor
- [ ] Layout persisted through the desktop preference store; tabs whose entity
      has since been deleted are dropped on restore, not rendered broken
- [ ] Tests: split/close/collapse invariants; a closed last tab collapses its
      split; the ratio survives a round-trip

### Phase 5 — Quick open and commands
- [ ] Fuzzy matcher over `slug.kind.md`, scored on subsequence + prefix
- [ ] Ctrl/Cmd-P palette; Enter opens, Ctrl-Enter splits
- [ ] Shortcuts: `Ctrl+\` split, `Ctrl+W` close, `Ctrl+Tab` cycle
- [ ] Tests: ranking (prefix beats scattered match), kind filtering by typing
      `.report`

### Phase 6 — Desktop gate and polish
- [ ] Route registered only when `isDesktop()`; the web build must not ship the
      bundle
- [ ] Empty state, unsaved-changes guard on close, focus restoration
- [ ] `check:solid` boundary review — the editor imports each feature through
      its `index.ts` and nothing imports back into it

---

## 6. What could go wrong

**The tree becomes a fourth source of truth.** Mitigated by building it from
`treePaths` and entity rows on every render rather than storing it.

**Layout state outlives the entities it references.** Mitigated by storing
`{kind, id}` and dropping unresolvable tabs on restore.

**The web bundle grows for a desktop-only feature.** Mitigated by the Phase 6
gate, and checked by the existing "modules that need a server are absent"
test's sibling — a bundle assertion is cheap and the alternative is invisible.

**Splits multiply save paths.** Mitigated by Phase 2 landing before Phase 4:
panes never own a document, so there is exactly one save path per kind no
matter how many panes are open.
