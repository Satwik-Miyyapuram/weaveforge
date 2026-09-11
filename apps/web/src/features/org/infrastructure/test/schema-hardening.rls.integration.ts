import assert from "node:assert/strict";
import test from "node:test";
import { testDb } from "@/backend/test/pg-test-db";

/**
 * The schema fixes from review pass 2, against the real migrations.
 *
 * Every claim below is about what the *database* does once every migration has
 * been applied — a policy's `with check`, a function's ACL, a trigger firing —
 * and none of it can be read off the migration files, because a policy written
 * in `0088` and the migration that tightens it in `0124` are two files whose
 * only meeting point is a database. See `backend/test/pg-test-db.ts` for what
 * PGlite does and does not reproduce.
 *
 * One process, one database, so the cases share it; each creates its own users
 * and rows.
 */

/** A 32-byte hash for a synthetic API token, as the driver expects a `bytea`. */
const tokenHash = (seed: string) => new Uint8Array(32).fill(seed.charCodeAt(0));

/**
 * Tables `A5` does not hold to the server's rule.
 *
 * The device-only tables from `supabase/migrations-local/` are applied by
 * `pg-test-db.ts` so that cross-set features can be exercised, but they belong
 * to the single-user database inside the desktop app: there is no second client
 * for a timestamp to be wrong *for*, and they set `now()` in their own
 * statements. This mirrors the `local_` exemption in
 * `scripts/lib/rls-invariants.ts`, and is written out rather than derived so a
 * new prefix has to be added here on purpose.
 */
const DEVICE_ONLY_PREFIX = "local_";

test("A1: sync_prepare is not executable by a client, but stays executable by the deployer", async () => {
  const db = await testDb();
  const [row] = await db.sql<{ anon: boolean; auth: boolean; svc: boolean }>(
    `select has_function_privilege('anon', 'public.sync_prepare()', 'execute') as anon,
            has_function_privilege('authenticated', 'public.sync_prepare()', 'execute') as auth,
            has_function_privilege('service_role', 'public.sync_prepare()', 'execute') as svc`,
  );
  // It is a loop of `alter table` and a full-table update. A client that could
  // call it could take ACCESS EXCLUSIVE locks on every registered table.
  assert.equal(row!.anon, false, "an anonymous client must not be able to take DDL locks");
  assert.equal(row!.auth, false, "nor a signed-in one");
  assert.equal(row!.svc, true, "service_role is what PostgREST runs as, and what re-prepares a new table");
});

test("A1: a re-run of the migration chain leaves sync_prepare revoked", async () => {
  // `0123` is idempotent by construction (a revoke is), but the property worth
  // asserting is that *some* later migration has not handed the grant back —
  // `0120` and `0118` both call the function, and a `create or replace` in a
  // future file would keep the ACL while a `grant` would not.
  const db = await testDb();
  const [row] = await db.sql<{ n: number }>(
    `select count(*)::int as n
       from pg_proc p
       join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a on a.privilege_type = 'EXECUTE'
      where p.proname = 'sync_prepare'
        and coalesce(a.grantee::regrole::text, 'PUBLIC') in ('PUBLIC', 'anon', 'authenticated')`,
  );
  assert.equal(row!.n, 0, "no client role may hold EXECUTE on sync_prepare");
});

test("A2: a registry row cannot claim a path inside another user's folder", async () => {
  const db = await testDb();
  const a = await db.createUser();
  const b = await db.createUser();

  // The caller's own path is fine — this is what the app actually writes.
  await db.as(a).sql("insert into blob_objects (bucket, path) values ('paper-images', $1)", [
    `${a}/paper-1/fig.webp`,
  ]);

  // `unique (bucket, path)` is global, so one row claiming the victim's key
  // permanently blocks the victim's own registry insert for an object they
  // really did upload. That is the attack: no sharing, no cooperation, one
  // request, and the victim's blob becomes unfindable.
  await assert.rejects(
    () => db.as(a).sql("insert into blob_objects (bucket, path) values ('paper-images', $1)", [
      `${b}/paper-1/fig.webp`,
    ]),
    /row-level security/,
    "the leading path segment must equal the caller",
  );

  // The victim's own row still inserts, which is the property that was broken.
  await db.as(b).sql("insert into blob_objects (bucket, path) values ('paper-images', $1)", [
    `${b}/paper-1/fig.webp`,
  ]);
});

