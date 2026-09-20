# Database migrations

The schema, in the order it was built. **This chain is the database**, and it is applied to
every deployment — the hosted Supabase project and the self-hosted OCI stack alike.

- **Hosted Supabase** (managed Postgres + Supabase Auth + Supabase Storage):
  `supabase link && supabase db push`, or paste the files into the SQL Editor in numeric order
  (`0001`, `0002`, …).
- **OCI / self-hosted** (Postgres 16 + PostgREST + MinIO; see `infra/oci/docker-compose.yml`):
  apply [`../migrations-self-hosted-postgres/`](../migrations-self-hosted-postgres/) **first** —
  it stubs the furniture a stock Postgres lacks (`auth.users`, `auth.uid()`, `storage.buckets`,
  the `anon`/`authenticated`/`service_role` grants) — then this chain in order.

Auth is Supabase Auth in both cases: the self-hosted PostgREST and Realtime verify the tokens
Supabase signs (`PGRST_JWT_SECRET` carries the project's public keys). Only the *data plane* and
*object storage* move.

**Do not** add self-hosted-only scripts here. Those belong in
[`../migrations-self-hosted-postgres/`](../migrations-self-hosted-postgres/).

## Recent additions

| Migration | Adds |
|-----------|------|
| `0027` | Vault pages + `vault-assets` bucket |
| `0028` | Organizations, invite codes, org memberships |
| `0029` | `library_pins` (shared library index) |
| `0030` | Profile self-select RLS + legacy user backfill |
| `0031` | `complete_org_setup()` RPC (standalone onboarding without service role) |
| `0032` | Org RLS recursion fix (`shares_org_with`, `is_org_member`) |
| `0033` | REVOKE/GRANT on org RLS helper functions |
| `0034` | Org switcher (`switch_active_org`, `lab_root` uses `active_org_id`) |
| `0035` | Vault page sharing (`vault_page` type, RLS, vault-assets blob access) |
| `0036` | Shared reading list items RLS + org_memberships backfill for hierarchy users |
| `0037` | E2EE `user_keys` + `get_public_keys()` RPC |
| `0038` | Project space keys + member/supervision wraps |
| `0039` | Per-resource DEKs + share wraps |
| `0040` | Resumable rekey / migration epoch state |
| `0041` | Vault E2EE pilot (`vault_pages.content_enc`, `enc_epoch`) |
| `0043` | Share `edit` access + `can_edit_resource()` + CRDT insert + key_epochs RLS |
| `0044` | Realtime authorization on `realtime.messages` |
| `0045` | Post-migration cleanup placeholder |
| `0046` | `content_enc` on entity tables + paper blind index |
| `0047`–`0049` | External share links + DEK wrap RPCs + rate limits |
| `0050`–`0059` | Org leave, vault owner keys, graph settings, disclaimer, reading-list E2EE |
| `0060` | Reading-list item notes (encrypted) |
| `0061` | API tokens for Python SDK |
| `0062`–`0065` | Remove `admin` role, explicit lab membership, `standalone` role + backfill |
| `0066` | Epoch key consolidation scope |
| `0067` | Encrypted paper card/list projection |
| `0068`–`0074` | AI/MCP access, encrypted proposals, audit ownership, and relay support |
| `0075` | Encrypted-at-rest Overleaf connections and project-linked reports |
| `0076` | RLS enforcement that linked reports reference only the owner’s Overleaf connection |
| `0077` | Explicit Overleaf CRUD policies and connection lookup index |
| `0078` | Rate-limit primary key and server-only deny policies |
| `0079` | Anonymous RPC grant and function search-path hardening |
| `0080` | Missing foreign-key indexes identified by Supabase advisors |
| `0081` | Removes default PUBLIC execution from internal security-definer functions |
| `0082` | Statement-scoped auth.uid() for core ownership policies |
| `0083` | Statement-scoped auth.uid() for sharing and security ownership policies |
| `0084` | Statement-scoped auth.uid() for nested ownership policies |
| `0085` | Statement-scoped auth.uid() for organization, crypto, and CRDT policies |
| `0086` | Splits own-only FOR ALL policies into explicit write policies |
| `0087` | Merges owner/shared SELECT policies for core shared resources |
| `0088` | Merges remaining shared SELECT policies and removes write-policy SELECT overlap |
| `0094` | Restores owner-scoped `project-space-consolidate` access for key epoch state |
| `0095` | Server-held copy of the email-recovery secret, so a locked-out device can ask to be let back in |
| `0096` | `overleaf_linked_reports.updated_at` gains a trigger — it only ever had its insert default |
| `0097` | Per-section word targets for a linked Overleaf report |
| `0098` | Hybrid phase A: note titles are plaintext, so the database can enforce uniqueness on them |
| `0099` | **Drops the whole E2EE schema** — `user_keys`, project/resource keys and wraps, `key_epochs` |
| `0100` | AI proposals and audit records carry plaintext `content` as jsonb (tables were empty; no backfill) |
| `0101` | Card projection for notes: a short body prefix without shipping the markdown |
| `0102` | Citation alert tracks: which library papers to watch for new citing papers |
| `0103` | Zotero annotations stay cached on their paper; this table stores the per-annotation extraction |
| `0104` | Project-scoped custom fields on papers (definitions + per-paper values) |
| `0105` | Extends paper custom fields with relation and rollup kinds |
| `0106` | Phase D — persisted jump-to-locus anchors |
| `0107` | Phase F1 — first-class quotation types on Zotero annotation cards |
| `0108` | Phase F2 — lab snapshot publishing (freeze-and-publish) |
| `0109` | Phase F corrections: two defects found reviewing `0107` and `0108` |
| `0110` | Phase R3 — local reader annotations |
| `0111` | Speeds up the `profiles` SELECT policy |
| `0112` | Published lab snapshots are immutable |
| `0113` | Replaces expired presigned URLs in `experiments.artifacts` with storage paths |
| `0114` | Metrics storage fix A — narrows the metric rows |
| `0115` | Metrics storage fix B — packs settled points into chunks |
| `0116` | Retention for `ai_mcp_relay_requests` |
| `0117` | Provisions the calling user's own rows on demand |
| `0118` | Offline sync, server side — a watermark, tombstones, a base version |
| `0119` | Stops a device applying a row the server has already numbered |
| `0120` | Screening decisions: one row per reviewer, per membership, per stage |
| `0121` | The change feed as one stream, ordered by `server_seq` |
| `0122` | Every reference to `auth.users` goes when the user does |
| `0123` | Takes the DDL function out of reach of the function-EXECUTE grants |
| `0124` | A registry row must describe a path inside its owner's folder |
| `0125` | Writes that have to happen in the database, not as a sequence of round trips |
| `0126` | A metric point may only be written into an experiment its writer owns |
| `0127` | Indexes `experiment_metric_chunks.user_id` |
| `0128` | Attaches the existing `set_updated_at()` trigger to the tables that lacked it |
| `0129` | `resolve_api_token` honours the token's scope; adds `api_token_scopes()` |
| `0130` | Takes the `anon` grant off every internal definer function |
| `0131` | Answers "when did each of these runs last log?" where the data is |
