# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the Python SDK
follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

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
  [`docs/changelog-sdk-legacy.md`](docs/changelog-sdk-legacy.md).
- `docs/release.md` now describes a single project release covering the web
  app, core, schema, and SDK, and lists all four version files that must move
  together — the omission that made the 0.5.0 PyPI publish fail.

### Fixed
- Annotation edits (colour, comment, tags) applied immediately instead of
  waiting for the write to return, matching create and delete. A failed edit
  rolls back to the previous value.

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
- **Python SDK (`thesis-tracker`)** for experiment tracking: a decorator-first
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
- CLI (`thesis-tracker list / import-tb / import-wandb`).
- Project OSS hygiene: `SECURITY.md`, `CODE_OF_CONDUCT.md`, issue/PR templates,
  `CHANGELOG.md`, and a Python CI job (pytest + ruff + mypy).

[Unreleased]: https://github.com/Satwik-Miyyapuram/weaveforge/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/Satwik-Miyyapuram/weaveforge/releases/tag/v0.5.0
