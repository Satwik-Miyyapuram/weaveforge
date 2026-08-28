# Python SDK changelog (archived, pre-0.5.0)

**Frozen.** From 0.5.0 onwards there is one changelog for the whole project:
[`../CHANGELOG.md`](../../../CHANGELOG.md). The SDK ships from the same repository
tag as the web app, so a separate history only invited the two to drift — which
is exactly what happened.

This file is kept for the release history that predates the merge. Note the
version line resets at `0.0.1`, when the package was rebranded for the public
monorepo; it does not continue from `1.0.4`.

## [0.0.1] - 2026-07-26

### Added
- First WeaveForge-branded SDK release (`weaveforge` `0.0.1`) from the public monorepo.
- Dual release tracks: `vX.Y.Z` → PyPI, `android-v*` → signed APK/AAB.

### Changed
- Package metadata URLs now point at `Satwik-Miyyapuram/weaveforge`.
- Android TWA manifest version set to `0.0.1` (versionCode `1`).

## [1.0.4] - 2026-07-14

### Changed
- Python SDK docs and `.env.example` now reference **Settings → Python SDK access tokens**.
- `WEAVEFORGE_API_URL` is required alongside `WEAVEFORGE_TOKEN`.

### Fixed
- `Run` updates metrics, artifacts, and status without refetching the experiment row on every call.
- SDK experiment delete is implemented via `DELETE /api/sdk/experiments`.

### Added
- `examples/live_dummy_run.py` — streams metrics and exercises matplotlib, TensorBoard, and wandb sync paths.

## [1.0.3] - 2026-07-14

### Added
- **End-to-end encryption (E2EE)** — client-side envelope encryption for papers, milestones, logbook, report, experiments, reading lists, vault pages, and comments; unlock on sign-in; blind-index dedupe for papers.
- **Collaborative editing** — CRDT-backed co-editing for vault, report, and logbook bodies with Realtime awareness and snapshot compaction.
- **External share links** — view-only `/link?t=…` redemption with link-wrapped DEKs, default 7-day expiry, and rate limits.
- **Vault / Notes** — wiki-style encrypted pages under Library → Notes; shareable as `vault_page`.
- **Org invite codes** — professors create labs with three Crockford Base32 codes; standalone onboarding without service role.
- **Library pins** — pin shared items into your own Papers / vault / etc. from **Shared with me**.
- **API tokens** — personal access tokens for the Python SDK (`Settings → Python SDK access tokens`, migration `0061`).
- **Standalone role** — users without a lab; explicit lab membership (`0063`–`0065`).
- **Scoped cache invalidation** — LWW broadcasts invalidate only dependent repo caches (`cache-invalidation-map.ts`).
- **Epoch key consolidation** — idle consolidation of per-epoch space keys (`0066`).
- **Tiered blob storage** — optional R2 hot + OCI MinIO cold (`NEXT_PUBLIC_BLOB_PROVIDER=tiered`).
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

### Changed
- Plugin routes now use static `page.tsx` stubs; removed lazy module page loader.
- Documentation audit: updated root and `docs/` guides, removed obsolete future-work notes.

### Fixed
- `wall_time` from epoch/`datetime` sources is normalized to ISO so wandb curve
  inserts don't fail against the `timestamptz` column.
- Experiments screen mounts reliably (`Suspense`), cards navigate to detail, and
  demo recorder auth handles the sign-in-again crypto gate.
- Tab navigation highlights the destination immediately; cached screens skip the
  loading overlay for instant tab switches.
- Back from paper notes, experiment detail, and vault notes returns to the list
  view instead of the previous app tab.

[Unreleased]: https://github.com/Satwik-Miyyapuram/weaveforge/compare/v0.0.1...HEAD
[0.0.1]: https://github.com/Satwik-Miyyapuram/weaveforge/releases/tag/v0.0.1
[1.0.4]: https://github.com/Satwik-Miyyapuram/weaveforge/compare/v1.0.3...v1.0.4
[1.0.3]: https://github.com/Satwik-Miyyapuram/weaveforge/compare/v1.0.1...v1.0.3
