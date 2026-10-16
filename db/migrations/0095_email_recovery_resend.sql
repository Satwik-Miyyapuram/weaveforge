-- Server-held copy of the email-recovery secret so a locked-out device can ask
-- for the recovery link to be re-sent. This is a deliberate trade-off: the
-- security boundary for email recovery is now the user's verified inbox, and
-- whoever operates this instance (service role) can read the secret and unlock
-- accounts that enabled email recovery. Accounts that never enable it are
-- unaffected — nothing here can unlock them.
create table if not exists user_email_recovery_secrets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  secret text not null,
  updated_at timestamptz not null default now()
);

alter table user_email_recovery_secrets enable row level security;

-- No policies for authenticated/anon: the secret must never be readable through
-- a normal session (that would let a password-only attacker unlock). Only the
-- server's service role — which bypasses RLS — may read or write it.
revoke all on user_email_recovery_secrets from anon, authenticated;
grant all on user_email_recovery_secrets to service_role;

comment on table user_email_recovery_secrets is
  'Server-recoverable email-recovery secret. Released only by emailing the recovery link to the verified address; never returned to a client. Service role only.';
