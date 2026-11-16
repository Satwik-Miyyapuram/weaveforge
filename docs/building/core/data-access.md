# Data access: Rust plans, TS sends

Decided 2026-11-10 for the Rust port (PR #642).

## What is in Rust

For every PostgREST repository and every outside-service client (Zotero,
Mattermost, Overleaf, GitHub and the rest), Rust owns the logic:

1. Building the request: table, columns, filters, order and body
   (`postgrest_spec.rs`).
2. Turning rows into domain objects and back.
3. Any work done on the reply, such as filtering encrypted names after the read.

## What stays in TS

One small sender. It takes the request Rust built, sends it with the existing
`supabase-js` client or `fetch`, and hands the reply back to Rust. The token,
the connection probe, timeouts and write notifications stay where they are
(`apps/web/src/backend/providers/postgrest/`).

## Step functions (`repo_query.rs`, `repos/`)

A repository whose methods Rust runs is a set of step functions. Rust:
`crates/wf-core/src/repo_query.rs` (types and the `repo_step` dispatch) and one
module per repository in `crates/wf-core/src/repos/`. Wasm: `repoStep` in
`crates/wf-wasm/src/repo_step.rs`. TS: `sendQuery` and `rustRepository` in
`apps/web/src/backend/providers/postgrest/parts-1.ts`.

`repoStep(repo, method, args, ctx, replies)` returns one of:

| Step | Meaning |
| --- | --- |
| `{ kind: "send", queries }` | Send these `RepoQuery`s together; their replies are appended to `replies` in order. |
| `{ kind: "done", value }` | The method resolves to `value`. |
| `{ kind: "fail", message }` | The method throws `Error(message)`. |

The step is stateless: the replies so far say how far the method has got. A
`RepoQuery` is a table query (`select`, `insert`, `upsert`, `update`, `delete`
with filters, order, range, limit and `single`/`maybe`) or an RPC. Filters are
supabase-js method names; `or` takes its text as `value`, `not` and `filter`
take `[operator, value]`. `count` asks for an exact count (the reply is the
number). PostgREST errors are thrown as before, except for a `soft` query: its
error comes back as the reply `{ error: { code, message } }`, so a step can
retry or fall back (`shares.grant` on `23505`, `vault_pages` before the
`body_preview` column). Local `Date` values reach Rust as ISO text and
`Uint8Array` arguments as number arrays.

`ctx` carries `projectId`, `userId` and `now` (ISO, set per call). In a step,
`call.project(action)` and `call.user()` return the id or the step that fails
the way the TS class did ("Select a project before <action>.", "Not signed in.").
`projectUserCtx(projectContext, session)` builds a `ctx` that reads both at call
time.

Wiring a repository: add `crates/wf-core/src/repos/<name>.rs` with a `step`
function and tests, add it to `repo_step`, then build the TS object with
`rustRepository<IRepo>(db, "<name>", [methods], ctx)` and delete the TS class.

| Repository | Replaced TS class (deleted) |
| --- | --- |
| `citation_alert_tracks` | `PostgrestCitationAlertTrackRepository` in `features/relations/infrastructure/parts.ts` (the Semantic Scholar citation source stays in TS) |
| `comments` | `features/sharing/infrastructure/postgrest-comment-repository.ts` |
| `tags`, `paper_tags` | `features/tags/infrastructure/postgrest-tag-repository.ts` |
| `user_settings` | The row queries of `PostgrestSettingsRepository` in `features/settings/infrastructure/parts.ts` (the class keeps its memo and the sealed-credentials `SecretsStore`; `saveRow` reads the row through, then merges) |
| `vault_pages` | `features/vault/infrastructure/postgrest-vault-page-repository.ts` (`rustVaultPageRepository` adds `listStamps` and `listByIds` to the type) |
| `paper_relations` | `features/relations/infrastructure/postgrest-paper-relation-repository.ts` |
| `shares` | `features/sharing/infrastructure/postgrest-share-repository.ts` |
| `share_links` | `features/sharing/infrastructure/postgrest-share-link-repository.ts` (`rustShareLinkRepository` turns `dekWrap` back into a `Uint8Array`) |
| `library_pins` | `features/library/infrastructure/postgrest-library-pin-repository.ts` |
| `annotation_quotation_types` | `features/papers/infrastructure/postgrest-annotation-quotation-type-repository.ts` |
| `ai_proposals`, `ai_audit` | `features/ai-assistant/infrastructure/postgrest-ai-proposal-store.ts` (`rustAiStores`) |
| `members` | `PostgrestMemberRepository` in `features/org/infrastructure/postgrest-member-repository.ts` (`memberRepository` keeps the single-flight memo and the team/lab filters; Rust reads `profiles` and the lab context) |
| `lab_snapshots` | `PostgrestLabSnapshotRepository` in `features/org/infrastructure/parts.ts` (now `labSnapshotRepository`; Rust also checks the title) |
| `log_entries` | `PostgrestLogEntryRepository` in `features/logbook/infrastructure/parts.ts` (no server filter for `bodyContains`: bodies are encrypted) |
| `org` | `fetchMemberships`, `switchOrg`, `leaveOrg` and `continueStandalone` in `features/org/infrastructure/parts.ts` (the memberships read and the three org RPCs; the service-role relay fallbacks stay in TS) |
| `report_sections` | `PostgrestReportSectionRepository` and the row mapping in `features/report/infrastructure/parts.ts` (`getTree` builds the outline in Rust) |
| `supervision` | `PostgrestSupervisionRepository` in `features/org/infrastructure/parts.ts` (now `supervisionRepository`; the batched reads return `[memberId, items]` pairs that TS turns into a `Map`) |

## Not done: a Rust network stack

We chose **not** to move the sending itself into Rust. That would mean Rust
calling `fetch` and owning the login token, retries, timeouts, the server probe
and PostgREST error mapping.

Why not now:

- It is about 40–60% more work than the plan above and removes only about 2–4
  more TS files.
- Rust has no network code today (no `web-sys` fetch, no async exports), so it
  would be built from zero.
- The wasm module is 1940 KB against a 2000 KB budget; async and fetch plumbing
  would likely push it over.
- Every read and write in the app would go through new code at once.
- It would not reach zero TS anyway: Supabase sign-in, the realtime websocket
  for co-editing and the server-side `safe-fetch.ts` stay in TS regardless.

## Doing it later

Because Rust already builds every request, adding the Rust network stack later
only replaces the one TS sender. Nothing else changes. Pick it up as its own
step once the rest of the port is moved and tested.
