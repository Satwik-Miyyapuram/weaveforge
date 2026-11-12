# Core modules

The core is pure Rust in `crates/wf-core`. The app reaches it through wasm via `readyCore()` and `typedCore()` in `@/lib/rust-core`, and the desktop app calls it natively.

| Page | Purpose |
| --- | --- |
| [ai](ai.md) | Pure helpers behind the AI assistant: prompt fencing and the wiki index. |
| [bytea](bytea.md) | Bytea `\x` hex and base64 codecs for storage and sync payloads. |
| [report-results-tables](report-results-tables.md) | Live `exptable:` results-table refs in report notes: parse, serialise and resolve to Markdown or LaTeX. |
| [dashboard](dashboard.md) | Dashboard rules ported from `packages/core/src/features/dashboard/domain`. |
| [editor-workspace](editor-workspace.md) | The editor workspace: pane layout, tab groups and the explorer tree. |
| [error-report](error-report.md) | Error-report helpers: making a report safe to send and keep it readable. |
| [ink](ink.md) | Ink geometry: smoothing, curves, nib widths, zoom and the live stroke packer. |
| [recognise](recognise.md) | Recognition helpers: the unsure threshold, confidence mapping, hint words, engine rank and the page summary. |
| [integrations](integrations.md) | Integration provider selection and runtime gates. |
| [local-db-engine-params](local-db-engine-params.md) | Local database engine start params: the shared buffer cap added to PGlite's defaults. |
| [logbook](logbook.md) | Pure helpers behind the logbook. |
| [markdown_link](markdown_link.md) | Markdown link helpers for pasted URLs: the bare-URL check, label escaping and `[label](url)`. |
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
| [pitch_share_card](pitch_share_card.md) | Pitch link-preview card: the shared title and description, the app origin rule and the card paths and image data. |
| [sync](sync.md) | Storage and sync rules: merges, body diffs, change detection, frontmatter and the workspace folder layout. |
| [puller_plan](puller_plan.md) | Pull decisions for the offline-sync Puller: page summary, apply and tombstone steps, unique-clash parsing. |
| [vault](vault.md) | Vault (notes) domain rules. |
| [page_query](page_query.md) | Vault page query text for PostgREST: LIKE and PostgREST escaping, title ILIKE pattern, missing `body_preview` check. |
| [workspace](workspace.md) | Workspace path rules shared by every adapter: relative, normalized, never leaving the root. |
| [lexical_concepts](lexical_concepts.md) | Lexical concept extraction with no model: harvest, merge, rank and the `maxConcepts` cap. |
| [model_extraction](model_extraction.md) | Model concept extraction: the prompt, batch limits, request builder and merge/cap. |
| [proposal_payload](proposal_payload.md) | AI write proposal payload checks and shaping for each approved kind. |
| [proposal_inputs](proposal_inputs.md) | AI write proposal input types, generated into `bindings.ts`. |
| [sidecar-wire](sidecar-wire.md) | Sidecar wire rules: request and answer line routing, one-key tags and reply shapes (`wire`). |
| [app-protocol](app-protocol.md) | `app://` protocol rules: candidate files, canonical URLs, content types, headers and the CSP (`app_protocol`). |
| [session_grant](session_grant.md) | AI session start: TTL clamp, source dedupe, the start checks and the grant shape. |
| [provider_descriptor](provider_descriptor.md) | Restoring a stored AI provider blob: shape check, wire API names, `null` on mismatch. |
| [shell_paths](shell_paths.md) | Desktop shell file naming: `join_path`, the home pointer file and the MCP client config files, with separator and platform as inputs. |
| [ipc_origin](ipc_origin.md) | IPC guard origin rules: same-origin check by scheme, host and effective port, and `origin_of`. |
| [vault_search](vault_search.md) | Vault folder and search rules: search file and skip rules, match cut, folder verdict, nested-folder choice and staged-write names. |
| [proposal_draft](proposal_draft.md) | AI proposal draft shaping: trimmed preview, blank check, pending status and optional fields. |
| [folder_draft](folder_draft.md) | Folder draft import rules: `.json` draft test and the project match. |
| [overleaf_sync_status](overleaf_sync_status.md) | Overleaf sync status line when no pull or push ran. |
| [push_plan](push_plan.md) | Offline-sync push and pull gates: whether a push round continues, whether unsent rows are checked, and whether refused pulls group by table. |
| [ui_helpers](ui_helpers.md) | Pure app helpers ported to Rust: sign-out refusal, page-transition tier and click, recent jump targets and relay URLs (`signed_out`, `view_transition`, `recent_targets`, `relay_url`). |
| [experiment-artifacts](experiment-artifacts.md) | Experiment artifact rules: storage key segment, viewable URL and absolute-link check (`safe_name`, `viewable_artifact_url`, `is_absolute_url`). |
| [library-index](library-index.md) | Background PDF indexer decisions: the 7-day failure retry window and the courtesy pause (`recent_failure_ids`, `courtesy_pause_due`). |
| [url-meta](url-meta.md) | Paper-from-URL rules in the desktop shell: relay target with `https://` default and read failure messages (`shell_target`, `read_failure_message`). |
| [local_api_guard](local_api_guard.md) | Local API request guards: loopback Host check, Bearer credential extraction and legacy token shape (is_loopback_host, bearer_token, is_legacy_token_hex). |
| [secret_names](secret_names.md) | The four stored secret names and the exact-match check (SECRET_NAMES, is_secret_name). |
| [data-access](data-access.md) | How data access is split: Rust builds requests and handles replies, one TS sender sends them. Records that a Rust network stack was deliberately not built. |
| [project_folder](project_folder.md) | Project folder name from a --xxxxxx id suffix (project_folder_name). |
| [integration-helpers](integration-helpers.md) | Zotero local URL, MCP client config, plan widget and AI proposal grouping helpers. |
| [latex-tools](latex-tools.md) | LaTeX outline, TeX engine args and log errors, safe TeX paths, Overleaf Workshop checks. |
| [app-navigation](app-navigation.md) | Nav groups, command palette groups and sort, route titles, screen for path, shortcut labels. |
| [account](account.md) | Account links and menu, provisioning and purge, auth transitions, backend/home config, update check. |
| [markdown-helpers](markdown-helpers.md) | Markdown formatting, image refs, widths and alt text, Mermaid labels, heading slugs, anchors, snippets. |
| [experiments-lab](experiments-lab.md) | Experiment rows and status, metric charts, plot sizes, lab snapshots and data export files. |
| [rows-and-tags](rows-and-tags.md) | Member, project and library-pin rows, tag counts and tones, sync fields, paper notes. |
| [text-formatting](text-formatting.md) | Status text, enum labels, JS-style collation, dates, app log lines and error statuses. |
