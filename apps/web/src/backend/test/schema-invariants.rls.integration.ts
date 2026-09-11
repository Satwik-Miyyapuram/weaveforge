import assert from "node:assert/strict";
import test from "node:test";
import { testDb } from "@/backend/test/pg-test-db";

/**
 * Schema invariants that no per-feature test can state, checked against the
 * real migrations on an in-process Postgres.
 *
 * Every assertion here exists because the repository got it wrong at least once
 * and nothing noticed:
 *
 *   * `sync_prepare()` (0118) kept anon EXECUTE for four migrations, because
 *     `0081`'s revoke list was hand-maintained and predated it.
 *   * Six more definer functions kept anon EXECUTE for longer, because
 *     `revoke ... from public` does not remove the explicit `anon` grant that
 *     Supabase's default privileges write into every new function's ACL. That
 *     idiom appears in `0079`, `0081`, `0114`, `0116`, `0117`, `0123` and
 *     `0125`, and it was only ever half-true. See
 *     0130_revoke_anon_from_internal_definers.sql.
 *   * A table that forgot `enable row level security` would be readable by
 *     every tenant, and RLS-on-but-policyless denies everything, so the feature
 *     is silently broken rather than silently exposed. Both are worth failing
 *     on, for different reasons.
 *
 * These are cross-table, cross-migration facts. They cannot live in a feature's
 * suite without that feature looking like the owner of the whole schema.
 *
 * ## What is deliberately NOT asserted
 *
 * "Every UPDATE/ALL policy must declare a WITH CHECK." That reads like the
 * obvious companion to the INSERT case and it is not a security invariant:
 * PostgreSQL reuses the `USING` expression as the check when `WITH CHECK` is
 * omitted, so such a policy is not a hole. Asserting it would fail on correct
 * policies and teach the next reader to write a redundant clause to satisfy a
 * test. The re-assignment risk it is meant to catch — an owner column edited to
 * point at another tenant — is covered by the policies themselves, which restate
 * the owner predicate in `WITH CHECK` where they mean to (`0087`, `0088`).
 */

/**
 * Tables that are one device's own bookkeeping, not shared data.
 *
 * They come from `supabase/migrations-local`, are applied only by the desktop
 * app, and hold the outbox, the conflict log and the blob cache for a single
 * user on a single machine. There is no second tenant to isolate them from, so
 * there is no policy to write and RLS is deliberately absent rather than
 * forgotten. Anything in `supabase/migrations` is expected to have it.
 */
const DEVICE_ONLY_TABLES = new Map([
  ["sync_outbox", "device-local outbox (migrations-local)"],
  ["sync_conflicts", "device-local conflict log (migrations-local)"],
  ["sync_state", "device-local sync watermark (migrations-local)"],
  ["offline_projects", "device-local offline scope (migrations-local)"],
  ["offline_blobs", "device-local blob cache (migrations-local)"],
  ["local_blobs", "device-local blob store (migrations-local)"],
  ["local_secrets", "device-local secret store (migrations-local)"],
]);

/**
 * Definer functions that are callable without an account, on purpose.
 *
 * Opening a share link is the one flow that runs before sign-in, so its
 * resolver has to answer anon. `0081` names it as the single intentional
 * exception, and `check_share_link_rate` bounds it. Everything else that is
 * `security definer` is an internal write path and belongs to `authenticated`
 * or `service_role` only.
 */
const ANON_EXECUTABLE_ALLOWED = new Set(["resolve_share_link"]);

/** Smallest number of rows each query must return before it proves anything. */
const MIN_TABLES = 40;
const MIN_DEFINERS = 20;