test("A2: UPDATE cannot walk around the path binding", async () => {
  const db = await testDb();
  const a = await db.createUser();
  const b = await db.createUser();
  const [own] = await db.as(a).sql<{ id: string }>(
    "insert into blob_objects (bucket, path) values ('paper-images', $1) returning id",
    [`${a}/paper-1/fig.webp`],
  );

  // Insert-tight and update-loose is not tight: a row inserted under one's own
  // key could simply be renamed onto the victim's.
  await assert.rejects(
    () => db.as(a).sql("update blob_objects set path = $1 where id = $2", [
      `${b}/paper-1/fig.webp`,
      own!.id,
    ]),
    /row-level security/,
  );

  // Renaming within one's own folder is still allowed.
  await db.as(a).sql("update blob_objects set path = $1 where id = $2", [
    `${a}/paper-1/fig-2.webp`,
    own!.id,
  ]);
});

test("A3: metrics can only be appended to an experiment the writer owns", async () => {
  const db = await testDb();
  const owner = await db.createUser();
  const collaborator = await db.createUser();

  const [experiment] = await db.as(owner).sql<{ id: string }>(
    "insert into experiments (name) values ('Sweep') returning id",
  );

  // The owner's own write, through the compatibility view — the path the SDK
  // route takes.
  await db.as(owner).sql(
    "insert into experiment_metrics (experiment_id, metric, step, value) values ($1, 'loss', 0, 1.0)",
    [experiment!.id],
  );

  // SELECT is widened by `shared_to_me('experiment', experiment_id)`, so before
  // 0126 a collaborator could insert points tagged with their own `user_id`
  // against the owner's `experiment_id` — and the owner had no UPDATE policy
  // over them, so the fabricated points could be neither corrected nor traced.
  await assert.rejects(
    () =>
      db.as(collaborator).sql(
        "insert into experiment_metrics (experiment_id, metric, step, value) values ($1, 'loss', 1, 9.9)",
        [experiment!.id],
      ),
    /row-level security/,
    "a collaborator must not be able to fabricate a point on someone else's curve",
  );

  // The archive is a second write path with the same grant, so it needs the
  // same rule — reaching it directly must not be a way around the view.
  await assert.rejects(
    () =>
      db.as(collaborator).sql(
        `insert into experiment_metric_chunks
           (experiment_id, user_id, metric_id, chunk_no, steps, values, wall_times)
         select $1, $2, id, 0, array[5], array[1.0], array[now()]
           from experiment_metric_names where name = 'loss'`,
        [experiment!.id, collaborator],
      ),
    /row-level security/,
  );

  // And the row store underneath the view.
  await assert.rejects(
    () =>
      db.as(collaborator).sql(
        `insert into experiment_metric_points (experiment_id, user_id, value, metric_id, step)
         select $1, $2, 9.9, id, 2 from experiment_metric_names where name = 'loss'`,
        [experiment!.id, collaborator],
      ),
    /row-level security/,
  );

  const points = await db.as(owner).sql<{ step: number }>(
    "select step from experiment_metrics where experiment_id = $1 order by step",
    [experiment!.id],
  );
  assert.deepEqual(points.map((p) => p.step), [0], "only the owner's own point survives");
});

test("A3: an owner can still write to their own experiment through the view", async () => {
  const db = await testDb();
  const owner = await db.createUser();
  const [experiment] = await db.as(owner).sql<{ id: string }>(
    "insert into experiments (name) values ('Own') returning id",
  );
  for (const step of [0, 1, 2]) {
    await db.as(owner).sql(
      "insert into experiment_metrics (experiment_id, metric, step, value) values ($1, 'acc', $2, $3)",
      [experiment!.id, step, step / 10],
    );
  }
  // Re-ingest must stay idempotent: the INSTEAD OF trigger's `on conflict do
  // update` is what makes a retried batch harmless.
  await db.as(owner).sql(
    "insert into experiment_metrics (experiment_id, metric, step, value) values ($1, 'acc', 1, 0.5)",
    [experiment!.id],
  );
  const points = await db.as(owner).sql<{ value: number }>(
    "select value from experiment_metrics where experiment_id = $1 and step = 1",
    [experiment!.id],
  );
  assert.equal(points.length, 1, "a re-ingest must not duplicate a point");
  assert.equal(Number(points[0]!.value), 0.5, "last write wins");
});

