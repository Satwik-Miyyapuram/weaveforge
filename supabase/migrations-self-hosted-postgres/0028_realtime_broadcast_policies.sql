-- Broadcast authorization for a self-hosted Realtime.
--
-- Two reasons this exists as a follow-up rather than living only in 0044.
--
-- 1. Realtime runs its own migrations on first boot (`/app/bin/migrate`) and
--    owns the `realtime` schema. Whatever it does to `realtime.messages` — and
--    across versions it has replaced that table with a partitioned one — takes
--    the policies with it. Re-running the follow-ups after Realtime has booted
--    puts them back, which is why the applier keeps this step re-runnable:
--
--        npm run migrate:schema -- --follow-ups-only
--
-- 2. The `proj:{projectId}` topic was never authorized. 0044 only resolves
--    `crdt:` topics, and 0047 recorded that the invalidation channel needed
--    "no extra migration beyond client wiring" — but a `proj:` topic parses to
--    a null resource_id, so the policy denies it. Cross-tab cache invalidation
--    has been failing closed ever since: correctness was never at risk (a stale
--    tab just refetches on its own schedule), which is why it went unnoticed.
--
-- Both topics are covered below.

-- ------------------------------------------------------------------- roles
-- Realtime runs a second set of migrations per tenant, and those grant to role
-- names a Supabase-hosted database always has: `postgres` (the owner there),
-- plus its own admin roles. This database is owned by `weaveforge`, so the
-- tenant migrations fail with `role "postgres" does not exist`, the tenant is
-- terminated, and every channel join answers `error_generating_signer` — which
-- names neither the missing role nor the migration that wanted it.
--
-- Created NOLOGIN, exactly like the `anon` / `authenticated` / `service_role`
-- trio in `0000_self_host_prereqs.sql`: they exist to be granted to, never to
-- connect as.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'postgres') then
    create role postgres nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_admin') then
    create role supabase_admin nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_realtime_admin') then
    create role supabase_realtime_admin nologin noinherit;
  end if;
end
$$;

-- ------------------------------------------------- hand back realtime.messages
-- `0000_self_host_prereqs.sql` creates a stub `realtime.messages` so that
-- `0044` has a table to attach policies to on a database Realtime has never
-- touched. Once Realtime is actually running, that stub is in its way: its own
-- migrations expect the table it builds (a partitioned one, with a bigint
-- sequence) and fail with `relation "realtime.messages_id_seq" does not exist`.
-- The tenant is then terminated at boot and every channel join answers
-- `error_generating_signer`.
--
-- So: if what is there is the stub, drop it and let Realtime create its own.
--
-- The two are told apart by partitioning, not by columns. Both have a uuid
-- `id`, so a column test drops the *real* table on every re-run — Realtime then
-- reports `UnableToSetPolicies` and the policies land nowhere. Realtime's table
-- is partitioned by `inserted_at` (relkind 'p'); the stub is an ordinary table
-- (relkind 'r').
--
-- Re-running this file after Realtime has migrated re-attaches the policies to
-- the real table, which is the documented order in the shift guide.
do $$
begin
  if exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'realtime' and c.relname = 'messages' and c.relkind = 'r'
  ) then
    drop table realtime.messages cascade;
  end if;
end
$$;

-- The `crdt:` parser, unchanged from 0044. Repeated here so this file stands
-- alone against a database where Realtime's migrations ran after the base set.
create or replace function public.parse_crdt_topic(topic text)
returns table (resource_type text, resource_id uuid)
language sql immutable
as $$
  select split_part(topic, ':', 2), nullif(split_part(topic, ':', 3), '')::uuid
  where topic like 'crdt:%:%'
$$;

/** The project a `proj:{uuid}` invalidation topic refers to, or nothing. */
create or replace function public.parse_project_topic(topic text)
returns uuid
language sql immutable
as $$
  select nullif(split_part(topic, ':', 2), '')::uuid
  where topic like 'proj:%'
$$;

alter function public.parse_project_topic(text) set search_path = public;

/** Whether the caller owns the project a topic names. */
create or replace function public.can_use_project_topic(topic text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.projects p
    where p.id = public.parse_project_topic(topic)
      and p.user_id = auth.uid()
  )
$$;

revoke all on function public.can_use_project_topic(text) from public;
grant execute on function public.can_use_project_topic(text) to authenticated;

-- The policies only exist when the table does. On a fresh database that is
-- after Realtime's first boot, which is why this file is re-run then.
do $body$
begin
if to_regclass('realtime.messages') is null then
  raise notice 'realtime.messages absent - start Realtime, then re-run with --follow-ups-only';
  return;
end if;

execute $ddl$
  -- Reading a channel: a document you may view, or a project you own.
  drop policy if exists "crdt_realtime_select" on realtime.messages;
  create policy "crdt_realtime_select" on realtime.messages
    for select to authenticated
    using (
      realtime.messages.extension = 'broadcast'
      and (
        exists (
          select 1 from public.parse_crdt_topic(realtime.topic()) t
          where t.resource_id is not null
            and public.can_view_resource(t.resource_type, t.resource_id)
        )
        or public.can_use_project_topic(realtime.topic())
      )
    );

  -- Writing to a channel needs edit rights on the document. The project topic
  -- carries no content — only "something changed, drop your caches" — so
  -- ownership is the whole of the check.
  drop policy if exists "crdt_realtime_insert" on realtime.messages;
  create policy "crdt_realtime_insert" on realtime.messages
    for insert to authenticated
    with check (
      realtime.messages.extension = 'broadcast'
      and (
        exists (
          select 1 from public.parse_crdt_topic(realtime.topic()) t
          where t.resource_id is not null
            and public.can_edit_resource(t.resource_type, t.resource_id)
        )
        or public.can_use_project_topic(realtime.topic())
      )
    );
$ddl$;
end
$body$;
