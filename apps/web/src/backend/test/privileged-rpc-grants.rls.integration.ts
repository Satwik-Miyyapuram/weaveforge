import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { testDb, type TestDb } from "@/backend/test/pg-test-db";

/**
 * Who may call the privileged RPCs, before and after the self-hosted grants.
 *
 * `0141_privileged_rpc_grants.sql` takes EXECUTE away from `authenticated` and
 * `anon` on functions only the server should reach. On the OCI database that
 * is not the end of the story: `0026_self_host_grants.sql` grants EXECUTE on
 * every function in `public` to `authenticated`, and the deploy script replays
 * it with `--follow-ups-only`. `0030_self_host_privileged_rpc_grants.sql` runs
 * after it and takes the grants away again. This file replays both, in the
 * order the deploy script does, and checks the privileges after each step.
 *
 * It also checks the flows the revokes must not break: share links for anon
 * and signed-in callers, a shared recipient's read, metric names, and inserts
 * that draw from `sync_seq`.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");
const selfHosted = (name: string) =>
  readFileSync(path.join(ROOT, "db/migrations-self-hosted-postgres", name), "utf8");

/** Only `service_role` (the server's admin client) may call these. */
const SERVER_ONLY = [
  "delete_user_account_data(uuid)",
  "check_share_link_rate(text, integer, interval)",
  "shared_to_user(text, uuid, uuid)",
  "experiment_metrics_rollup(integer, integer)",
];

/** The app calls these through PostgREST, so they must stay open. */
const STILL_CALLABLE: [fn: string, roles: string[]][] = [
  ["resolve_share_link(bytea)", ["anon", "authenticated"]],
  ["redeem_share_link(bytea)", ["authenticated"]],
  ["experiment_metric_name_id(text)", ["authenticated"]],
];

/** Written only by definer functions, so `authenticated` needs no USAGE. */
const PRIVATE_SEQUENCES = ["experiment_metric_names_id_seq", "share_link_rate_limits_id_seq"];
/** `sync_stamp()` is an invoker trigger calling nextval('sync_seq'). */
const NEEDED_SEQUENCES = ["sync_seq", "crdt_updates_id_seq"];

const MISS_LIMIT_SIGNED_IN = 20;
const MISS_LIMIT_ANON = 200;

async function can(db: TestDb, role: string, fn: string): Promise<boolean> {
  const [row] = await db.sql<{ ok: boolean }>(
    "select has_function_privilege($1, $2, 'EXECUTE') as ok",
    [role, `public.${fn}`],
  );
  return row!.ok;
}

async function seqUsage(db: TestDb, seq: string): Promise<boolean> {
  const [row] = await db.sql<{ ok: boolean }>(
    "select has_sequence_privilege('authenticated', $1, 'USAGE') as ok",
    [`public.${seq}`],
  );
  return row!.ok;
}

async function assertGrants(db: TestDb, stage: string) {
  for (const fn of SERVER_ONLY) {
    assert.equal(await can(db, "authenticated", fn), false, `${stage}: authenticated can execute ${fn}`);
    assert.equal(await can(db, "anon", fn), false, `${stage}: anon can execute ${fn}`);
    assert.equal(await can(db, "service_role", fn), true, `${stage}: service_role lost ${fn}`);
  }
  for (const [fn, roles] of STILL_CALLABLE) {
    for (const role of roles) {
      assert.equal(await can(db, role, fn), true, `${stage}: ${role} lost ${fn}`);
    }
  }
  for (const seq of PRIVATE_SEQUENCES) {
    assert.equal(await seqUsage(db, seq), false, `${stage}: authenticated has USAGE on ${seq}`);
  }
  for (const seq of NEEDED_SEQUENCES) {
    assert.equal(await seqUsage(db, seq), true, `${stage}: authenticated lost USAGE on ${seq}`);
  }
}

const token = () => randomBytes(32);
/** PGlite takes bytea parameters as bytes, not as `\x…` text. */
const hex = (b: Buffer): Uint8Array => new Uint8Array(b);

