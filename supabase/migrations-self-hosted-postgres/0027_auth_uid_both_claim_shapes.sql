-- auth.uid() must read both JWT claim shapes, or PostgREST sees nothing.
--
-- 0000_self_host_prereqs.sql defines auth.uid() to read either GUC. 0025 then
-- redefines it reading only `request.jwt.claim.sub`, and because 0025 runs
-- later, that narrower version is what survives.
--
-- That was fine when PostgREST still set the legacy per-claim GUCs. It stopped
-- being fine at PostgREST 12, which removed them: from 12 onwards the only GUC
-- set is `request.jwt.claims`, a single JSON object. Against PostgREST 12+ the
-- 0025 definition returns NULL for every request, so `auth.uid() = user_id`
-- is false everywhere and every policy denies.
--
-- The symptom is quiet and easy to misread: requests authenticate fine and
-- return `200` with `[]`. No error, no warning — just an app where every list
-- is empty and every user appears to own nothing. An anonymous request still
-- gets a correct `401`, which makes the auth layer look healthy.
--
-- Reading both shapes keeps direct-to-Postgres callers working (the migration
-- scripts and psql sessions set the legacy GUC) alongside PostgREST 12+.

create or replace function auth.uid()
returns uuid
language sql
stable
set search_path = auth, public
as $$
  select coalesce(
    -- Legacy: set per transaction by our own scripts, and by PostgREST < 12.
    nullif(trim(both '"' from current_setting('request.jwt.claim.sub', true)), ''),
    -- Modern: the whole claim set as JSON. PostgREST 12+ sets only this.
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid;
$$;

comment on function auth.uid() is
  'Self-hosted: reads request.jwt.claim.sub (legacy, and our scripts) or request.jwt.claims->>sub (PostgREST 12+).';

-- Same treatment for auth.role(), which has the same split and the same trap.
create or replace function auth.role()
returns text
language sql
stable
set search_path = auth, public
as $$
  select coalesce(
    nullif(trim(both '"' from current_setting('request.jwt.claim.role', true)), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
  );
$$;

-- Calling a function needs USAGE on its schema as well as EXECUTE on the
-- function itself. 0026 grants EXECUTE but not USAGE, so anything calling
-- auth.uid() directly — rather than through a policy expression — fails with
-- "permission denied for schema auth". Supabase grants this too.
grant usage on schema auth to anon, authenticated, service_role;
