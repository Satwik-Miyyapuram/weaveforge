-- Migration: stop can_access looping on a supervisor cycle (review 39-05).
--
-- can_access (0062) walks the supervisor tree down from the caller with a
-- recursive CTE joined by `union all`. Nothing prevents profiles.supervisor_id
-- from forming a loop (A supervises B and B supervises A, or a row that names
-- itself), and on a loop `union all` adds the same members forever: every RLS
-- policy that reaches can_access hangs the query until it times out.
--
-- `union` drops rows the walk has already produced, so it stops after one lap
-- and answers exactly what the old version answered on any tree without a loop.
-- Same signature and `create or replace`, so the grants from 0079 stay.

create or replace function can_access(owner uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when owner is null then false
    when owner = auth.uid() then true
    else exists (
      with recursive subtree as (
        select auth.uid() as uid
        union
        select p.user_id
          from profiles p
          join subtree s on p.supervisor_id = s.uid
      )
      select 1 from subtree where uid = owner
    )
  end
$$;
