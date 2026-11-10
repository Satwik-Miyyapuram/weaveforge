# Editor workspace core (`editor_workspace`)

The `editor_workspace` module holds the rules for the editor shell: how panes and
tabs are laid out, which explorer rows exist and where they can be moved, quick
open, the status-bar numbers, and the outline. It decides what should happen; the
React shell draws it and handles the input.

## Rust submodules

Each line is one file under `crates/wf-core/src/editor_workspace/`.

- `breadcrumbs`: the path to the document on screen.
- `document_stats`: word and character counts, reading time and cursor label for the status bar.
- `duplicate_note`: the copy of the note on screen, titled "X (copy)".
- `explorer_edit`: what the explorer may create, rename and move, and where.
- `explorer_state`: which explorer rows and sections are open.
- `explorer_window`: which explorer rows are painted.
- `keybindings`: the command that a workspace key chord means.
- `kind`: every per-kind decision in the workspace, in one table.
- `layout_record`: a saved pane layout parsed back into a layout.
- `outline`: the headings of the document on screen.
- `pane_tree`: a binary tree of splits, with tab bars at the leaves.
- `quick_open`: type a few letters, get the document.
- `tab_groups`: named, coloured runs of tabs that can fold.
- `typing_target`: whether a key press belongs to a text field, so a shortcut leaves it alone.
- `workspace_tree`: the explorer tree, derived from entities that are already loaded.

## How the app calls it

The module is exported from the wasm core through
`crates/wf-wasm/src/editor_workspace.rs`, plus a few files prefixed by the module
name (`breadcrumbs.rs`, `document_stats.rs`, `quick_open.rs`,
`explorer_window.rs`, `duplicate_note.rs`, `explorer_edit.rs`,
`explorer_state.rs`, `kind.rs`, `outline.rs`). Examples of the JavaScript names:

- Layout and tabs (`editor_workspace.rs`): `buildWorkspaceTree`, `flattenTree`,
  `buildListsTree`, `openTab`, `closeTab`, `splitPane`, `moveTab`, `setRatio`,
  `focusPane`, `activeTab`, `pruneLayout`, `groupRuns`, `applyGroupCommand`,
  `commandForChord`, `layoutForCommand`.
- `breadcrumbs`: `breadcrumbs`.
- `typing_target`: `isTypingTarget`.
- `document_stats`: `bodyStats`, `formatCount`, `formatWords`, `formatCursorLabel`.
- `quick_open`: `quickOpenResults`, `groupResults`, `stepCursor`.
- `explorer_window`: `rowSlots`.
- `duplicate_note`: `duplicatePlan`.
- `explorer_edit`: `rootOf`, `canRename`, `canDrop`, `creatableUnder`, `creationKindFor`.
- `explorer_state`: `defaultExpanded`, `toggleSection`, `isSectionOpen`, `parseExplorerKeys`.
- `kind`: `kindNames`, `kindIcon`, `hasPdfView`, `hasInkView`, `openModeFor`.
- `outline`: `outlineOf`.

TypeScript reaches these through the wrappers in `packages/wf-wasm/src`. They
call `readyCore()` for the loaded core, and `typedCore()` where typed results are
needed. The shell in `apps/web/src/features/` calls the wrappers.

## Workspace tree

`workspace_tree` builds the explorer from entities that are already loaded. It
has four roots: notes, papers, report and logbook. An Overleaf leaf sits under
the same tree when the project is linked. The tree is derived, not stored, so it
is rebuilt whenever the loaded entities change.

## What stays in TypeScript, and why

- `explorer_state` does not own its storage. The open and closed state is kept in
  `localStorage` by TypeScript, because it is a per-browser preference. Rust only
  answers which rows are open for a given state value.
- The DOM, the focus handling and the drag events stay in the React shell.
  Rust returns the target and the rule, and the shell applies it.
- Layout saving goes through the TypeScript persistence layer. `layout_record`
  parses and validates the saved value, but the read and write stay in TypeScript.

## Related

- [Reader core](reader.md) for the reader pane that the workspace hosts.
- [Report core](report.md) for the report sections shown in the explorer.
- [Overleaf core](overleaf.md) for the Overleaf leaf in the tree.

Source: `crates/wf-core/src/editor_workspace/`
