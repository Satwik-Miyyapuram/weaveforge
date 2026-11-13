# Repositories (`repos`)

Each repository's request builder is a Rust step module in `crates/wf-core/src/repos/`, reached through `repoStep` in wasm. The step contract and TS wiring are in [data-access](data-access.md), not repeated here.

| Module | Rust fn | wasm export | TS caller |
| --- | --- | --- | --- |
| `account` | `repos::account::step` | `repoStep("account", …)` | `backend/providers/supabase-auth/parts.ts:21`; `backend/parts.ts:149` |
| `annotation_pins` | `repos::annotation_pins::step` | `repoStep("annotation_pins", …)` | `features/papers/infrastructure/parts-1.ts:84` |
| `blob_objects` | `repos::blob_objects::step` | `repoStep("blob_objects", …)` | `storage/providers/postgrest/blob-registry.ts:37` |
| `experiment_metrics` | `repos::experiment_metrics::step` | `repoStep("experiment_metrics", …)` | `features/experiments/infrastructure/parts.ts:131` |
| `experiment_push` | `repos::experiment_push::step` | `repoStep("experiment_push", …)` | `backend/providers/local/parts-1.ts:380` |
| `experiments` | `repos::experiments::step` | `repoStep("experiments", …)` | `features/experiments/infrastructure/parts.ts:94` |
| `milestones` | `repos::milestones::step` | `repoStep("milestones", …)` | `features/plan/infrastructure/milestone-rows.ts:17` |
| `paper_fields` | `repos::paper_fields::step` | `repoStep("paper_fields", …)` | `features/papers/infrastructure/parts-1.ts:98` |
| `plan_feed_links` | `repos::plan_feed_links::step` | `repoStep("plan_feed_links", …)` | `features/plan/infrastructure/plan-feed-links.ts:72` |
| `project_columns` | `repos::project_columns::step` | `repoStep("dashboardLayout", …)`, `repoStep("graphSettings", …)` | `backend/providers/postgrest/wire-postgrest-backend.ts:275`, `:282` |
| `project_integrations` | `repos::project_integrations::step` | `repoStep("project_integrations", …)` | `backend/providers/postgrest/wire-postgrest-backend.ts:132` |
| `projects_repo` | `repos::projects_repo::step` | `repoStep("projects", …)` | `backend/providers/postgrest/wire-postgrest-backend.ts:137`, `:156` |
| `reader_annotations` | `repos::reader_annotations::step` | `repoStep("reader_annotations", …)` | `features/reader/infrastructure/parts-1.ts:201` |
| `shared_items` | `repos::shared_items::step` | `repoStep("shared_items", …)` | `backend/providers/postgrest/wire-postgrest-backend.ts:147` |
| `showcase_seed` | `repos::showcase_seed::step` | `repoStep("showcase_seed", …)` | `features/showcase/application/load-local-demo.ts:58` |

Rules:

- `account`: Supabase sign-in and user create/delete stay in TS; Rust covers only `profile`, `saveProfile`, `deleteData` and the `ensure_user_provisioned` RPC.
- `annotation_pins`: upsert on `project_id,paper_id,annotation_key`; `listForPaper` and `listForSection` filter on `paper_id` and `report_section_id`.
- `blob_objects`: upsert on `bucket,path`; `recordAccess` and `recordAccessMany` call RPCs; `listHot` and `hotBytesTotal` use tier `hot`.
- `experiment_metrics`: writes go to the view (`append`); `history` calls the `metric_history` RPC; `latestActivityAt` returns `[id, ms]` pairs.
- `experiment_push`: `setArtifacts` and `staleArtifactIds` use the `app://artifacts/` prefix; the `clearReset` tip delete is a `soft` query.
- `experiments`: `remove` is an alias of `delete`; `patch` in TS sends `undefined` fields as `null`.
- `milestones`: `remove` is an alias of `delete`; Rust sends unset optional fields as `null`, and TS drops them on reads.
- `paper_fields`: `saveDef` upserts on `id`; `setValue` upserts on `project_id,paper_id,field_id` and returns `.single()`; one bad stored value fails the list call.
- `plan_feed_links`: every query carries the `plan_feed` scope on `api_tokens`; the link name is "Calendar and widget link".
- `project_columns`: `dashboardLayout` and `graphSettings` are routed to this module by `repo_step` (`crates/wf-core/src/repo_query.rs:546`); `get` and `save` are methods with no TS caller found under the name `project_columns`.
- `project_integrations`: upsert on `project_id,provider`; columns `provider,enabled,token,repo,branch,options`.
- `projects_repo`: table `projects`, columns `id,name,color,created_at`; `getCollection` and `setCollection` are its last two methods.
- `reader_annotations`: selected columns are fixed by `READER_ANNOTATION_COLUMNS`; `remove` deletes by id under the table.
- `shared_items`: only `read`; with no ids or owners it makes no request.
- `showcase_seed`: methods are `resetProject`, `seed`, `seedCollab`, `seedSupervisee`, `chartKinds`; the module also holds the bucket names `paper-images`, `experiment-artifacts`, `vault-assets`.
