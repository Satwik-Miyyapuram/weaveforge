# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and every track
follows [Semantic Versioning](https://semver.org/).

**Four tracks, four version numbers.** The desktop app, the Python SDK, the
Android app and the iOS app are released separately and number themselves separately — see
[`docs/building/release.md`](docs/building/release.md). Entries go under the
track they belong to, and a release heading names its track. 0.6.0 and every
release before it were cut in lockstep, so those headings cover all three
tracks at once.

## [Unreleased]

### Desktop

### Python SDK

### Android

### iOS

## [py-0.7.1] - 2026-10-05

Python SDK (`py-v0.7.1`).

### Python SDK
- **Fixed:** `.jpg` and `.jpeg` figures upload with an image content type.

## [0.8.5] - 2026-10-04

Desktop (`v0.8.5`). Python SDK stays on 0.7.0; Android stays on 0.8.2; iOS stays on 0.8.0.

### Desktop
- **New:** Metric chart cards with axes, tooltips, smoothing and per-run toggles, in a zoomable grid.
- **New:** PNG and JPG figures are pushed as WebP; SVG stays as is.
- **Fixed:** Metrics and artifacts from SDK runs now reach the server; metrics are pushed from a queue of changed series.
- **Fixed:** A pulled change that will not apply is held and retried instead of stopping sync.
- **Fixed:** An unsent local copy that clashes with the server's copy no longer blocks sync.
- **Fixed:** The app never falls back to its own database while a workspace folder is chosen, and clears junk files before opening it.
- **Fixed:** Deleting a project removes its workspace folder.
- **Fixed:** The app no longer treats its own writes to the workspace folder as outside edits, imports only notes from it, and "Check for changes" no longer lists unchanged rows.

## [0.8.4] - 2026-10-04

Desktop (`v0.8.4`) and Python SDK (`py-v0.7.0`). Android stays on 0.8.2; iOS stays on 0.8.0.

### Desktop
- **New:** Local API tokens get their own permissions and an expiry date; revoking one asks first.
- **New:** The local API accepts artifact uploads from the SDK and keeps them on this computer.
- **New:** Experiment images open in a full-screen viewer with zoom, pan and arrow keys.
- **New:** An experiment's result note can be edited in place.
- **Fixed:** Metric history is read from both ends, so long runs show their latest points.
- **Fixed:** The image viewer toolbar is no longer hidden under the window controls.
- **Fixed:** The PDF reader uses the full window width instead of a 1200px column.

### Python SDK
- **New:** `track(run_id=...)` reruns the same experiment in place, keeping its creation date and result note and clearing old curves. `update=False` keeps creating a new experiment each time.

## [0.8.3] - 2026-10-02

Desktop (`v0.8.3`). Android stays on 0.8.2 (its shell loads the web app); iOS stays on 0.8.0.

### Desktop
- **New:** Choose which events post to Mattermost (daily and weekly log entries, new milestones, milestone status changes, new-citation alerts), all off until switched on.
- **New:** Send every Mattermost event to the default channel, or give each event its own channel.
- **New:** New logbook entries post to Mattermost when that event is on.
- **Fixed:** Dropdowns inside a settings dialog open above the dialog instead of behind it.

## [0.8.2] - 2026-10-02

Desktop (`v0.8.2`) and Android (`android-v0.8.2`). iOS stays on 0.8.0.

### Desktop
- **Fixed:** Reconnecting the workspace folder no longer lists every note the app just wrote as changed outside WeaveForge, and folder events no longer count as edits.
- **Fixed:** Tagging the same paper with the same tag on two devices before either synced no longer shows a sync conflict.
- **Fixed:** Notes and paper tags no longer fail to sync because a server-computed column was sent; screening decisions made before sign-in now sync.
- **New:** Delete a project from the project list, with a confirmation dialog.
- **Changed:** The same paper can sit in several projects.
- **Fixed:** The workspace folder settings explain that each project writes its own subfolder instead of saying no project is open.
- **Fixed:** The delete button text is readable on the dark theme.

### Android
- Rebuilt on 0.8.2; the shell loads the updated web app.

## [0.8.1] - 2026-10-01

Desktop (`v0.8.1`). Android and iOS stay on 0.8.0: their shells load the web app, which needs no change.

### Desktop
- **Paper tags sync:** tags put on a paper now sync between desktop devices and the server, including removals. Removing a tag and adding it back before a sync goes up as one change.
- **Changed:** The app icon is now a solid tile in the theme colours, cream on a light taskbar and dark on a dark one, so it reads at taskbar size.


## [0.8.0] - 2026-10-01

Desktop (`v0.8.0`), Android (`android-v0.8.0`) and iOS (`ios-v0.8.0`). The Python SDK keeps its own numbers.

### Desktop
- **One file per platform:** Windows ships one installer per chip (`WeaveForge-0.8.0-Windows-x64-Installer.exe`, `…-arm64-Installer.exe`), macOS one universal `WeaveForge-0.8.0-macOS.dmg` (Intel and Apple silicon), Linux one AppImage.
- **Changed:** The app icon is now a solid tile in the theme colours, cream on a light taskbar and dark on a dark one, so it reads at taskbar size.

- **Taskbar icon:** on Windows the window icon follows the taskbar theme (cream mark on a dark taskbar); the default icon is outlined so it reads on either.
- **Sync:** hardened conflict resolution and a redesigned conflict screen.
- **UI:** card tint on every theme, nav highlight, modal outlines.

### Android
- **One APK:** the native app (`WeaveForge-0.8.0-Android.apk`) is the only Android release; the TWA wrapper is no longer published.
- **Smoother scrolling:** Papers and other long lists no longer stall and jump mid-scroll on phones.

### iOS
- **New:** WKWebView shell (`apps/ios`), released as one unsigned `WeaveForge-0.8.0-iOS.ipa` for sideloading.

## [0.7.5] - 2026-10-01

Desktop (`v0.7.5`) and Android (`android-v0.7.5`). The Python SDK keeps its own numbers.

### Desktop
- **Packaging robustness:** Bundled transparent high-resolution 512px icon rendered directly from the brand vector emblem (`weave_forge.svg`), ensuring reliable installer compilation across Windows, macOS, and Linux.
- **Changed:** The app icon is now a solid tile in the theme colours, cream on a light taskbar and dark on a dark one, so it reads at taskbar size.

- **Rollback stability:** Verified full parity across desktop shell and in-app updater with the restored clean UI and mobile scroll fixes.

### Android
- **Version alignment:** Synchronized native Android ink app (`org.weaveforge.ink`) and TWA web wrapper (`app.weaveforge.twa`) to version `0.7.5` (version code `10`).
- **OAuth & icon fixes:** Carried forward Google OAuth 2FA WebView fixes and clean transparent vector iconography.

## [0.7.4] - 2026-10-01

Desktop (`v0.7.4`). The Python SDK and Android keep their own numbers.

### Changed
- **Restored clean UI:** Rolled back UI styling to the v0.7.2 baseline, removing intrusive scrollbar overlays, bulky card wraps, and sticky layout quirks across editor, papers, entity cards, and navigation.
- **Pitch hero headline:** Updated pitch copy to *"Never lose the thread between your papers, experiments, and writing."*

### Fixed
- **Papers page mobile scroll:** Eliminated horizontal scroll jitter and touch gesture interception on mobile touchscreens without altering desktop card columns or layout.
- **Brand iconography:** Standardized web app and manifest icons on the official transparent vector emblem (`weave_forge.svg`).

## [0.7.3] - 2026-09-30

Desktop (`v0.7.3`). The Python SDK and Android keep their own numbers.

### Added
- **Continuous sync & robust background loop:** Added persistent background syncing that continuously flushes pending changes when signed in and saves workspace edits with debouncing.
- **Git-style 3-way conflict resolution:** Folder import and sync now feature git-style diff inspections, hunk resolution, and manual conflict marker (`<<<<<<<`, `=======`, `>>>>>>>`) insertion directly into conflicting files.
- **Offline change comparison and adoption:** Robust handling of offline work when signing in, comparing local changes against server state across all synced tables and preventing destructive overwrite.

### Fixed
- **Android Google Sign-In & CORS:** Allowed OAuth navigation flow by cleaning WebView user agent tokens, broadened allowed host permissions, and directed database retrieval to `https://api.weaveforge.org`.
- **Android App Icon:** Replaced placeholder icon with the official WeaveForge emblem with transparent background across all adaptive icon mipmaps and vectors.
- **Boundary gate DRY import:** Fixed inline type imports in `folder-import-apply.ts` to satisfy `check:dry` architectural boundaries.

## [0.7.2] - 2026-09-29

Desktop (`v0.7.2`). The Python SDK and Android keep their own numbers.

### Fixed
- **A device is synced only by the account that owns it.** A window signed in as
  somebody else - or signed out - went on pumping the local outbox, pushing the
  adopting account's rows under whichever session was to hand and failing every
  one of them. Only the owning account drives the device now; any other window
  reads the server and leaves the local copy alone.
- **A workspace whose only work is notes is no longer adopted without asking.**
  The check that decides whether a device may be merged into an account silently
  looked at projects and papers only, so a local history of notes, experiments or
  reading lists answered "nothing of its own" and was absorbed into the account.
  It now counts every synced table that carries an owner, read from the sync
  registry rather than listed by hand.

## [0.7.1] - 2026-09-29

Desktop (`v0.7.1`). The Python SDK and Android keep their own numbers.

### Fixed
- **The installed app was reading the wrong database.** The 0.7.0 installers
  were built without `NEXT_PUBLIC_DATA_URL`, so every request went to the
  sign-in project's REST endpoint, whose schema stops at migration 0111:
  `column vault_pages.pinned does not exist`, `report_sections.updated_at`
  missing, `ensure_user_provisioned` a 404, and every write refused by row-level
  security — which read as ten separate bugs and an empty workspace. The release
  workflow bakes the data and realtime URLs into every installer now, and
  refuses to publish an export that does not name them.
- **"New milestone" opened a box, not a form.** The Plan screen's button
  produced a modal whose entire contents were one bordered choice card; it opens
  the form, and "share plan" moved into the header beside it.

### Changed
- **A new setup window.** The installer's left half is the sign-in screen's —
  brand, headline, the three status cards, the foot line — in the app's own CRT
  palette, with the cards at the source's angles and their offsets scaled for a
  248px column. The progress bar is one solid colour rather than a diagonal
  fill, the window opens on the theme's felt instead of flashing the old dark
  base, and the NSIS sidebar art is re-rendered from its source to match.
- "Papers, notes and experiments, woven into one space." replaces "…woven into
  one thesis." on the sign-in screen, in the installer and in its sidebar art.

## [0.7.0] - 2026-09-29

Desktop (`v0.7.0`) and Android (`android-v7`, version code 7). The Python SDK
keeps its own number.

### Added
- **A new look on every screen.** The neo-brutalist ("Poster") design covers
  every page, the reader and ink notes, with one shared screen header, filters,
  view switch, dialog shell and card, a tint picker, and phone layouts. The
  desktop window has its own title bar, menus and icon.
- **Local-first desktop.** Work happens on the local copy and syncs in the
  background; attachments and notes open offline.
- **Ink notes.** Pen, handwriting recognition, figures, markdown on the sheet,
  focus mode, quick colours and print preview.
- **A reader that follows citations.** Scholar-style citation links, a reference
  popover and references tab, a pen rail, and PDF analysis.
- **AI suggestions you approve.** The local MCP server's `suggest_*` tools write
  drafts to the workspace instead of changing anything; the AI review page shows
  each as a card to approve or reject. The MCP endpoint and token are shown
  under Settings → AI.
- **A sharing hub** in the account menu: what you share, and what is shared with
  you as a supervisor.
- **Deadlines** as a calendar feed and a widget on the Windows wallpaper.
- Pinned notes, anchored comments on notes, each experiment as one node in the
  graph, and when each report section was last edited.
- A demo workspace with offline PDF fetch.
- A themed Windows installer, and a free macOS `.dmg` that shows a notice when
  an update is out.
- Installable iPad web app with an offline page.

### Fixed
- A row the server's policy refuses no longer halts the sync queue.
- Related papers and other places show names instead of raw ids.
- "Open in reader" from the citation popover no longer opens a black window.
- The local Zotero read imports papers, not only annotations.
- A refused origin no longer reports the network as down, and a lost sign-in
  says "sign in to sync" instead of showing permission errors.
- Search by meaning downloads its model on the web again.
- The Linux build has a usable icon; borderless mode and reactive motion cover
  every control.
- Findings from the September code and design audits.

### Android
- The phone layout follows the new design: sections, a reader pill, settings
  search, and reader controls that fold instead of scrolling sideways.
- Nothing on a phone-width screen overflows sideways any more.
- The native ink app gains a deadlines widget for the home screen.
- The `android-v7` tag builds, signs and attaches both apps: the TWA and the
  native ink app (`weaveforge-ink.apk` / `.aab`, from `apps/android`).

### Notes
- Installers are still not code-signed. The only integrity check on an update
  is the SHA-512 in `latest.yml`, served from the same release.

## [0.6.0] - 2026-08-28

### Added
- **The desktop app runs with no account and no network.** It ships a local
  Postgres (PGlite) the page reaches over IPC, so a fresh install opens straight
  into a workspace. Screens that need a server are left out of the offline
  build, the persisted screen cache reports its real age, and the AI provider
  key is kept in the OS keychain rather than a file.
- **Sync, when you ask for it.** An ordered, idempotent outbox on the device and
  a watermark on the change feed; a three-way merge per field, with the
  conflicts that survive it shown rather than silently resolved. Local work done
  before signing in can be adopted into an account once. The opt-in is offered
  once and afterwards only from Settings, and each device states what it keeps
  offline and the ceiling it keeps it under.
- **The vault folder is a folder.** A workspace can live in a directory on disk
  with git, a local HTTP surface, and a local MCP server over it, so other tools
  can read and write the same notes. Zotero on this computer is read directly,
  annotations included, without going through the web API.
- **Systematic review screening, with PRISMA.** Two reviewers screen title and
  abstract, then full text, independently; every reviewer's answer is visible,
  and the counts are derived from those answers rather than stored. The PRISMA
  figure is TikZ you can paste into a report, and the packages it needs are
  loaded only when something uses them.
- **Bibliography checks, a local LaTeX compile, offline semantic search, and a
  wider MCP surface**, completing the six-item plan in
  `docs/internal/future-work/plan-2026-08-six-items.md`.
- **Self-installing updates and a real window menu** on the desktop, with the
  update check reading the repository's releases and ignoring the Android tags.
- **Collaborative editing actually works, and now covers vault notes.** Two
  people can edit the same note or logbook entry at once, with peer cursors and
  presence. It had never run: `crdt_updates` was empty because the editor closed
  itself before anyone could type, and the socket died on the first send. Notes
  keep wikilink and `@cite` completion, find-in-note and undo — co-editing a note
  is the same editor with a shared document behind it, not a plainer one. See
  [Collaborative editing](docs/using/collaborative-editing.md).

### Changed
- The desktop app is served from inside the window instead of loading a remote
  page.
- Releases are cut per track: `vX.Y.Z` builds and publishes the desktop
  installers with the feed the in-app updater reads, and the Python SDK moves to
  `py-vX.Y.Z`. Until now no workflow built a desktop release at all, so an
  installed copy had nothing newer to find.

### Fixed
- **The logbook's Edit button appeared to do nothing.** The form opened and shut
  in the same frame: the editor flushed a save on teardown, and the save handler
  closed the form. Autosave no longer closes anything, and a save must differ
  from what the server last had.
- **Notes and log entries doubled their text on every reopen.** The document was
  seeded with the row's body before the CRDT log was replayed, and seeded again
  by every client that opened it. The seed is now built from a document pinned to
  one client id, so it is byte-identical everywhere and deduplicates itself, and
  it only applies to a document with no history.
- **No update ever reached the other window.** `realtime-js` binary-encodes every
  broadcast push, and the self-hosted Realtime answers that frame kind by closing
  the whole websocket — taking the project-wide cache-invalidation channel with
  it — while every `phx_join` still reported `SUBSCRIBED`. Outgoing frames are
  pinned to Phoenix's plain-JSON tuple.
- **Closing a collaborative editor discarded the last few seconds of typing from
  the shared history.** `destroy()` set its `destroyed` flag before persisting,
  and the persist path skips when that flag is set, so the closing flush wrote
  nothing; reopening replayed a log that was behind. Found by a regression test.
- **First sign-in on a new browser hung on "Preparing your workspace…".** The
  startup bundle is single-flighted, so the second caller joined the in-flight
  promise and its `onDecision` callback never fired, leaving the disclaimer gate
  unready for ever. The gate is now also resolved from the settled bundle.
- **Zotero imported PDF attachments as papers.** The sync read `/items`, which
  returns attachments and child notes, and only checked that an item had a title
  — so "Preprint PDF" and "Snapshot" arrived as bibliography entries, duplicating
  their own parents because an attachment's URL yields a versioned arXiv id. It
  reads `/items/top` now. `scripts/prune-zotero-attachment-papers.mjs` removes
  rows already written.
- **Sign out could sit below the bottom of the sidebar, unreachable.** Nothing
  inside the fixed-height nav could scroll. The links scroll now and the account
  block stays pinned. The block also lost its GitHub link and a duplicate
  Projects control.

### Changed
- **`experiment_metrics` costs a tenth of what it did.** It is the only table
  that grows without bound, so it alone decides when the 50 GB volume fills.
  Measured on the live database: 448.7 B/point before, 130.9 after the schema
  narrowed (migration `0114`), 22.5 after settled points are packed into arrays
  (`0115`). Metric series are also downsampled on write — every point below step
  10,000, then halving per octave — which makes a run's footprint logarithmic in
  its length rather than linear. See
  [the plan](docs/internal/future-work/metrics-storage-plan.md).
- **Zotero syncs in a fraction of the time.** Page reads use `Total-Results` to
  fetch offsets in parallel instead of walking them one at a time, and the
  attachment, annotation and note passes run together. Measured against a mock
  at 250 ms latency with 3,000 annotations: 10.3 s → 2.4 s.

## [0.5.2] - 2026-07-30

### Fixed
- **Navigation no longer wedges after opening the Papers tab.** Paper card
  thumbnails passed a freshly built array to `useDecryptedObjectUrls` on every
  render, and the hook's effect depended on that array's identity rather than
  its contents. Because the effect sets state, each run triggered the next — an
  unbounded fetch loop across every visible card. It saturated the browser's
  per-host connection pool, so the router's request for the next route never got
  a slot and navigation silently timed out. The hook now keys on the path
  contents alone, so no caller can reintroduce this.
- **Rotation lock is respected in the Android app.** The TWA declared
  `orientation: any`, which maps to Android's `SCREEN_ORIENTATION_FULL_SENSOR` —
  a value that overrides the user's rotation lock by design. It is now
  `default`, which defers to the system setting.
- **Tapping a rounded control no longer flashes a square.** Chrome on Android
  derives its tap highlight from an element's border-box rects, before the
  `border-radius` clip applies. The platform overlay is disabled and replaced
  with a press tint on the element itself, which the radius does clip.

### Changed
- **List cards are readable at a glance on a phone.** Tags, metric chips and git
  chips are capped at three per card on one line with a `+N` overflow; notes,
  papers and experiment result notes show their opening lines instead of a bare
  title; and preview text shares a row with the thumbnails rather than stacking
  above them.

### Added
- **A React hook test harness** for the `node:test` runner, with regression
  coverage for the effect-dependency bug above.

## [0.5.1] - 2026-07-30

### Added
- **Live Zotero annotation write-back** (`ZoteroApiAnnotationWriteBack`).
  Creates carry a `Zotero-Write-Token` so a retried request cannot duplicate a
  highlight; updates carry `If-Unmodified-Since-Version`, so an annotation
  edited in Zotero since the last sync comes back as a conflict instead of
  being overwritten. Results are reported per annotation, so one rejected item
  does not fail the batch. Dry-run remains the default and a separate entry
  point. No UI action triggers a live push yet.

### Changed
- One changelog for the whole project. The Python SDK ships from the same
  repository tag as the web app, so the separate SDK history only invited the
  two to drift; pre-0.5.0 SDK releases are archived in
  [`docs/internal/reports/changelog-sdk-legacy.md`](docs/internal/reports/changelog-sdk-legacy.md).
- `docs/building/release.md` now describes a single project release covering the web
  app, core, schema, and SDK, and lists all four version files that must move
  together — the omission that made the 0.5.0 PyPI publish fail.

### Fixed
- Annotation edits (colour, comment, tags) applied immediately instead of
  waiting for the write to return, matching create and delete. A failed edit
  rolls back to the previous value.
- **Android: the app pointed at the previous domain.** Its trusted scope was
  `my-weaveforge-web.vercel.app`, which now redirects — a trusted web
  activity that navigates off its own origin drops out of full-screen and shows
  a URL bar. Host, scope, icons, and web manifest URL all now point at
  `weaveforge.vercel.app`.
- Reader chrome was two independently wrapping bars; on a 360px phone they
  broke into four rows and took ~190px before any document appeared. Now one
  panel of grouped controls that scrolls rather than wraps, at ~100px.
- Highlights waited for the write round-trip before appearing.
- The PDF byte cache never populated: it fetched the publisher directly, which
  CORS blocks for every host the source ladder can resolve.

### Performance
- Each route now loads only its own screen. Every route previously shipped all
  fifteen, reporting 486 kB of first-load JavaScript with 178 B of its own
  code; it is now 94.4 kB.
- The member directory is cached like every other repository. Five screens
  await it before rendering, and it was refetched on each — it is the slowest
  query the app makes (~1.8s against the live database, where everything else
  is ~220ms). Client-side navigation now issues no repeat reads.
- Migration `0111` makes the constant half of the `profiles` policy's
  `lab_root` comparison an InitPlan instead of re-evaluating it per row, and
  indexes the column the recursion walks. **Apply with `supabase db push`.**

## [0.5.0] - 2026-07-29

### Added
- **In-app PDF reader and annotation layer.** The reader was previously a
  provenance-verification pane: a fixed 135% zoom, no controls, no text layer,
  no annotations. It is now a research surface.
  - **Viewport controls** — fit-width by default (the page finally fits the
    window), fit-page, zoom, rotate, page jump, and keyboard navigation.
  - **Text layer** — the document is selectable, copyable, and searchable, with
    an in-document find bar and a PDF outline sidebar.
  - **Zotero annotations render in the page**, projected from PDF user space
    (bottom-left origin) with a filterable sidebar. All six Zotero types are
    supported: highlight, underline, note, image, ink, text.
  - **Local annotations** (migration `0110`, `reader_annotations`) — create,
    edit, tag, colour, and pin to a report section. Stored separately from
    `papers.metadata` so a Zotero re-sync cannot destroy user work.
  - **Split view** against a report section or vault note, annotation
    backlinks, an activity log, and dark-mode PDF rendering.
  - **Source ladder wired** — browser byte cache (IndexedDB), then open-access
    resolution, then WebDAV. Previously implemented and called by nothing.
  - **Zotero write-back** conflict maths and a dry-run client. Live mutation of
    a real library is deliberately not enabled; the dry-run client refuses to
    go live.
- **Bibliography scope** for the Overleaf export: emit every paper in the
  library, or only those cited in the report.
- Playwright coverage for the reader, and a live-database RLS test for
  `reader_annotations`.

### Fixed
- Ink annotations and page-crossing highlights never rendered: the anchor
  strategy required `rects`, but ink carries only `paths` and a page-break tail
  only `nextPageRects`, and neither has a quote to fall back to.
- Stored geometry was painted without checking it belonged to the file on
  screen. The content-hash gate existed but was never wired end to end, so it
  always took its "trust everything" branch; ink bypassed it entirely.
- Highlighting part of a text run stored the rect for the *whole* run, so
  selecting one word covered its neighbours.
- Dropdowns in the reader were unusable by keyboard — arrows, `+`/`-`, and `r`
  were captured as viewport shortcuts before the control saw them.
- Local annotations were permanently marked `pending` write-back, a state a
  row with no Zotero counterpart can never clear. Fixed in both the Supabase
  and self-hosted Postgres providers, which had drifted apart.
- Annotations from a previously opened paper stayed on screen over the next
  paper's PDF, at the old paper's coordinates.
- The PDF byte cache never populated: it fetched the publisher directly, which
  CORS blocks for every host the ladder can resolve, and swallowed the error.
- Every page's annotation overlay scanned the whole annotation list, making
  render cost O(pages x annotations).
- The reader's page-number field could not be cleared, so editing it by
  backspacing was impossible.
- Zoom buttons had no accessible name, announcing only "plus" and "minus".
- `migration 0109`: a missing `updated_at` trigger on
  `annotation_quotation_types`, and a policy that let published lab snapshots
  be edited.
- Overleaf/BibTeX export: fields are escaped, `url` and `doi` are emitted
  verbatim, and entry shape follows the publication type — removing a class of
  biber warnings.
- Root `test-results/` and `.design-sync` were no longer ignored by git.
- `wall_time` from epoch/`datetime` sources is normalized to ISO so wandb curve
  inserts don't fail against the `timestamptz` column.

### Also in this first tagged release

The web application shipped continuously on `main` before 0.5.0, so the
following landed earlier but had never been carried in a tagged release.

- **Collaboration / sharing** (`shares` + `comments`, migration `0018`): share a
  milestone, experiment, report section, reading list, or paper — or all of a
  type — with people in your lab, via a searchable, role-filtered multi-select.
  Each share is view or comment (sharer's choice); recipients see items under a
  **Shared with me** screen and can leave feedback where granted. Writes stay
  owner-only. Graph screen tightened (fit-to-view + one controls box) and a
  consistent `?` help affordance replaced heading subtitles.
- **Python SDK (`weaveforge`)** for experiment tracking: a decorator-first
  API (`@track_experiment` / `with track()`), a `Run` handle for metrics,
  figures, and artifacts, and a composition root that authenticates with
  email/password so RLS applies.
- **Pluggable sync sources** (`MetricSource` / `ArtifactSource` + registry):
  built-in `matplotlib`, `tensorboard`, and `wandb`, installable as extras;
  bring-your-own sources register without SDK edits.
- **Framework callbacks** for PyTorch Lightning and Keras.
- **Training curves** in the dashboard: `experiment_metrics` table (migration
  `0016`), read side in the web app, per-experiment charts, and a **compare**
  view (sortable runs table + overlaid curves).
- **Artifacts** rendered in the dashboard (figure thumbnails + links);
  `experiment-artifacts` storage bucket (migration `0017`).
- **Thesis linking**: experiments can reference a related paper from the SDK and
  surface it in the UI.
- CLI (`weaveforge list / import-tb / import-wandb`).
- Project OSS hygiene: `SECURITY.md`, `CODE_OF_CONDUCT.md`, issue/PR templates,
  `CHANGELOG.md`, and a Python CI job (pytest + ruff + mypy).

[Unreleased]: https://github.com/Satwik-Miyyapuram/weaveforge/compare/v0.7.5...HEAD
[0.7.5]: https://github.com/Satwik-Miyyapuram/weaveforge/releases/tag/v0.7.5
[0.7.4]: https://github.com/Satwik-Miyyapuram/weaveforge/releases/tag/v0.7.4
[0.7.3]: https://github.com/Satwik-Miyyapuram/weaveforge/releases/tag/v0.7.3
[0.7.2]: https://github.com/Satwik-Miyyapuram/weaveforge/releases/tag/v0.7.2
[0.7.0]: https://github.com/Satwik-Miyyapuram/weaveforge/releases/tag/v0.7.0
[0.6.0]: https://github.com/Satwik-Miyyapuram/weaveforge/releases/tag/v0.6.0
[0.5.1]: https://github.com/Satwik-Miyyapuram/weaveforge/releases/tag/v0.5.1
[0.5.0]: https://github.com/Satwik-Miyyapuram/weaveforge/releases/tag/v0.5.0