test("every shared table has RLS, and every policy-protected table has a policy", async () => {
  const db = await testDb();

  const tables = await db.sql<{ relname: string }>(
    `select c.relname from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
      order by 1`,
  );
  // A query that returns nothing would satisfy an "all of them are fine" check
  // without inspecting anything, which is the failure mode this suite exists to
  // prevent. `verify-migration.mjs` makes the same point about its probe users.
  assert.ok(
    tables.length >= MIN_TABLES,
    `expected at least ${MIN_TABLES} tables in public, found ${tables.length} — the query is not seeing the schema`,
  );

  const withoutRls = tables
    .map((t) => t.relname)
    .filter((name) => !DEVICE_ONLY_TABLES.has(name));

  // Re-queried rather than derived: this is the assertion, so it asks the
  // catalog directly instead of filtering a list that was already narrowed.
  const rlsOff = await db.sql<{ relname: string }>(
    `select c.relname from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
      order by 1`,
  );
  const unexpected = rlsOff.map((r) => r.relname).filter((n) => !DEVICE_ONLY_TABLES.has(n));
  assert.deepEqual(
    unexpected,
    [],
    `tables with RLS disabled that are not device-local:\n  ${unexpected.join("\n  ")}\n` +
      "Either add `enable row level security` plus policies, or list the table in " +
      "DEVICE_ONLY_TABLES with the reason it holds no cross-tenant data.",
  );

  // Fail the allowlist when it stops being needed, so it cannot rot the way
  // OVERSIZED_ALLOWED in check-hygiene.mjs would without its staleness pass.
  const stale = [...DEVICE_ONLY_TABLES.keys()].filter(
    (name) => !rlsOff.some((r) => r.relname === name),
  );
  assert.deepEqual(
    stale,
    [],
    `device-local allowlist entries that now have RLS: ${stale.join(", ")} — remove them from DEVICE_ONLY_TABLES`,
  );

  const policyLess = await db.sql<{ relname: string }>(
    `select c.relname from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
        and not exists (select 1 from pg_policy p where p.polrelid = c.oid)
      order by 1`,
  );
  assert.deepEqual(
    policyLess.map((r) => r.relname),
    [],
    "RLS is enabled but no policy exists, so every query against these tables is denied",
  );

  assert.ok(withoutRls.length > 0);
});

test("no internal definer function is callable without an account", async () => {
  const db = await testDb();

  const definers = await db.sql<{ fn: string; cfg: string[] | null; anon: boolean; auth: boolean }>(
    `select p.proname as fn,
            p.proconfig as cfg,
            has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
            has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosecdef
      order by 1`,
  );
  assert.ok(
    definers.length >= MIN_DEFINERS,
    `expected at least ${MIN_DEFINERS} security definer functions, found ${definers.length} — the query is not seeing them`,
  );

  // The invariant this file was written for. `revoke ... from public` does not
  // satisfy it: Supabase grants EXECUTE to `anon` explicitly through default
  // privileges, so a function is only unreachable when `anon` is named in the
  // revoke. Asserting the privilege rather than grepping for the statement is
  // the whole point — the statement looked right for four migrations.
  const anonCallable = definers
    .filter((d) => d.anon)
    .map((d) => d.fn)
    .filter((name) => !ANON_EXECUTABLE_ALLOWED.has(name));
  assert.deepEqual(
    anonCallable,
    [],
    `security definer functions callable by anon (PostgREST exposes these at /rpc/<name>):\n  ${anonCallable.join("\n  ")}\n` +
      "Revoke `anon` explicitly — `revoke ... from public` does not remove the grant Supabase's " +
      "default privileges gave it. If the function is public on purpose, add it to " +
      "ANON_EXECUTABLE_ALLOWED with the reason.",
  );

  const staleAllowed = [...ANON_EXECUTABLE_ALLOWED].filter(
    (name) => !definers.some((d) => d.fn === name && d.anon),
  );
  assert.deepEqual(
    staleAllowed,
    [],
    `allowlisted as anon-callable but no longer is: ${staleAllowed.join(", ")} — remove from ANON_EXECUTABLE_ALLOWED`,
  );

  // A definer function without a pinned search_path resolves unqualified names
  // through the caller's path, which is how a definer function is made to run
  // somebody else's code.
  const unpinned = definers
    .filter((d) => !d.cfg?.some((c) => c.startsWith("search_path=")))
    .map((d) => d.fn);
  assert.deepEqual(
    unpinned,
    [],
    `security definer functions without a pinned search_path: ${unpinned.join(", ")}`,
  );
});
