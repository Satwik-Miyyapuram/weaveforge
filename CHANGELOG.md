# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the Python SDK
follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
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

### Fixed
- `wall_time` from epoch/`datetime` sources is normalized to ISO so wandb curve
  inserts don't fail against the `timestamptz` column.

[Unreleased]: https://github.com/Satwik-Miyyapuram/thesis_tracker/commits/main
