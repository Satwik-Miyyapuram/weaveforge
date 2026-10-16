-- Personal access tokens for the Python SDK (hashed at rest; plaintext shown once on create).

create table if not exists api_tokens (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  name          text not null check (char_length(trim(name)) > 0),
  token_hash    bytea not null,
  token_prefix  text not null,
  expires_at    timestamptz,
  last_used_at  timestamptz,
  created_at    timestamptz not null default now()
);

create unique index if not exists api_tokens_token_hash_idx on api_tokens (token_hash);
create index if not exists api_tokens_user_id_idx on api_tokens (user_id);

alter table api_tokens enable row level security;

drop policy if exists "api_tokens_owner_all" on api_tokens;
create policy "api_tokens_owner_all" on api_tokens
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Resolve token → user_id for SDK routes (service role only).
create or replace function resolve_api_token(p_token_hash bytea)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_id uuid;
begin
  select id, user_id into v_id, v_user_id
  from api_tokens
  where token_hash = p_token_hash
    and (expires_at is null or expires_at > now())
  limit 1;

  if v_id is null then
    return null;
  end if;

  update api_tokens set last_used_at = now() where id = v_id;
  return v_user_id;
end;
$$;

revoke all on function resolve_api_token(bytea) from public;
grant execute on function resolve_api_token(bytea) to service_role;
