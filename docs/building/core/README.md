# Core modules

The core is pure Rust in `crates/wf-core`. The app reaches it through wasm via `readyCore()` and `typedCore()` in `@/lib/rust-core`, and the desktop app calls it natively.

| Page | Purpose |
| --- | --- |
| [ai](ai.md) | Pure helpers behind the AI assistant: prompt fencing and the wiki index. |
| [dashboard](dashboard.md) | Dashboard rules ported from `packages/core/src/features/dashboard/domain`. |
| [editor-workspace](editor-workspace.md) | The editor workspace: pane layout, tab groups and the explorer tree. |
| [error-report](error-report.md) | Error-report helpers: making a report safe to send and keep it readable. |
| [ink](ink.md) | Ink geometry: smoothing, curves, nib widths, zoom and the live stroke packer. |
| [integrations](integrations.md) | Integration provider selection and runtime gates. |
| [logbook](logbook.md) | Pure helpers behind the logbook. |
| [net](net.md) | Pure network helpers: URL shape and address checks. |
| [overleaf](overleaf.md) | Overleaf link rules: project id and entry file validation, section target sanitizing, and project URLs. |
| [papers](papers.md) | Paper imports: reading a paper's details from a page and parsing DOIs and arXiv ids. |
| [paste](paste.md) | Paste cleanup: the rules applied to clipboard text. |
| [plan](plan.md) | Plan: the parts of the plan that leave the app, such as the calendar feed and widget summary. |
| [reader](reader.md) | PDF reader logic: anchors, ink strokes, search, viewport and annotation rules. |
| [reader-analysis](reader-analysis.md) | PDF text analysis: line reconstruction, columns, citation text and fingerprints. |
| [reading-lists](reading-lists.md) | Reading-list rules. |
| [relations](relations.md) | Paper relations and the graph view. |
| [report](report.md) | Report helpers. |
| [search](search.md) | Search text rules shared by indexing and querying. |
| [settings](settings.md) | User settings: the uploadable theme config file and appearance preferences. |
| [storage](storage.md) | Blob storage rules: content types, cold-tier eviction order and blob access rules. |
| [sync](sync.md) | Storage and sync rules: merges, body diffs, change detection, frontmatter and the workspace folder layout. |
| [vault](vault.md) | Vault (notes) domain rules. |
| [workspace](workspace.md) | Workspace path rules shared by every adapter: relative, normalized, never leaving the root. |
