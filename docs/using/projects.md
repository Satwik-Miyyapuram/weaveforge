---
covers:
  - apps/web/src/features/projects
  - crates/wf-core/src/projects.rs
checked: 2026-11-14
---
# Projects

A project is the outermost container in WeaveForge. It is one piece of research:
a thesis, a paper, a lab rotation. Every paper, note, run and report belongs to
exactly one project, so a new project starts with an empty slate of its own.

Switching projects switches the whole workspace. You see only the papers and
notes of the project you have open.

## Create a project

1. Click **New project**. You will find it on the projects screen, and in the
   project menu at the bottom of the sidebar.
2. In the window titled **New project**, type a **Name**.
3. Click **Create project**. The new project opens straight away.

Each project shows a small coloured dot next to its name, so you can tell
projects apart at a glance.

### Naming rules

Spaces at the start and end of the name are removed when the project is saved.
Spaces inside the name are kept as you typed them.

A name that is empty, or only spaces, is refused. You see "Project name is
required." and nothing is created.

## Open a project

The projects screen lists every project you have. Each one is a row. Click the
row to open that project. You can also select a row with the keyboard and press
Enter or Space.

WeaveForge remembers the project you had open on this computer. It opens that
project again the next time you start the app, as long as the project still
exists.

## What lives in a project

Each project holds its own:

- papers
- notes
- tags
- runs
- the report

Each of these belongs to one project only. If a paper is missing, check which
project is open first.

## Switch projects

Click the name of the current project at the bottom of the sidebar. A menu opens
with every project in it. The project you have open is marked. Click another
project to switch to it.

The menu ends with two more rows:

- **New project** starts the window for a new project.
- **All projects** takes you back to the list of projects.

## Delete a project

1. On the projects screen, open the more-actions button (three dots) on the
   project's row.
2. Click **Delete project**.
3. A window asks whether you are sure. It warns that the project's papers,
   notes, tags, runs and report go with it, on every device. It also says this
   cannot be undone.
4. To confirm, type the project's name exactly in the box.
5. Click **Delete project** in the window.

The delete button does nothing until the typed name matches. If you delete the
project you have open, WeaveForge takes you back to the list of projects.

If this computer keeps a workspace folder, the folder for that project is
removed too. If that folder cannot be removed, the project is still deleted.

## Rename, archive and sharing

The projects screen has no rename or archive option. The menu on a project's row
has no sharing option either.

## Demo workspace

On a computer without an account, the projects screen shows a **Load demo
workspace** button. It fills the workspace with sample data, so you can look
around before you enter your own.
## Good to know

- A project name loses its spaces at the start and end, and keeps spaces in the
  middle.
- A name that is blank or only spaces is refused.
- Deleting a project removes its papers, notes, tags, runs and report on every
  device. It cannot be undone.
- Deleting asks you to type the project's name first.
- Every paper, note, run and report belongs to one project only.

## Stuck?

*I click Create project, and nothing is created. Why?*
Look at the **Name** box. If it is empty, or only spaces, WeaveForge refuses the
name and says "Project name is required." Type a name, then try again.

*My project opened, but my papers are not there.*
Papers belong to one project. Open the project menu at the bottom of the sidebar
and check which project is marked. Switch to the project that holds your papers.

*I deleted a project by mistake.*
WeaveForge cannot undo a delete. Read the warning in the window before you
confirm.

*The Delete project button will not click.*
Type the project's name in the box first. The name must match what the project is
called. Then the button works.

## Related

- [Getting started](getting-started.md)
- [Papers](papers.md)
- [Notes](notes.md)
- [Reports](reports.md)
- [Settings](settings.md)
- [Workspace folder](workspace-folder.md)
