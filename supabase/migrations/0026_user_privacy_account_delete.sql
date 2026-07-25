-- Privacy disclaimer acceptance + self-service account deletion helper.

alter table user_settings
  add column if not exists disclaimer_accepted_at timestamptz;

comment on column user_settings.disclaimer_accepted_at is
  'When the user accepted the org/privacy disclaimer (shown once after first sign-in).';

-- Remove all app data for a user (service role only). Auth user deleted separately via Admin API.
create or replace function public.delete_user_account_data(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_id is null then
    raise exception 'user id required';
  end if;

  delete from comments where author_id = p_user_id;
  delete from shares where owner_id = p_user_id or recipient_id = p_user_id;
  delete from blob_objects where user_id = p_user_id;
  delete from projects where user_id = p_user_id;
  delete from user_settings where user_id = p_user_id;
end;
$$;

revoke all on function public.delete_user_account_data(uuid) from public;
grant execute on function public.delete_user_account_data(uuid) to service_role;
