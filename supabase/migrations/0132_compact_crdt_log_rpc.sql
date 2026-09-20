-- Migration: compaction is one statement, and only an editor may run it.
--
-- `CompactCrdtLogUseCase` used to advance the snapshot watermark and then delete
-- the covered update rows as **two** PostgREST calls. Two problems, and the
-- ordering fix in the client (watermark first, then sweep) only addresses the
-- second:
--
-- ## 1. A collaborator without edit rights poisoned the watermark
--
-- `setSnapshotUpto` writes `snapshot_upto` on the entity row, which RLS lets
-- anyone who can *view* the resource attempt; `deleteUpTo` is filtered by the
-- delete policy, and PostgREST answers a filtered delete with `204 No Content` —
-- success-shaped, nothing removed. So a commenter who compacted advanced the
-- shared watermark past rows that were still there, and the owner's next
-- compaction then read a watermark that already covered them and swept nothing.
-- The log grew for the life of the document, silently, and no client could tell.
--
-- The rights check has to live here, in the same statement as the write, because
-- that is the only place it cannot be raced or skipped.
--
-- ## 2. The two writes could not both happen
--
-- A crash, a refused request or a dropped connection between them leaves either
-- rows that the next compaction sweeps again (harmless) or — with the order the
-- other way round — a watermark claiming coverage of rows that are gone
-- (data loss). One function is one transaction, so neither is possible.
--
-- ## What it does
--
-- Owner or edit access only, forwards-only watermark, sweep, and the number of
-- rows deleted so the caller can log it. `-1` is not a status: the two refusals
-- raise, with SQLSTATEs the adapter maps — `42501` for "you may not", `P0002`
-- for "that resource is gone" (which a client treats as nothing to compact,
-- because there is nothing left to compact).

create or replace function public.compact_crdt_log(
  p_resource_type text,
  p_resource_id uuid,
  p_upto_id bigint
)
returns integer
language plpgsql
security definer
-- Pinned, as every definer function in this schema must be: without it a caller
-- can shadow `can_edit_resource` or `crdt_updates` through their own search_path
-- and this function would call *their* version as the owner.
set search_path = public, pg_temp
as $$
declare
  v_table   text;
  v_exists  integer;
  v_upto    bigint;
  v_deleted integer;
begin
  -- The entity tables that carry a watermark (migration 0042). An explicit case
  -- rather than a dynamic lookup: the table name is interpolated into the
  -- statements below, and an allowlist is the only shape that cannot be talked
  -- into naming another table.
  v_table := case p_resource_type
    when 'vault_page'     then 'vault_pages'
    when 'report_section' then 'report_sections'
    when 'log_entry'      then 'log_entries'
    else null
  end;
  if v_table is null then
    raise exception 'Unknown CRDT resource type %.', p_resource_type
      using errcode = '22023';
  end if;

  -- Existence *before* permission, and the order is load-bearing: for a resource
  -- that is gone, `can_edit_resource` is false for everybody, so asking it first
  -- turns "this document was deleted" into "you may not compact it" — and a
  -- client closing a deleted document would log a security refusal every time.
  -- This function had them the other way round until the test for a missing
  -- resource showed what the client actually received.
  execute format('select 1 from %I where id = $1', v_table)
  into v_exists
  using p_resource_id;

  if v_exists is null then
    raise exception 'No % row to compact.', p_resource_type
      using errcode = 'P0002';
  end if;

  -- The guard. `security definer` means the writes below bypass RLS, so this is
  -- the only thing standing between a commenter and the shared watermark.
  if not can_edit_resource(p_resource_type, p_resource_id) then
    raise exception 'Not permitted to compact %.', p_resource_type
      using errcode = '42501';
  end if;

  -- Forwards only, in the same statement, so two clients compacting at once
  -- cannot rewind each other. `greatest` with a coalesce because the column
  -- starts null, which means "nothing is covered yet" rather than zero.
  execute format(
    'update %I set snapshot_upto = greatest(coalesce(snapshot_upto, 0), $1) '
    'where id = $2 returning snapshot_upto',
    v_table
  )
  into v_upto
  using p_upto_id, p_resource_id;

  if v_upto is null then
    raise exception 'No % row to compact.', p_resource_type
      using errcode = 'P0002';
  end if;

  -- Only what the (possibly pre-existing, higher) watermark covers.
  delete from public.crdt_updates
   where resource_type = p_resource_type
     and resource_id = p_resource_id
     and id <= v_upto;

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

-- Definer functions are not public API: `authenticated` may call it, `anon` may
-- not (the schema-invariants test asserts both halves of that).
--
-- `anon` is named explicitly because `revoke ... from public` does not remove it:
-- `alter default privileges in schema public grant execute on functions to anon`
-- writes an `anon=X` entry into every new function's ACL, so a function created
-- here starts anon-executable and stays that way unless the revoke names it. That
-- is the trap migration `0130` exists to document, and this migration walked into
-- it — the schema-invariants test failed on the first run, which is what it is for.
revoke execute on function public.compact_crdt_log(text, uuid, bigint) from public, anon;
grant execute on function public.compact_crdt_log(text, uuid, bigint) to authenticated;
