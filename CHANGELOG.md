# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and every track
follows [Semantic Versioning](https://semver.org/).

**Three tracks, three version numbers.** The desktop app, the Python SDK and the
Android build are released separately and number themselves separately — see
[`docs/building/release.md`](docs/building/release.md). Entries go under the
track they belong to, and a release heading names its track. 0.6.0 and every
release before it were cut in lockstep, so those headings cover all three
tracks at once.

## [Unreleased]

### Desktop

### Python SDK

### Android

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

[Unreleased]: https://github.com/Satwik-Miyyapuram/weaveforge/compare/v0.5.1...HEAD
[0.5.1]: https://github.com/Satwik-Miyyapuram/weaveforge/releases/tag/v0.5.1
[0.5.0]: https://github.com/Satwik-Miyyapuram/weaveforge/releases/tag/v0.5.0
