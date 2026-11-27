---
covers:
  - apps/web/src/features/projects
  - apps/web/src/backend/providers/files/file-project-repo.ts
  - crates/wf-core/src/projects.rs
checked: 2026-11-27
---
# Projects

A project is the outermost container in WeaveForge. It is one piece of research:
a thesis, a paper, a lab rotation. Every paper, note, run and report belongs to
exactly one project, so a new project starts with an empty slate of its own.

Switching projects switches the whole workspace. You see only the papers and
notes of the project you have open.

## A project is a folder

Each folder at the top of your [workspace folder](workspace-folder.md) is a
project, named after the folder. Folders whose names start with a dot, such as
`.weaveforge` and `.git`, are not projects: `.weaveforge` holds the workspace's
settings. The workspace folder itself is never a project.

- Make a folder there in your file manager and it shows up as an empty project.
- A new project made in WeaveForge gets the standard folders: `notes`, `papers`,
  `reading-lists`, `report`, `experiments`, `plan` and `logbook`.
- Folders inside a project that WeaveForge does not know are left alone.
- A project's colour and creation date sit in `<project>/.weaveforge/project.json`.
  Without that file the project still opens, with no colour.

Folders from 0.9.7 named like `MSc Thesis--a1b2c3` are renamed to `MSc Thesis`
the first time 0.9.8 lists your projects. A 0.9.7 workspace that kept its one
project in the workspace folder itself has that project moved into a folder of
its own, named after the project.

## How to

### Create a project

1. Click **New project**. You will find it on the projects screen, and in the
   project menu at the bottom of the sidebar.
2. In the window titled **New project**, type a **Name**.
3. Click **Create project**. The new project opens straight away.

Each project shows a small coloured dot next to its name, so you can tell
projects apart at a glance.

Spaces at the start and end of the name are removed when the project is saved.
Spaces inside the name are kept as you typed them. A name that is empty, or only
spaces, is refused: you see "Project name is required." and nothing is created.

### Open a project

1. Go to the projects screen. It lists every project you have, one per row.
2. Click the row, here **MSc Thesis (Showcase)**. You can also select a row with
   the keyboard and press Enter or Space.

WeaveForge remembers the project you had open on this computer. It opens that
project again the next time you start the app, as long as the project still
exists. If it is gone and there is only one project left, that one opens.

### Rename a project

1. On the projects screen, open **More actions** (three dots) on the project's
   row.
2. Click **Rename**, type the new **Name** and click **Rename**.

Renaming renames the project's folder. A name another folder already has is
refused, and so are names a folder cannot take: names with `/ \ : * ? " < > |`,
names starting with a dot, and names ending with a dot or a space.

### Switch projects

1. Click the name of the current project at the bottom of the sidebar. A menu
   opens with every project in it. The project you have open is marked.
2. Click another project to switch to it.

The menu ends with two more rows: **New project** starts the window for a new
project, and **All projects** takes you back to the list of projects.

### Delete a project

1. On the projects screen, open **More actions** (three dots) on the project's
   row.
2. Click **Delete project**.
3. A window asks whether you are sure. It warns that the project's papers,
   notes, tags, runs and report go with it, on every device. It also says this
   cannot be undone.
4. To confirm, type the project's name exactly in the box.
5. Click **Delete project** in the window.

The delete button does nothing until the typed name matches. If you delete the
project you have open, WeaveForge takes you back to the list of projects.

The project's folder is moved to `.weaveforge/trash/` inside the workspace
folder, so its files are still there if you need them back. Only the folder
named after the project is moved, never another one.

### Try the demo workspace

On a computer without an account, the projects screen shows a **Load demo
workspace** button. It fills the workspace with sample data, so you can look
around before you enter your own.

## What lives in a project

Each project holds its own:

- papers
- notes
- tags
- runs
- the report

Each of these belongs to one project only. If a paper is missing, check which
project is open first.

The projects screen has no archive option. The menu on a project's row has no
sharing option either.

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
WeaveForge cannot undo a delete, but the folder is in `.weaveforge/trash/` in
your workspace folder. Move it back to the top of the workspace folder and the
project is listed again.

*I made a folder and it shows as an empty project.*
That is expected: every top-level folder is a project. Move it into a project, or
rename it to start with a dot, and it is no longer listed.

*The Delete project button will not click.*
Type the project's name in the box first. The name must match what the project is
called. Then the button works.

## Related

- [Getting started](getting-started.md)
- [The workspace editor](workspaces.md)
- [Papers](papers.md)
- [Notes](notes.md)
- [Reports](reports.md)
- [Settings](settings.md)
- [Workspace folder](workspace-folder.md)
