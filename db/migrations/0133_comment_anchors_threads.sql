-- Migration: comments can point at a passage, be answered, and be resolved.
--
-- Notes get Google-Docs-style margin comments. Three additions to `comments`
-- (0018), all nullable so every existing comment keeps meaning what it meant:
--
-- * `anchor_quote` / `anchor_prefix` / `anchor_suffix` — the passage a comment
--   is about, stored as the text itself plus a little context either side (the
--   W3C TextQuoteSelector shape) rather than as offsets. Offsets go stale with
--   the first edit above the passage; a quote is re-found in whatever the body
--   has become, and a comment whose quote is gone falls back to the page-level
--   list instead of pointing at the wrong words.
-- * `parent_id` — a reply. Replies carry no anchor of their own; they belong to
--   their root's thread, and go when the root goes.
-- * `resolved_at` — the thread is done. Set on the root only.
--
-- Resolving is not an UPDATE policy: a policy that let the page owner resolve
-- someone else's comment would also let them rewrite its body. The function
-- below writes the one column, after the one check.

alter table comments
  add column if not exists anchor_quote  text,
  add column if not exists anchor_prefix text,
  add column if not exists anchor_suffix text,
  add column if not exists parent_id     uuid references comments(id) on delete cascade,
  add column if not exists resolved_at   timestamptz;

create index if not exists comments_parent_id_idx on comments (parent_id);

-- The insert policy (0018) checks who may comment on a resource; it knows
-- nothing of the new columns. So a new row is held to them here: it starts
-- unresolved (only the function below resolves), and a reply answers a root
-- comment on the same resource — never a comment on something else the author
-- happens to be able to see, which would plant their words in that thread.
create or replace function public.comments_check_new()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_parent comments%rowtype;
begin
  new.resolved_at := null;
  if new.parent_id is not null then
    select * into v_parent from comments where id = new.parent_id;
    if not found
       or v_parent.parent_id is not null
       or v_parent.resource_type is distinct from new.resource_type
       or v_parent.resource_id is distinct from new.resource_id then
      raise exception 'a reply answers a comment on the same resource' using errcode = '22023';
    end if;
    new.anchor_quote := null;
    new.anchor_prefix := null;
    new.anchor_suffix := null;
  end if;
  return new;
end;
$$;

drop trigger if exists comments_check_new on comments;
create trigger comments_check_new
  before insert on comments
  for each row execute function public.comments_check_new();

-- Resolve or reopen a thread. The comment's author or the owner of the thing it
-- is on may; nobody else, and never a reply (a thread resolves at its root).
create or replace function public.set_comment_resolved(
  p_comment_id uuid,
  p_resolved boolean
)
returns timestamptz
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row comments%rowtype;
  v_at  timestamptz := case when p_resolved then now() else null end;
begin
  select * into v_row from comments where id = p_comment_id;
  if not found then
    raise exception 'comment not found' using errcode = 'P0002';
  end if;
  if v_row.parent_id is not null then
    raise exception 'resolve the thread, not a reply' using errcode = '22023';
  end if;
  if v_row.author_id is distinct from auth.uid()
     and resource_owner(v_row.resource_type, v_row.resource_id) is distinct from auth.uid() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update comments set resolved_at = v_at where id = p_comment_id;
  return v_at;
end;
$$;

-- `anon` named explicitly: see 0130 and 0132.
revoke execute on function public.set_comment_resolved(uuid, boolean) from public, anon;
grant execute on function public.set_comment_resolved(uuid, boolean) to authenticated;
