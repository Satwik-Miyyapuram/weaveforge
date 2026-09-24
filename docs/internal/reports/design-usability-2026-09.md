# Design, usability and workflow review — September 2026

Phase 2 of the [end-to-end pass](../../plans/current/end-to-end-pass.md).

## How it was run

- **Where:** the installed desktop build (0.6.0, Windows arm64), driven over the
  Chrome DevTools Protocol, so each finding is from the shipped app and not
  from a dev server.
- **What:** all 17 top-level routes at two sizes:
  - desktop, 1426×838;
  - phone, 375×812 at 2× with mobile emulation.

  That makes 34 screenshots.
- **Each screen was checked for:**
  - a heading;
  - horizontal overflow;
  - console errors;
  - the path through the screen's main job;
  - copy that says what happens.
- **Workflows walked end to end:**
  - import a paper, then open, read, annotate and write a note;
  - add to a list;
  - log an entry;
  - plan a milestone;
  - report a problem.

Severity:

- **High:** blocks a task or loses work.
- **Medium:** slows a task or misleads.
- **Low:** polish.

## Fixed in this pass

| Area | Size | What was wrong | What changed |
|---|---|---|---|
| Every screen | both | Several screens had no `h1`, so screen readers and the window title had nothing to name the page | `ScreenHead` renders a visually hidden `h1` from the nav label when a screen has no visible title. Workspace, graph and settings got their own |
| Papers | both | Imported PDFs kept placeholder titles taken from the file or the host page ("Catalog Page", "SAGE PDF Full Text") | Importing from such a page is refused, and the message asks for the DOI or arXiv id instead. A filename is turned into a readable title. A card with a placeholder title says "Title not found — open to set it" |
| Papers | both | The same paper imported twice made two cards | Import matches by DOI and arXiv id, and for a paper with neither, by normalised title |
| Papers | phone | The toolbar controls ran off the right edge | The controls wrap |
| Reader | both | "Load PDF" was a separate floating button | Moved into the reader toolbar |
| Reader | phone | The annotation list stacked under the PDF and took 40% of the screen, even when empty | Below 861px it waits behind an "Annotations (n)" toggle in the toolbar |
| Workspace | phone | No way to reach the file explorer | The explorer is a drawer, opened from a handle at the top left |
| Workspace | phone | The breadcrumb ran together ("PapersBarlow…") and "PDF .pdf" printed over the title | Crumbs are capped at 60% of the strip and clip with an ellipsis. Separators are more visible |
| Workspace | phone | The floating bottom nav covered the status bar, so "Saved" was never visible | The shell reserves the nav's height |
| Workspace | phone | The two split buttons took width that the open tabs needed | Hidden on a phone, where a second pane has no room |
| Workspace | desktop | A hover-only "Start note" button still took its 60px when hidden, so short names like "Notes" became "Not…" | On pointers that can hover, the button overlays the row end and takes no width |
| Workspace | desktop | Breadcrumb separators touched plain crumbs ("Papers›Title") | Plain crumbs keep the same padding as clickable ones |
| Sub-nav | phone | The active tab could be scrolled out of sight | The strip scrolls the active tab into view |
| Graph | both | Node labels shrank to unreadable sizes when zoomed out | Labels never go under about 10.5px on screen. When zoomed out, fewer labels show instead of tiny ones |
| Nav | both | The Log and Git icons, and the Graph and Git icons, were near-identical | Log uses a calendar icon, and Graph was redrawn |
| Log | both | Entries showed raw markdown (`**`, `#`) in the list | Rendered as text |
| Dashboard | both | The default layout left holes | Default layout re-packed |
| Experiments | both | Mixed wording ("run", "trial", "experiment") | One word throughout |
| Lists | both | "1 papers" | Nouns follow the count |
| Settings | both | The password field's label did not say which password it was, and some copy was out of date | Copy updated and the label named |
| Supervision, Org | both | These rendered a blank page with no account or organisation | They show an empty state that says what the screen is for and how to start |
| Header | both | The icon-only Account button had no tooltip | Every icon-only menu button shows its name on hover |
| Reader | both | Citation labels in TeX PDFs split accented names ("Ball ´e", "F ¨oldi ´ak"), and those citations did not link to their reference | Spacing accents are put back on their letter, so labels read "Ballé" and the citation links |
| Reader | both | A paper with no PDF link was a dead end: "HTML landing pages are skipped", and the only way forward was to find and download the PDF by hand | "Find a free copy" asks the open-access indexes (OpenAlex, Unpaywall, Semantic Scholar, Europe PMC, bioRxiv/medRxiv, DOAJ, Zenodo, HAL, arXiv). It opens the first PDF that works, or else keeps the full-text web page and shows it sanitised in a sandboxed frame. When nothing opens, the message says what was found and why each copy failed |
| Errors | both | An error was only reportable from crash screens, and not at all from the desktop app | Every error surface has "Report this". Where no report endpoint exists (desktop, or a web deployment without a GitHub token), it opens GitHub's new-issue form with the report filled in |
| Dashboard | both | Layouts saved before the re-pack kept their holes | A saved layout is compacted upward on load, keeping its order. "Reset default" still restores the shipped arrangement |
| Papers | both | Rows stored before import got careful kept placeholder titles | "Tidy the library" lists them with a proposal: the title read back out of a file name, or the one a DOI or arXiv id resolves to. Nothing is saved until the reader applies it |
| Papers | both | Duplicates stored before import deduplicated were still there | The same dialog groups copies by DOI, arXiv id or normalised title. The reader picks the copy to keep; merging moves annotations, pins, lists, field values, relations, tags and details into it. A Zotero-linked copy is never the one deleted |
| Nav | desktop | The collapsed rail was icons only | Above 1280px the rail shows its labels |
| Dashboard | phone | "Needs attention" was taller than the screen | It shows three items and "Show all (n)" |
| Lists | both | The red delete button was the loudest control, and text toggles sat beside icon buttons | Delete is in the list's ⋯ menu with a confirmation; the toggles are icon buttons with tooltips |
| Workspace | phone | The tab strip showed about one and a half titles | Below 480px it becomes one switcher naming the document on screen, with every open title in its menu |

