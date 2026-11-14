# Projects and Workspaces

WeaveForge organizes your research into **projects**. A project is an isolated,
self-contained workspace holding all the literature, notes, citation graphs,
report outlines, experiment runs, and milestone plans for a research effort —
whether that is a nine-month masters thesis, a multi-year PhD, or a journal paper.

---

## 1. Projects: The Workspace Boundary

Every research asset in WeaveForge belongs to an active project:

- **Papers & Reading Lists**: Bibliography entries, PDF attachments, annotations,
  and categorized reading lists.
- **Citation Graph**: Force-directed literature visualization showing citation edges
  and `#tags` between papers in this project.
- **Vault Notes**: Markdown research notes with bi-directional `[[wikilinks]]`,
  backlinks panels, and image attachments.
- **Report Outline**: Hierarchical manuscript sections with word count targets and
  Overleaf sync.
- **Logbook**: Daily dated research log entries, hours tracked, and mood logs.
- **Plan**: Milestones, tasks, dependencies, and deadline tracking.
- **Experiments**: ML runs, metric curves, hyperparameter sweeps, and artifact files
  pushed from Python scripts.
- **Connections**: Third-party connectors (e.g. linked GitHub repositories or Mattermost
  channels) are configured per project.

### Creating a Project

1. Click the **Project dropdown** in the top navigation bar (or sidebar).
2. Click **＋ New project**.
3. Enter a **Name** (e.g. *"Masters Thesis: Graph Neural Networks"*), an optional
   description, and click **Create**.
4. WeaveForge initializes the new workspace with empty folders and outlines ready for use.

### Switching Projects (Workspace Selection)

You can maintain multiple concurrent research projects:

- Click the **Project dropdown** in the top header.
- Select any project from the list.
- WeaveForge switches the active workspace instantly: your open tabs, navigation items,
  papers, and notes switch to the selected project without reloading the page.
- In desktop offline mode, switching projects points the local database and workspace
  mirror to that project's folder.

---

## 2. Standalone vs. Lab Organisation Workspaces

WeaveForge supports two collaboration models:

### Standalone Mode (Independent Researcher)

If you are working independently or your research group does not host a centralized lab
workspace:
- You work in standalone mode with your own personal projects.
- You can still share individual items (papers, vault notes, report outlines, or experiment
  runs) with colleagues via **Share** links or external view links (`/link?t=...`).

### Lab Organisation Mode (Supervision & Sharing)

For research groups, university departments, and labs:
- **Invite Codes**: A professor or lab director creates a lab organisation and generates
  role-based invite codes for **Professors**, **Postdocs / PhD Students**, and
  **Masters Students**.
- **Joining a Lab**: When creating your account or in **Settings → Org**, enter
  your lab's invite code to join.
- **Supervision & Sharing**: In an organisation workspace:
  - Students retain private, isolated projects for their day-to-day work.
  - Supervisors can view assigned student projects, inspect milestone progress, and
    leave inline review comments on report drafts without needing screenshots or PDF exports.
  - Lab members can share papers or reading lists across the lab shelf (**Add to library**).

---

## 3. The Workspace Editor (`/workspace`)

The **Workspace Editor** (accessible via `/workspace` or the sidebar) provides an
IDE-style, multi-pane environment designed for simultaneous reading, writing, and
cross-referencing.

### Multi-Pane Layout

- **Split Panes**: Split the editor vertically (side-by-side) or horizontally (stacked)
  to view multiple documents at once. For example, keep a paper's PDF open on the left
  while taking synthesis notes in Markdown on the right.
- **Resizing & Rearranging**: Click and drag the dividers between panes to adjust their
  width or height.
- **Closing Panes**: Click the close button on a pane to dismiss it; remaining panes
  automatically resize to fill the workspace.

### Explorer Sidebar

The left sidebar in the Workspace Editor displays a tree view of your project's contents:
- **Notes**: Browse and organize long-form notes into nested folders.
- **Papers**: Quick access to imported papers and PDF attachments.
- **Report**: Browse the hierarchical sections of your thesis outline.
- **Log**: Browse your logbook entries.
- **Overleaf**: Open the Overleaf projects linked to this workspace.

Clicking any item in the tree opens it in the currently active editor pane.

