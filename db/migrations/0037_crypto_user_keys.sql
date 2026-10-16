-- E2EE user key material (plan §6 migration 0037).

create table if not exists user_keys (
  user_id              uuid primary key references auth.users(id) on delete cascade,
  kek_source           text not null check (kek_source in ('passphrase', 'login-password')),
  kdf_params           jsonb not null,
  umk_wrapped_kek      bytea not null,
  recovery_salt        bytea not null,
  umk_wrapped_recovery bytea not null,
  box_pub              bytea not null,
  sign_pub             bytea not null,
  box_sk_enc           bytea not null,
  sign_sk_enc          bytea not null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

alter table user_keys enable row level security;

drop policy if exists "user_keys_owner" on user_keys;
create policy "user_keys_owner" on user_keys
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Labmates fetch wrapping pubkeys via RPC (never secret material).
create or replace function get_public_keys(user_ids uuid[])
returns table (user_id uuid, box_pub bytea, sign_pub bytea)
language sql stable security definer set search_path = public
as $$
  select uk.user_id, uk.box_pub, uk.sign_pub
  from user_keys uk
  where uk.user_id = any(user_ids)
    and lab_root(uk.user_id) = lab_root(auth.uid())
$$;

grant execute on function get_public_keys(uuid[]) to authenticated;
