# Supabase Cloud migrations

SQL in this folder runs on your **hosted Supabase project** (managed Postgres + Supabase Auth).

```bash
supabase link
supabase db push
```

Or paste individual files into the Supabase **SQL Editor** in numeric order (`0001`, `0002`, …).

**Do not** add self-hosted-only scripts here. Those belong in [`../migrations-self-hosted-postgres/`](../migrations-self-hosted-postgres/).

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
