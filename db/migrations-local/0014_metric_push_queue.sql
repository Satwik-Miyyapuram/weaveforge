-- Metric points follow their run's owner, and the push reads a queue of
-- changed series instead of scanning every point every 30 s.

-- sync_claim only re-owns sync_tables; metric points are not one, so after
-- sign-in they stayed on the local user and RLS hid them.
create or replace function local_metric_follow_owner() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update experiment_metric_points set user_id = new.user_id where experiment_id = new.id and user_id = old.user_id;
  update experiment_metric_chunks set user_id = new.user_id where experiment_id = new.id and user_id = old.user_id;
  return null;
end;
$$;

create table if not exists public.local_metric_dirty (
  experiment_id uuid not null,
  metric_id int not null,
  primary key (experiment_id, metric_id)
);

create or replace function local_metric_mark_dirty() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into local_metric_dirty (experiment_id, metric_id)
  select distinct experiment_id, metric_id from changed
  on conflict do nothing;
  return null;
end;
$$;

-- The sync tests load only these migrations, without the experiment tables.
do $guard$
begin
  if to_regclass('public.experiments') is null or to_regclass('public.experiment_metric_points') is null then
    return;
  end if;
  execute $sql$
drop trigger if exists local_metric_follow_owner on experiments;
create trigger local_metric_follow_owner
  after update of user_id on experiments
  for each row when (old.user_id is distinct from new.user_id)
  execute function local_metric_follow_owner();

-- Devices adopted before this fix.
update experiment_metric_points p set user_id = e.user_id
  from experiments e
 where e.id = p.experiment_id and p.user_id <> e.user_id;
update experiment_metric_chunks c set user_id = e.user_id
  from experiments e
 where e.id = c.experiment_id and c.user_id <> e.user_id;
drop trigger if exists local_metric_mark_dirty on experiment_metric_points;
create trigger local_metric_mark_dirty
  after insert on experiment_metric_points
  referencing new table as changed
  for each statement execute function local_metric_mark_dirty();

-- Series written before the queue existed and not yet fully sent.
insert into local_metric_dirty (experiment_id, metric_id)
select s.experiment_id, s.metric_id
  from (select experiment_id, metric_id, max(step) as tip from experiment_metric_points group by 1, 2) s
  join experiment_metric_names n on n.id = s.metric_id
  left join local_metric_pushes p on p.experiment_id = s.experiment_id and p.metric = n.name
 where p.step is null or p.step < s.tip
on conflict do nothing;
  $sql$;
end;
$guard$;

revoke all on function local_metric_follow_owner() from public;
revoke all on function local_metric_mark_dirty() from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function local_metric_follow_owner() from anon;
    revoke all on function local_metric_mark_dirty() from anon;
  end if;
end;
$$;