test("A5: every table that declares updated_at has a trigger to maintain it", async () => {
  const db = await testDb();

  // The invariant, asked of the catalog rather than of a hand-written row per
  // table: any table in `public` with an `updated_at` column and no trigger that
  // writes it is a table whose timestamp is whatever the client last sent. That
  // is a strictly better question than "are these five names present", because
  // it also catches the sixth table added by a future migration — which is
  // exactly how these five were missed in the first place.
  //
  // `user_email_recovery_secrets` is not in the answer because `0099` dropped it
  // with the rest of the client-E2EE schema, and the device-only tables are
  // excluded for the reason `DEVICE_ONLY_PREFIX` gives.
  const untriggered = await db.sql<{ table_name: string }>(
    `select c.relname as table_name
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       join pg_attribute a on a.attrelid = c.oid and a.attname = 'updated_at' and not a.attisdropped
      where n.nspname = 'public' and c.relkind = 'r'
        and c.relname not like $1
        and not exists (
          select 1 from pg_trigger t
           where t.tgrelid = c.oid and not t.tgisinternal and t.tgfoid = 'public.set_updated_at()'::regprocedure
        )
      order by c.relname`,
    [`${DEVICE_ONLY_PREFIX}%`],
  );
  assert.deepEqual(
    untriggered.map((r) => r.table_name),
    [],
    "a table with updated_at and no set_updated_at trigger keeps whatever the client sent",
  );

  // And that the trigger does what the claim above assumes, on a representative
  // table: the client explicitly sends the value a slow clock or an echoed
  // timestamp produces, and the database overwrites it.
  const user = await db.createUser();
  const [page] = await db.as(user).sql<{ id: string }>(
    "insert into vault_pages (title, body, user_id) values ('t', 'b', $1) returning id",
    [user],
  );
  const [written] = await db.as(user).sql<{ epoch: boolean }>(
    `update vault_pages set updated_at = 'epoch'::timestamptz where id = $1
       returning updated_at = 'epoch'::timestamptz as epoch`,
    [page!.id],
  );
  // `vault_pages.updated_at` is what `listStamps()` compares for the delta read
  // that decides which pages a client refetches, so a page edited into the past
  // is a page the delta never reports.
  assert.equal(written!.epoch, false, "the server owns updated_at on update");
});

test("A6: the RPC over the dropped E2EE table is gone", async () => {
  const db = await testDb();
  const [row] = await db.sql<{ n: number }>(
    "select count(*)::int as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'get_public_keys'",
  );
  // It read `user_keys`, which 0099 dropped, so the only thing calling it could
  // ever produce was `relation "user_keys" does not exist`.
  assert.equal(row!.n, 0);
  assert.equal(await db.sql("select 1 from information_schema.tables where table_name = 'user_keys'").then((r) => r.length), 0);
});

test("A7: the chunk archive has the index its policies filter on", async () => {
  const db = await testDb();
  const [row] = await db.sql<{ n: number }>(
    "select count(*)::int as n from pg_indexes where schemaname = 'public' and indexname = 'experiment_metric_chunks_user_id_idx'",
  );
  assert.equal(row!.n, 1, "the archive is the large half of the series; its RLS filter must be indexed");
});