### Document Tabs

Each pane maintains its own tab bar:
- Open multiple documents within the same pane and switch between them using tabs.
- Unsaved changes display a dirty indicator dot on the tab.
- Reorder tabs by dragging or close them with `Ctrl+W` / `Cmd+W`.

### Quick Open (`Ctrl+P` / `Cmd+P`)

Press **`Ctrl+P`** (or **`Cmd+P`** on macOS) anywhere in the app to open the
**Quick Open** modal:
- Type any part of a note title, paper name, or report section.
- Uses fuzzy matching to rank results instantly.
- Press **Enter** to open the selected document in your active editor pane.

### How it works

The editor keeps three things apart: the pane layout, the tabs inside each pane, and the
explorer tree on the left.

- **Pane layout.** The panes form a binary tree of splits. Each split holds two children
  and a ratio, kept between 10% and 90%, so neither side can disappear. Each leaf is a
  pane with its own ordered tab strip and one focused pane at a time. Closing the last
  tab of a pane closes the pane, unless it is the only pane left.
- **Tabs.** A tab points at a document by kind and id, never by file path. Opening a
  document that is already open in a pane focuses its existing tab instead of adding a
  duplicate. A tab can be in Edit, Read, or Ink mode; the mode is remembered per tab and
  set on every pane where that document is open.
- **Preview.** Toggling the preview opens one preview pane to the right of the focused
  pane and keeps focus on the document. Toggling it again closes it. The preview shows
  the focused document, or keeps showing the previous one while the preview itself
  has focus.
- **Tab groups.** Tabs in a pane can be put into coloured groups. Group state is
  cleaned up whenever the layout is rebuilt.
- **Explorer tree.** The sidebar tree is built from your project's containers (vault,
  report, papers, excerpts) and the reading lists. Each row is a document or a folder,
  and the explorer filters rows by the search text.
- **Saved layout.** The layout is saved per project, so the same panes, tabs and
  modes come back on the next visit. A tab whose document was deleted is dropped on
  restore, and a pane that empties with it collapses.

The layout rules and the tree logic run in the Rust core (`crates/wf-core/src/editor_workspace`),
and the web app calls them through the WASM bridge (`packages/wf-wasm`). The screen itself
only draws what those functions return.

---

## 4. The Workspace Folder on Disk (Obsidian & VS Code Interop)

WeaveForge does not lock your notes in a proprietary database. The desktop app (and
browser) can mirror your active project to a plain Markdown directory on your local disk:

- Go to **Settings → Workspace** and choose a local directory.
- WeaveForge mirrors your project into organized subdirectories:
  - `notes/` — Vault markdown pages.
  - `papers/` — Paper notes and summaries.
  - `report/` — Report outline sections.
  - `experiments/` — Experiment logs and sweep configurations.
  - `plan/` — Milestone and task lists.
  - `assets/` — Images and attachments.
- **Obsidian Vault Compatible**: All links are written as `[[wikilinks]]`, so you can
  open the folder directly in Obsidian or VS Code with full link navigation.
- **Two-Way Sync with Diff Preview**: Edit your notes outside in Obsidian or VS Code.
  When you return to WeaveForge, go to **Settings → Workspace** and click **Check for changes**.
  If outside edits are found, the button reads **Review N outside edit(s)**. WeaveForge shows a
  diff before applying any changes, so your work is never overwritten accidentally.

For full details on folder structure, conflict handling, and local REST/MCP access, see
[`workspace-folder.md`](workspace-folder.md).

---

## 5. Offline and Local Mode Workspaces

WeaveForge Desktop allows you to work completely offline with zero account requirements:

- On the sign-in screen, select **Use without an account, local only**.
- Your projects, notes, papers, search index, and experiments run against an embedded
  PGlite database stored in your operating system's application directory.
- The app makes zero network calls at boot.
- Automated compressed backups of your database are created every 10 minutes and on exit
  in `local-db-backups/` (and inside `.weaveforge/db-backups/` if a workspace folder is set).
- If you decide to sign in to a cloud account later, your local workspace remains intact
  on your computer.

For full details on desktop offline capabilities, see [The desktop and mobile apps](desktop.md#working-without-an-account).