## Still to change (recommended)

### High

None open. Nothing found in this pass blocks a task or loses work.

### Medium

None open.

### Low

8. **The breadcrumb's file suffix** (`.pdf`) scrolls out of view on a phone
   when the title is long. It is still reachable by scrolling. **Change:** if
   it matters, drop the suffix on the phone, because the tab icon already
   carries the kind.
9. **Test data in the live account** ("PROBE-EDIT-2026", the lists "fsdf" and
   "sdf", the experiment "fsdaf", the milestone "xcvxz") shows on the dashboard
   and in pickers. It was left in place on purpose. Delete it when convenient.

## Desktop and phone at a glance

| Screen | Desktop | Phone |
|---|---|---|
| Dashboard | Good. Saved-layout holes (M1) | "Needs attention" too tall (M5) |
| Papers | Good | Good after the wrap fix |
| Notes / Vault | Good (`/vault` redirects to `/notes`) | Good |
| Workspace | Good after the truncation fix. Icon-only rail (M4) | Usable after this pass. Tab strip is tight (L7) |
| Reader | Good | Good after the annotations toggle |
| Report | Good | Good |
| Log | Good | Good |
| Lists | Delete button too prominent (L6) | Same |
| Graph | Good after the label floor | Usable. Labels thin out as intended; touch gestures were not tested under emulation |
| Experiments, Git | Good | Good |
| Plan | Good | Good |
| AI review | Good | Good |
| Wiki | Good | Good |
| Settings | Good | Good. Tabs scroll sideways |
| Supervision, Org | Empty state only without an organisation | Same |

## Workflow notes

- **Import → read → note** is now three clicks from Papers:
  1. open the card;
  2. choose the PDF tab;
  3. choose "Start note" in the explorer or the note tab.

  The one friction point was finding the explorer on a phone, which the drawer
  handle fixes.
- **Reporting a problem** works from every error surface in both builds.
  Nothing is posted without the reader pressing Submit on GitHub, or Send in
  the web app.
- **Offline:** the desktop app opens, reads and edits with the network off.
  Saves queue and the status bar says so. This was verified in the earlier
  offline-persistence pass and not re-tested here.