test("B1: resolve_api_token refuses a relay-only token and still accepts an sdk one", async () => {
  const db = await testDb();
  const sdkOwner = await db.createUser();
  const relayOwner = await db.createUser();

  await db.sql(
    `insert into api_tokens (user_id, name, token_hash, token_prefix, scopes)
     values ($1, 'sdk', $2::bytea, 'tt_sdk', array['sdk'])`,
    [sdkOwner, tokenHash("a")],
  );
  await db.sql(
    `insert into api_tokens (user_id, name, token_hash, token_prefix, scopes)
     values ($1, 'relay', $2::bytea, 'tt_mcp', array['mcp_relay'])`,
    [relayOwner, tokenHash("b")],
  );

  const [sdk] = await db.sql<{ u: string | null }>("select public.resolve_api_token($1::bytea) as u", [tokenHash("a")]);
  assert.equal(sdk!.u, sdkOwner, "a legitimately-created SDK token must keep working");

  const [relay] = await db.sql<{ u: string | null }>("select public.resolve_api_token($1::bytea) as u", [tokenHash("b")]);
  // The whole finding: this token is minted with `expires_at: null` and handed
  // to third-party MCP software, and it used to unlock the SDK routes — which
  // includes `GET /api/settings/credentials`.
  assert.equal(relay!.u, null, "a relay-only token must not resolve as an SDK token");

  // The relay resolver is the other half and must keep accepting it.
  const [viaRelay] = await db.sql<{ u: string | null }>("select public.resolve_mcp_relay_token($1::bytea) as u", [tokenHash("b")]);
  assert.equal(viaRelay!.u, relayOwner);
  const [sdkViaRelay] = await db.sql<{ u: string | null }>("select public.resolve_mcp_relay_token($1::bytea) as u", [tokenHash("a")]);
  assert.equal(sdkViaRelay!.u, null, "an SDK token is not a relay token either");
});

test("B1: the scope lookup the application uses is service-role only", async () => {
  const db = await testDb();
  const [row] = await db.sql<{ anon: boolean; auth: boolean; svc: boolean }>(
    `select has_function_privilege('anon', 'public.api_token_scopes(bytea)', 'execute') as anon,
            has_function_privilege('authenticated', 'public.api_token_scopes(bytea)', 'execute') as auth,
            has_function_privilege('service_role', 'public.api_token_scopes(bytea)', 'execute') as svc`,
  );
  assert.equal(row!.anon, false);
  assert.equal(row!.auth, false, "a signed-in client must not be able to enumerate a token's scopes by hash");
  assert.equal(row!.svc, true);
});

test("B7: the access counter increments in the database", async () => {
  const db = await testDb();
  const owner = await db.createUser();
  const other = await db.createUser();
  const path = `${owner}/paper-1/fig.webp`;
  await db.as(owner).sql("insert into blob_objects (bucket, path) values ('paper-images', $1)", [path]);

  // Two increments, as two overlapping reads would have produced before — the
  // old read-modify-write lost one of them.
  await db.as(owner).sql("select public.record_blob_access('paper-images', $1)", [path]);
  await db.as(owner).sql("select public.record_blob_access('paper-images', $1)", [path]);
  // A shared viewer may mint a URL for this blob but must not touch its row;
  // the ownership predicate makes that a no-op rather than an error.
  await db.as(other).sql("select public.record_blob_access('paper-images', $1)", [path]);

  const [row] = await db.sql<{ access_count: number; last_accessed_at: string | null }>(
    "select access_count, last_accessed_at from blob_objects where path = $1",
    [path],
  );
  assert.equal(row!.access_count, 2, "both increments land, and a foreign caller's is ignored");
  assert.ok(row!.last_accessed_at, "last_accessed_at must be stamped alongside the count");

  // The batched form the signed-urls route uses does the same in one statement.
  await db.as(owner).sql("select public.record_blob_access_many('paper-images', array[$1])", [path]);
  const [after] = await db.sql<{ access_count: number }>(
    "select access_count from blob_objects where path = $1",
    [path],
  );
  assert.equal(after!.access_count, 3);
});

