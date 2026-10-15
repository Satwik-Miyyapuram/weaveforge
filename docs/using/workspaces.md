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
2. Click **+ New Project**.
3. Enter a **Title** (e.g. *"Masters Thesis: Graph Neural Networks"*), an optional
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
- **Joining a Lab**: When creating your account or in **Settings → Organisation**, enter
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
- **Vault**: Browse and organize long-form notes into nested folders.
- **Report**: Browse the hierarchical sections of your thesis outline.
- **Papers**: Quick access to imported papers and PDF attachments.
- **Excerpts**: View highlights and quoted passages synced from Zotero or the PDF reader.

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
  When you return to WeaveForge, click **Pull folder edits**; WeaveForge shows a field-by-field
  diff before applying any changes, so your work is never overwritten accidentally.

For full details on folder structure, conflict handling, and local REST/MCP access, see
[`workspace-folder.md`](workspace-folder.md).

---

## 5. Offline and Local Mode Workspaces

WeaveForge Desktop allows you to work completely offline with zero account requirements:

- On the sign-in screen, select **"Work on this computer, without an account"**.
- Your projects, notes, papers, search index, and experiments run against an embedded
  PGlite database stored in your operating system's application directory.
- The app makes zero network calls at boot.
- Automated compressed backups of your database are created every 10 minutes and on exit
  in `local-db-backups/` (and inside `.weaveforge/db-backups/` if a workspace folder is set).
- If you decide to sign in to a cloud account later, your local workspace remains intact
  on your computer.

For full details on desktop offline capabilities, see [The desktop and mobile apps](desktop.md#working-without-an-account).
