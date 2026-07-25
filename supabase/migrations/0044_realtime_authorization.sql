-- Realtime broadcast authorization for encrypted CRDT channels (plan §7.4 migration 0044).
-- Requires Supabase Realtime ≥2.28 with private channel support.

create or replace function public.parse_crdt_topic(topic text)
returns table (resource_type text, resource_id uuid)
language sql immutable
as $$
  select split_part(topic, ':', 2), nullif(split_part(topic, ':', 3), '')::uuid
  where topic like 'crdt:%:%'
$$;

drop policy if exists "crdt_realtime_select" on realtime.messages;
create policy "crdt_realtime_select" on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and exists (
      select 1 from public.parse_crdt_topic(realtime.topic()) t
      where t.resource_id is not null
        and public.can_view_resource(t.resource_type, t.resource_id)
    )
  );

drop policy if exists "crdt_realtime_insert" on realtime.messages;
create policy "crdt_realtime_insert" on realtime.messages
  for insert to authenticated
  with check (
    realtime.messages.extension = 'broadcast'
    and exists (
      select 1 from public.parse_crdt_topic(realtime.topic()) t
      where t.resource_id is not null
        and public.can_edit_resource(t.resource_type, t.resource_id)
    )
  );