test("B8: creating a lab is all-or-nothing", async () => {
  const db = await testDb();
  // `createUser` inserts into `auth.users`, which fires `on_auth_user_created`,
  // so the profile rows the org RPCs require already exist — which is the order
  // a real signup produces.
  const owner = await db.createUser();

  const [created] = await db.sql<{ o: { id: string; owner_id: string } }>(
    "select public.create_organization_atomic($1, 'Lab', $2::jsonb) as o",
    [
      owner,
      JSON.stringify([
        { target_role: "professor", code_hash: "h1" },
        { target_role: "phd", code_hash: "h2" },
        { target_role: "masters", code_hash: "h3" },
      ]),
    ],
  );
  const orgId = created!.o.id;
  assert.equal(created!.o.owner_id, owner);

  // The three rows that used to be written by three separate PostgREST calls,
  // each with a failure window between them.
  const [membership] = await db.sql<{ role: string; joined_via: string }>(
    "select role, joined_via from org_memberships where org_id = $1 and user_id = $2",
    [orgId, owner],
  );
  assert.deepEqual(membership, { role: "professor", joined_via: "create" });
  const [profile] = await db.sql<{ role: string; active_org_id: string; org_setup_complete: boolean }>(
    "select role, active_org_id, org_setup_complete from profiles where user_id = $1",
    [owner],
  );
  assert.equal(profile!.role, "professor");
  assert.equal(profile!.active_org_id, orgId);
  assert.equal(profile!.org_setup_complete, true);
  const codes = await db.sql("select id from org_invite_codes where org_id = $1", [orgId]);
  assert.equal(codes.length, 3);

  // A failure part-way through must leave nothing behind. An invalid role fails
  // the `target_role` CHECK on the second insert — after the org row exists.
  const before = (await db.sql<{ n: number }>("select count(*)::int as n from organizations"))[0]!.n;
  await assert.rejects(
    () =>
      db.sql("select public.create_organization_atomic($1, 'Half', $2::jsonb)", [
        owner,
        JSON.stringify([
          { target_role: "professor", code_hash: "x1" },
          { target_role: "wizard", code_hash: "x2" },
        ]),
      ]),
    /target_role/,
  );
  const after = (await db.sql<{ n: number }>("select count(*)::int as n from organizations"))[0]!.n;
  assert.equal(after, before, "the org must roll back with the codes, not be left ownerless");
});

test("B11: joining a lab increments the code's use count atomically", async () => {
  const db = await testDb();
  const owner = await db.createUser();
  const joiner = await db.createUser();
  const [created] = await db.sql<{ o: { id: string } }>(
    "select public.create_organization_atomic($1, 'Lab', $2::jsonb) as o",
    [owner, JSON.stringify([{ target_role: "phd", code_hash: "c1" }])],
  );
  const orgId = created!.o.id;
  const [code] = await db.sql<{ id: string }>(
    "select id from org_invite_codes where org_id = $1 and target_role = 'phd'",
    [orgId],
  );

  await db.sql("select public.join_organization_atomic($1, $2, $3, 'phd', null)", [joiner, orgId, code!.id]);
  await db.sql("select public.join_organization_atomic($1, $2, $3, 'phd', null)", [joiner, orgId, code!.id]);

  const [row] = await db.sql<{ use_count: number }>(
    "select use_count from org_invite_codes where id = $1",
    [code!.id],
  );
  // The old code sent `use_count: current + 1` computed in JavaScript, so
  // concurrent redemptions both read N and both wrote N+1.
  assert.equal(row!.use_count, 2);

  const [profile] = await db.sql<{ role: string; active_org_id: string }>(
    "select role, active_org_id from profiles where user_id = $1",
    [joiner],
  );
  assert.deepEqual(profile, { role: "phd", active_org_id: orgId });

  // A revoked code cannot be redeemed, and the membership it would have granted
  // rolls back with the refusal.
  await db.sql("update org_invite_codes set revoked_at = now() where id = $1", [code!.id]);
  await assert.rejects(
    () => db.sql("select public.join_organization_atomic($1, $2, $3, 'masters', null)", [owner, orgId, code!.id]),
    /no longer valid/,
  );
  const [ownerMembership] = await db.sql<{ role: string }>(
    "select role from org_memberships where org_id = $1 and user_id = $2",
    [orgId, owner],
  );
  assert.equal(ownerMembership!.role, "professor", "the owner's membership is unchanged by the failed join");
});

test("B8: the org RPCs are service-role only", async () => {
  const db = await testDb();
  const [row] = await db.sql<{ create_anon: boolean; create_auth: boolean; join_anon: boolean; create_svc: boolean }>(
    `select has_function_privilege('anon', 'public.create_organization_atomic(uuid, text, jsonb)', 'execute') as create_anon,
            has_function_privilege('authenticated', 'public.create_organization_atomic(uuid, text, jsonb)', 'execute') as create_auth,
            has_function_privilege('anon', 'public.join_organization_atomic(uuid, uuid, uuid, text, uuid)', 'execute') as join_anon,
            has_function_privilege('service_role', 'public.create_organization_atomic(uuid, text, jsonb)', 'execute') as create_svc`,
  );
  // Both take the acting user id as a parameter, so a client that could reach
  // them could provision a lab as anyone.
  assert.equal(row!.create_anon, false);
  assert.equal(row!.create_auth, false);
  assert.equal(row!.join_anon, false);
  assert.equal(row!.create_svc, true);
});