async function shareLink(db: TestDb, owner: string) {
  const [list] = await db.as(owner).sql<{ id: string }>(
    "insert into reading_lists (user_id, name) values ($1, 'linked') returning id",
    [owner],
  );
  const raw = token();
  await db.as(owner).sql(
    "insert into share_links (owner_id, resource_type, resource_id, token_hash) values ($1, 'reading_list', $2, $3)",
    [owner, list!.id, hex(raw)],
  );
  return { listId: list!.id, tokenHash: hex(raw) };
}

const resolve = (who: Pick<TestDb, "sql">, tokenHash: Uint8Array) =>
  who.sql<{ resource_id: string }>("select * from resolve_share_link($1)", [tokenHash]);

describe("privileged RPC grants", () => {
  it("the base chain leaves the server-only functions to service_role", async () => {
    await assertGrants(await testDb(), "base chain");
  });

  it("replaying 0026 re-opens them, and 0030 closes them again", async () => {
    const db = await testDb();
    await db.exec(selfHosted("0026_self_host_grants.sql"));
    // Proves the follow-up is needed rather than belt and braces.
    assert.equal(await can(db, "authenticated", SERVER_ONLY[0]!), true, "0026 no longer re-grants; 0030 may be dead");

    await db.exec(selfHosted("0030_self_host_privileged_rpc_grants.sql"));
    await assertGrants(db, "after 0026 + 0030");

    // Replayed again, as `--follow-ups-only` does on every deploy.
    await db.exec(selfHosted("0026_self_host_grants.sql"));
    await db.exec(selfHosted("0030_self_host_privileged_rpc_grants.sql"));
    await assertGrants(db, "after a second replay");
  });

  it("refuses the server-only functions to a signed-in caller", async () => {
    const db = await testDb();
    const user = await db.createUser();
    await assert.rejects(
      db.as(user).sql("select delete_user_account_data($1)", [user]),
      /permission denied/,
    );
    await assert.rejects(
      db.as(user).sql("select check_share_link_rate('x', 1, interval '1 hour')"),
      /permission denied/,
    );
    await assert.rejects(
      db.as(user).sql("select shared_to_user('reading_list', gen_random_uuid(), $1)", [user]),
      /permission denied/,
    );
    await assert.rejects(db.as(user).sql("select experiment_metrics_rollup(1, 1)"), /permission denied/);
    await assert.rejects(db.anon.sql("select experiment_metrics_rollup(1, 1)"), /permission denied/);
  });

  it("a valid share link resolves for anon and for a signed-in caller, and redeems", async () => {
    const db = await testDb();
    const owner = await db.createUser();
    const reader = await db.createUser();
    const { listId, tokenHash } = await shareLink(db, owner);

    assert.equal((await resolve(db.anon, tokenHash))[0]?.resource_id, listId);
    assert.equal((await resolve(db.as(reader), tokenHash))[0]?.resource_id, listId);
    assert.deepEqual(await resolve(db.anon, hex(token())), [], "an unknown token resolves to nothing");

    const [redeemed] = await db.as(reader).sql<{ r: { resourceId: string } }>(
      "select redeem_share_link($1) as r",
      [tokenHash],
    );
    assert.equal(redeemed!.r.resourceId, listId);
  });

  it("guessing tokens trips the caller's limit; a valid token still resolves", async () => {
    const db = await testDb();
    const owner = await db.createUser();
    const guesser = await db.createUser();
    const bystander = await db.createUser();
    const { listId, tokenHash } = await shareLink(db, owner);

    for (let i = 0; i < MISS_LIMIT_SIGNED_IN; i++) {
      assert.deepEqual(await resolve(db.as(guesser), hex(token())), []);
    }
    await assert.rejects(resolve(db.as(guesser), hex(token())), /Rate limit exceeded/);

    // The limit is per caller and counts misses only.
    assert.equal((await resolve(db.as(guesser), tokenHash))[0]?.resource_id, listId);
    assert.deepEqual(await resolve(db.as(bystander), hex(token())), []);
  });

  it("anonymous guessing is capped, and does not block a valid link", async () => {
    const db = await testDb();
    const owner = await db.createUser();
    const { listId, tokenHash } = await shareLink(db, owner);
    // The database is shared by this file's tests; start from an empty bucket.
    await db.sql("delete from share_link_rate_limits where bucket = 'resolve-miss:anon'");

    for (let i = 0; i < MISS_LIMIT_ANON; i++) await resolve(db.anon, hex(token()));
    await assert.rejects(resolve(db.anon, hex(token())), /Rate limit exceeded/);

    assert.equal((await resolve(db.anon, tokenHash))[0]?.resource_id, listId);
    // Signed-in callers have their own buckets.
    const user = await db.createUser();
    assert.deepEqual(await resolve(db.as(user), hex(token())), []);

    // A refused attempt is not stored, so the table stays bounded by the caps.
    const [{ n }] = (await db.sql<{ n: number }>(
      "select count(*)::int as n from share_link_rate_limits where bucket = 'resolve-miss:anon'",
    )) as [{ n: number }];
    assert.equal(n, MISS_LIMIT_ANON);
  });

  it("a shared recipient still reads the shared row", async () => {
    const db = await testDb();
    const owner = await db.createUser();
    const recipient = await db.createUser();
    const stranger = await db.createUser();
    const [list] = await db.as(owner).sql<{ id: string }>(
      "insert into reading_lists (user_id, name) values ($1, 'shared') returning id",
      [owner],
    );
    await db.as(owner).sql(
      "insert into shares (owner_id, recipient_id, resource_type, resource_id) values ($1, $2, 'reading_list', $3)",
      [owner, recipient, list!.id],
    );

    const read = (who: string) =>
      db.as(who).sql<{ id: string }>("select id from reading_lists where id = $1", [list!.id]);
    assert.equal((await read(recipient)).length, 1);
    assert.equal((await read(stranger)).length, 0);

    // The server's own check, which blob-access.ts makes through service_role.
    const [viaServer] = await db.sql<{ ok: boolean }>(
      "select shared_to_user('reading_list', $1, $2) as ok",
      [list!.id, recipient],
    );
    assert.equal(viaServer!.ok, true);
  });

  it("caps new metric names, but resolves names already stored", async () => {
    const db = await testDb();
    const user = await db.createUser();
    const name = (n: number) => db.as(user).sql<{ id: number }>("select experiment_metric_name_id($1) as id", ["m".repeat(n)]);

    const [first] = await name(256);
    const [again] = await name(256);
    assert.equal(first!.id, again!.id, "the longest allowed name is created once");
    await assert.rejects(name(257), /metric name is too long/);
    await assert.rejects(name(10_000), /metric name is too long/);

    // A name that predates the cap keeps working.
    const legacy = "x".repeat(300);
    await db.sql("insert into experiment_metric_names (name) values ($1)", [legacy]);
    const [old] = await db.as(user).sql<{ id: number }>("select experiment_metric_name_id($1) as id", [legacy]);
    assert.ok(old!.id > 0);

    await assert.rejects(db.as(user).sql("select experiment_metric_name_id(null)"), /metric name is required/);
  });

  it("a signed-in insert that draws from sync_seq still works", async () => {
    const db = await testDb();
    const user = await db.createUser();
    const [row] = await db.as(user).sql<{ id: string }>(
      "insert into reading_lists (user_id, name) values ($1, 'stamped') returning id",
      [user],
    );
    assert.ok(row!.id);
    await assert.rejects(
      db.as(user).sql("select nextval('experiment_metric_names_id_seq')"),
      /permission denied/,
    );
  });
  // Last: it undoes what the tests above rely on.
  it("the rollback restores the old grants and the per-token limit", async () => {
    const db = await testDb();
    await db.exec(readFileSync(path.join(ROOT, "db/migrations-rollback/0141_privileged_rpc_grants.sql"), "utf8"));
    for (const fn of SERVER_ONLY) {
      assert.equal(await can(db, "authenticated", fn), true, `rollback left ${fn} revoked`);
    }
    assert.equal(await seqUsage(db, PRIVATE_SEQUENCES[0]!), true);

    const user = await db.createUser();
    for (let i = 0; i < MISS_LIMIT_SIGNED_IN + 5; i++) {
      assert.deepEqual(await resolve(db.as(user), hex(token())), [], "misses are no longer limited per caller");
    }
    const [row] = await db.as(user).sql<{ id: number }>(
      "select experiment_metric_name_id($1) as id",
      ["z".repeat(400)],
    );
    assert.ok(row!.id > 0, "the length cap is gone");
  });
});
