-- Normalized concept tags (Obsidian-style) with provenance on paper membership.
-- papers.tags[] remains a denormalized cache for filters until fully migrated.

create table if not exists tags (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) default auth.uid(),
  project_id    uuid references projects(id) on delete cascade,
  name          text not null,
  color         text,
  created_at    timestamptz not null default now(),
  unique (user_id, project_id, name)
);

create index if not exists tags_project_name_idx on tags (project_id, name);
create index if not exists tags_user_name_idx on tags (user_id, name);

create table if not exists paper_tags (
  paper_id      uuid not null references papers(id) on delete cascade,
  tag_id        uuid not null references tags(id) on delete cascade,
  source        text not null default 'manual',
  annotation_ref text,
  primary key (paper_id, tag_id, source)
);

create index if not exists paper_tags_tag_idx on paper_tags (tag_id);
create index if not exists paper_tags_paper_idx on paper_tags (paper_id);

-- Backfill tags + paper_tags from papers.tags[] cache.
insert into tags (user_id, project_id, name)
select distinct p.user_id, p.project_id, unnest(p.tags) as name
from papers p
where cardinality(p.tags) > 0
on conflict (user_id, project_id, name) do nothing;

insert into paper_tags (paper_id, tag_id, source)
select p.id, t.id, 'manual'
from papers p
cross join lateral unnest(p.tags) as tag_name(name)
join tags t on t.name = tag_name.name
  and t.user_id = p.user_id
  and (t.project_id is not distinct from p.project_id)
on conflict do nothing;

alter table tags enable row level security;
alter table paper_tags enable row level security;

drop policy if exists "tags_select_own" on tags;
create policy "tags_select_own" on tags
  for select using (auth.uid() = user_id);

drop policy if exists "tags_modify_own" on tags;
create policy "tags_modify_own" on tags
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "paper_tags_select_own" on paper_tags;
create policy "paper_tags_select_own" on paper_tags
  for select using (
    exists (select 1 from papers p where p.id = paper_tags.paper_id and p.user_id = auth.uid())
  );

drop policy if exists "paper_tags_modify_own" on paper_tags;
create policy "paper_tags_modify_own" on paper_tags
  for all using (
    exists (select 1 from papers p where p.id = paper_tags.paper_id and p.user_id = auth.uid())
  )
  with check (
    exists (select 1 from papers p where p.id = paper_tags.paper_id and p.user_id = auth.uid())
  );
