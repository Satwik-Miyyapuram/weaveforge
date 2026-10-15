-- Migration: writes that have to happen in the database, not in a sequence of
-- client calls.
--
-- Two unrelated features, one shared cause. A PostgREST client cannot open a
-- transaction, so any multi-step write it performs is a sequence of separate
-- transactions with a failure window between each — and any counter it updates
-- by reading, adding one and writing back loses an increment whenever two
-- writers overlap. Both are fixed the same way: move the step that needs the
-- atomicity into a function, where the whole thing is one statement.
--
-- ===========================================================================
-- 1. `access_count` — a counter that only ever drifts downward
-- ===========================================================================
--
-- `access_count` and `last_accessed_at` feed the eviction score, and the
-- Supabase-backed registry updated them by reading the row, adding one in
-- JavaScript and writing it back:
--
--   const existing = await this.get(bucket, path);      -- select
--   update({ access_count: existing.accessCount + 1 })  -- update
--
-- Two reads of the same blob in flight therefore lose one increment: both read
-- N, both write N+1. It is a counter that only ever drifts downward, and the
-- rows it drifts on are the hot ones — the ones being read concurrently — which
-- is the worst possible set to under-count when the number decides what to
-- evict. The fix is one statement: `access_count = access_count + 1` in the
-- database, where the increment is atomic against every other writer.
--
-- Two functions rather than one, because the two callers differ in a way that
-- matters to the round-trip count. `record_blob_access` is the single-blob form
-- and keeps the `IBlobRegistry` port satisfied; `record_blob_access_many` is
-- what the signed-urls route uses, and it exists because that route mints URLs
-- for up to 200 paths at once — bumping them one at a time would leave 200
-- round trips on a route whose N+1 *reads* this change is meant to remove.
--
-- Functions rather than an unconditional `update` from the client for the same
-- reason the INSERT/UPDATE policies exist: the update has to be scoped to the
-- caller's own rows, and the row is identified by `(bucket, path)`, not by
-- `id` — a shared viewer must be able to mint a URL for someone else's blob
-- without being able to touch its registry row. `security definer` because it
-- is the *owner* predicate being enforced here, not a policy the caller could
-- satisfy by other means.
--
-- `user_id = (select auth.uid())` reproduces exactly what the previous
-- read-modify-write did: the caller's own rows are bumped, a row they only have
-- been granted shared read of is not. The caller's route already treats that as
-- expected (`/* shared viewers cannot update owner registry rows */`).
--
-- The Postgres/pg-pool provider already incremented in the database and needs
-- no change; only the PostgREST path had the read-modify-write.
--
-- ## The `anon` revoke, specifically
--
-- Both functions below end with `revoke all … from public` *and*
-- `revoke all … from anon`. The second is not belt-and-braces: `revoke …
-- from public` does not remove the `anon` entry that `alter default privileges`
-- puts on every new function in this schema (see the measurement in
-- `0123_function_execute_grants.sql`), so without it both of these would be
-- callable by an anonymous client — pointless, but a needless surface on a
-- function that only ever has a caller with a session.
--
-- ===========================================================================
-- 2. Org membership — three tables, no transaction
-- ===========================================================================
--
-- `OrgInviteService` performs two flows as a sequence of PostgREST calls, and a
-- failure anywhere in the middle leaves the workspace in a state worse than a
-- plain error:
--
--   createOrganization()   insert organization
--                          → insert 3 invite codes
--                          → upsert membership
--                          → update profile
--
--   joinOrganization()     upsert membership
--                          → update profile
--                          → bump the invite code's use_count
--
-- Nothing here is hypothetical. A failure after the org insert but before the
-- membership leaves a lab whose owner is not in it: it appears in nobody's
-- memberships list, `switch_active_org` refuses it ("Not a member of this
-- lab"), and the only repair is hand-written SQL. A failure after the
-- membership in `joinOrganization` leaves a role in `org_memberships` and a
-- profile that still says `standalone` — the two disagree, and every read path
-- that trusts one of them is now wrong.
--
-- The `use_count` increment in that second flow has the same lost-update shape
-- as the blob counter above: it sent `use_count: current + 1`, so two people
-- redeeming one code at the same moment both read N and both write N+1. A code
-- used a thousand times can read 700. The increment has to happen where the row
-- is locked.
--
-- What deliberately stays in TypeScript:
--
--   * `resolveOrgJoinAssignment` — which professor supervises whom, and which
--     role a code grants. It is domain logic with its own tests, and copying it
--     into SQL would create a second definition of it to keep in step. The
--     service resolves it and passes the answer in.
--   * The code lookup, the org read and the "already a member" check. Those are
--     reads; they decide *whether* to attempt the write, and a race on them is
--     settled by the unique constraints inside the function.
--
-- Both functions take the acting user id as a parameter — PostgREST calls them
-- with the service role, so `auth.uid()` is not the member — which means an
-- authenticated client that could reach them could provision a lab as anyone.
-- `revoke … from public`, `… from anon` and `… from authenticated`, plus a
-- `service_role`-only grant, is what keeps that parameter honest, exactly as
-- `resolve_api_token` and the share-link RPCs do. The `if not found … raise`
-- checks are inside the same statement, so raising rolls the partial write back
-- rather than leaving it behind.
--
-- ===========================================================================
-- Reversal
-- ===========================================================================
--
--   drop function if exists public.record_blob_access(text, text);
--   drop function if exists public.record_blob_access_many(text, text[]);
--   drop function if exists public.create_organization_atomic(uuid, text, jsonb);
--   drop function if exists public.join_organization_atomic(uuid, uuid, uuid, text, uuid);

-- ---------------------------------------------------------------------------
-- 1. The blob access counter.
-- ---------------------------------------------------------------------------

create or replace function public.record_blob_access(p_bucket text, p_path text)
returns void
language sql
security definer
set search_path = public
as $$
  update blob_objects
     set access_count = access_count + 1,
         last_accessed_at = now()
   where bucket = p_bucket
     and path = p_path
     and user_id = (select auth.uid())
$$;

comment on function public.record_blob_access(text, text) is
  'Atomically bumps the caller''s own registry row for one blob. No-op for a row the caller does not own.';

revoke all on function public.record_blob_access(text, text) from public;
revoke all on function public.record_blob_access(text, text) from anon;
grant execute on function public.record_blob_access(text, text) to authenticated, service_role;

/**
 * The same bump for a whole batch, in one statement.
 *
 * `path = any(p_paths)` rather than a loop: the signed-urls route mints URLs
 * for up to 200 paths in one request, and the point of batching its reads is
 * lost if the counter writes are not batched with them. The ownership predicate
 * is identical, so a batch containing someone else's path bumps the caller's
 * rows and silently leaves the rest — which is what the single-path form does
 * too.
 */
create or replace function public.record_blob_access_many(p_bucket text, p_paths text[])
returns void
language sql
security definer
set search_path = public
as $$
  update blob_objects
     set access_count = access_count + 1,
         last_accessed_at = now()
   where bucket = p_bucket
     and path = any(p_paths)
     and user_id = (select auth.uid())
$$;

comment on function public.record_blob_access_many(text, text[]) is
  'Atomically bumps the caller''s own registry rows for a batch of blobs. No-op for rows the caller does not own.';

revoke all on function public.record_blob_access_many(text, text[]) from public;
revoke all on function public.record_blob_access_many(text, text[]) from anon;
grant execute on function public.record_blob_access_many(text, text[]) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. The org write flows.
-- ---------------------------------------------------------------------------

/**
 * Create a lab, its invite codes, the owner's membership and the owner's
 * profile, as one statement.
 *
 * `p_codes` is `[{"target_role": "professor", "code_hash": "<hash>"}, …]`. The
 * plaintext is never sent to the database — only the hash the service already
 * computed — so a database log cannot leak a code.
 *
 * A duplicate `code_hash` (unique index) or a second live code for the same
 * role (partial unique index) aborts the whole call, org included. The service
 * retries with freshly generated codes, which is the same retry it already did
 * per code, now one level up.
 */
create or replace function public.create_organization_atomic(
  p_user_id uuid,
  p_name    text,
  p_codes   jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org  organizations;
  v_code jsonb;
begin
  if p_user_id is null then
    raise exception 'user id required';
  end if;
  if p_name is null or char_length(trim(p_name)) = 0 then
    raise exception 'lab name required';
  end if;
  if p_codes is null
     or jsonb_typeof(p_codes) <> 'array'
     or jsonb_array_length(p_codes) = 0 then
    -- A lab with no invite codes cannot be joined by anyone, which is the
    -- half-created state this function exists to make impossible.
    raise exception 'at least one invite code is required';
  end if;

  insert into public.organizations (name, owner_id)
  values (trim(p_name), p_user_id)
  returning * into v_org;

  for v_code in select * from jsonb_array_elements(p_codes) loop
    insert into public.org_invite_codes (org_id, target_role, code_hash)
    values (v_org.id, v_code->>'target_role', v_code->>'code_hash');
  end loop;

  insert into public.org_memberships (org_id, user_id, role, supervisor_id, joined_via)
  values (v_org.id, p_user_id, 'professor', null, 'create')
  on conflict (org_id, user_id) do update
    set role          = excluded.role,
        supervisor_id = excluded.supervisor_id,
        joined_via    = excluded.joined_via;

  update public.profiles
     set role               = 'professor',
         supervisor_id      = null,
         active_org_id      = v_org.id,
         org_setup_complete = true
   where user_id = p_user_id;

  -- The service ensures a profile row exists before calling this. If it does
  -- not, the org must not exist either: an owner with no profile cannot see the
  -- lab they just made. Raising here rolls the whole statement back.
  if not found then
    raise exception 'no profile row for %', p_user_id;
  end if;

  return jsonb_build_object(
    'id',         v_org.id,
    'name',       v_org.name,
    'owner_id',   v_org.owner_id,
    'created_at', v_org.created_at
  );
end;
$$;

comment on function public.create_organization_atomic(uuid, text, jsonb) is
  'Creates a lab with its invite codes, owner membership and owner profile in one transaction. Service role only.';

/**
 * Join a lab: membership, profile and the code's use count, as one statement.
 *
 * The role and supervisor are decided by the caller (domain logic; see the file
 * header), and `p_code_id` ties the increment to the code that was actually
 * read, so one code's use cannot be charged to another.
 *
 * The row is re-checked here rather than trusted: if the code was revoked
 * between the service's read and this call, the join must not complete — and
 * because the raise is inside the statement, the membership and profile writes
 * roll back with it instead of being left behind.
 */
create or replace function public.join_organization_atomic(
  p_user_id       uuid,
  p_org_id        uuid,
  p_code_id       uuid,
  p_role          text,
  p_supervisor_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_id is null or p_org_id is null or p_code_id is null then
    raise exception 'user id, org id and code id are required';
  end if;

  insert into public.org_memberships (org_id, user_id, role, supervisor_id, joined_via)
  values (p_org_id, p_user_id, p_role, p_supervisor_id, 'invite')
  on conflict (org_id, user_id) do update
    set role          = excluded.role,
        supervisor_id = excluded.supervisor_id,
        joined_via    = excluded.joined_via;

  update public.profiles
     set role               = p_role,
         supervisor_id      = p_supervisor_id,
         active_org_id      = p_org_id,
         org_setup_complete = true
   where user_id = p_user_id;

  if not found then
    raise exception 'no profile row for %', p_user_id;
  end if;

  -- The atomic increment: `use_count = use_count + 1` under the row lock, never
  -- a value computed from a read.
  update public.org_invite_codes
     set use_count = use_count + 1
   where id = p_code_id
     and org_id = p_org_id
     and revoked_at is null;

  if not found then
    raise exception 'invite code is no longer valid';
  end if;
end;
$$;

comment on function public.join_organization_atomic(uuid, uuid, uuid, text, uuid) is
  'Adds a member, aligns their profile and increments the invite code''s use count in one transaction. Service role only.';

revoke all on function public.create_organization_atomic(uuid, text, jsonb) from public;
revoke all on function public.create_organization_atomic(uuid, text, jsonb) from anon;
revoke all on function public.create_organization_atomic(uuid, text, jsonb) from authenticated;
revoke all on function public.join_organization_atomic(uuid, uuid, uuid, text, uuid) from public;
revoke all on function public.join_organization_atomic(uuid, uuid, uuid, text, uuid) from anon;
revoke all on function public.join_organization_atomic(uuid, uuid, uuid, text, uuid) from authenticated;

grant execute on function public.create_organization_atomic(uuid, text, jsonb) to service_role;
grant execute on function public.join_organization_atomic(uuid, uuid, uuid, text, uuid) to service_role;
