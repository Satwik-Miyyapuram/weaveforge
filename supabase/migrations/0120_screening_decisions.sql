-- Screening decisions: one row per reviewer, per membership, per stage.
--
-- On `reading_list_items` rather than on `papers`, because the same paper
-- screened for two reviews is two questions with two answers. Per reviewer
-- rather than per item, because two people disagreeing is the normal state of a
-- screen in progress and the point of screening twice -- a single column would
-- make the second reviewer overwrite the first.
--
-- Nothing here stores a count. The PRISMA numbers are derived in `core` from
-- these rows every time they are asked for; a stored total is a total that
-- drifts the first time somebody changes their mind.

create table if not exists screening_decisions (
  id            uuid primary key default gen_random_uuid(),
  item_id       uuid not null references reading_list_items(id) on delete cascade,
  reviewer_id   uuid not null references auth.users(id) default auth.uid(),
  stage         text not null default 'title_abstract'
                  check (stage in ('title_abstract', 'full_text')),
  state         text not null check (state in ('included', 'excluded', 'unsure')),
  reason        text,
  decided_at    timestamptz not null default now(),
  unique (item_id, reviewer_id, stage)
);

create index if not exists screening_decisions_item_idx
  on screening_decisions (item_id, stage);
create index if not exists screening_decisions_reviewer_idx
  on screening_decisions (reviewer_id);

-- A record can be marked a duplicate of another in the same list. PRISMA counts
-- these out before screening starts, so they are a property of the membership
-- rather than a decision anybody made about the study.
alter table reading_list_items
  add column if not exists duplicate_of_item_id uuid
    references reading_list_items(id) on delete set null;

alter table screening_decisions enable row level security;

-- Read what you can already read: your own list, or one shared with you. A
-- screen you cannot see the other reviewer's half of is not a screen.
create policy "screening_decisions_select_access" on screening_decisions
  for select using (
    exists (
      select 1 from public.reading_list_items i
      join public.reading_lists l on l.id = i.list_id
      where i.id = screening_decisions.item_id
        and (l.user_id = (select auth.uid()) or shared_to_me('reading_list', i.list_id))
    )
  );

-- Write only your own decisions, and only on an item you can see. The owner of
-- the list is not exempt: overwriting a collaborator's judgement is exactly the
-- thing screening twice exists to prevent.
create policy "screening_decisions_insert_own" on screening_decisions
  for insert with check (
    reviewer_id = (select auth.uid())
    and exists (
      select 1 from public.reading_list_items i
      join public.reading_lists l on l.id = i.list_id
      where i.id = screening_decisions.item_id
        and (l.user_id = (select auth.uid()) or shared_to_me('reading_list', i.list_id))
    )
  );

create policy "screening_decisions_update_own" on screening_decisions
  for update using (reviewer_id = (select auth.uid()))
  with check (reviewer_id = (select auth.uid()));

create policy "screening_decisions_delete_own" on screening_decisions
  for delete using (reviewer_id = (select auth.uid()));

-- Screening is offline work, so the decisions have to be part of the change
-- feed like everything else a reviewer touches on a train.
insert into sync_tables (table_name) values ('screening_decisions')
on conflict (table_name) do nothing;

select sync_prepare();