/**
 * Split a migration file into the statements it can be replayed as.
 *
 * `TestDb.sql` goes through PGlite's `query()`, which is the extended protocol
 * and refuses more than one statement per call — so replaying a whole file needs
 * it broken up first.
 *
 * Three things a `;` can be that is *not* the end of a statement, and all three
 * occur in `0114`:
 *
 *   * inside a dollar-quoted body — the `raise exception '…; …'` in the
 *     conversion block, where a naive `split(";")` silently produces fragments
 *     that fail at the parser rather than at the assertion;
 *   * inside a `--` line comment — "…through a join on every row; the plan
 *     calls that a trade…", which splits a comment in half and leaves the
 *     remainder as bare SQL;
 *   * inside a `/* … *​/` block comment.
 *
 * So the scanner tracks all three. It is deliberately small and does not try to
 * understand string literals: every literal in this file that contains a `;` is
 * already inside a dollar-quoted body.
 */
function splitStatements(sql: string): string[] {
  const out: string[] = [];
  let current = "";
  let tag: string | null = null;
  let lineComment = false;
  let blockComment = false;
  for (let i = 0; i < sql.length; i++) {
    if (lineComment) {
      current += sql[i];
      if (sql[i] === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (sql.startsWith("*/", i)) {
        current += "*/";
        i += 1;
        blockComment = false;
        continue;
      }
      current += sql[i];
      continue;
    }
    if (tag) {
      if (sql.startsWith(tag, i)) {
        current += tag;
        i += tag.length - 1;
        tag = null;
        continue;
      }
      current += sql[i];
      continue;
    }
    const open = /^\$[A-Za-z_]*\$/.exec(sql.slice(i));
    if (open) {
      tag = open[0];
      current += tag;
      i += tag.length - 1;
      continue;
    }
    if (sql.startsWith("--", i)) {
      current += "--";
      i += 1;
      lineComment = true;
      continue;
    }
    if (sql.startsWith("/*", i)) {
      current += "/*";
      i += 1;
      blockComment = true;
      continue;
    }
    if (sql[i] === ";") {
      out.push(current);
      current = "";
      continue;
    }
    current += sql[i];
  }
  if (current.trim()) out.push(current);
  return out.map((s) => s.trim()).filter(Boolean);
}

test("A4: re-applying 0114 does not revert the chunk-aware view", async () => {
  const db = await testDb();
  const { readFileSync } = await import("node:fs");
  const path = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const migrations = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    // Seven levels: test -> infrastructure -> org -> features -> src -> web ->
    // apps -> repo root. (`backend/test/pg-test-db.ts` needs five, because it
    // sits three directories shallower.)
    "../../../../../../../supabase/migrations",
  );

  const before = await db.sql<{ d: string }>("select pg_get_viewdef('public.experiment_metrics'::regclass) as d");
  assert.match(before[0]!.d, /experiment_metric_chunks/, "0115's view is the one in place");

  // A genuine re-run, statement by statement.
  const source = readFileSync(path.join(migrations, "0114_experiment_metrics_narrow_rows.sql"), "utf8");
  for (const statement of splitStatements(source)) {
    await db.sql(statement);
  }

  const after = await db.sql<{ d: string }>("select pg_get_viewdef('public.experiment_metrics'::regclass) as d");
  // 0115 replaced the view with one that unions the archive and the row store.
  // Re-running 0114 used to `create or replace` it back to the row-only version
  // and re-point the INSTEAD OF triggers at the row-only functions, so every
  // archived point vanished from reads and updates silently stopped applying —
  // and re-running a file is routine after a failed deploy.
  assert.equal(after[0]!.d, before[0]!.d, "a re-run must not replace 0115's view");
  assert.match(after[0]!.d, /experiment_metric_chunks/, "the view must still read the archive");

  const [fn] = await db.sql<{ prosrc: string }>(
    "select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'experiment_metrics_update'",
  );
  assert.match(fn!.prosrc, /experiment_metric_point_remove/, "the 0115 update trigger must survive the re-run");
});
