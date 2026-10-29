import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { testDb } from "@/backend/test/pg-test-db";

/**
 * 39-06: `0085` re-added `OR app_role(...) = 'admin'` to the two org read
 * policies after `0062` had removed the admin role. No role can be `admin`
 * (the profiles role check forbids it), so the branch is dead code that costs a
 * function call per row. Dropping it must leave member access as it was.
 *
 * 40-10: `resolve_api_token` wrote `last_used_at` on every SDK request, a row
 * write per call on the hot path. It now writes only when the value is unset or
 * more than an hour old.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");
const sqlFile = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

async function policySource(table: string, name: string): Promise<string> {
  const db = await testDb();
  const [row] = await db.sql<{ q: string }>(
    "select qual as q from pg_policies where schemaname = 'public' and tablename = $1 and policyname = $2",
    [table, name],
  );
  return row!.q;
}

async function lab() {
  const db = await testDb();
  const owner = await db.createUser();
  const member = await db.createUser();
  const outsider = await db.createUser();
  const [org] = await db.sql<{ id: string }>(
    "insert into organizations (name, owner_id) values ('lab', $1) returning id",
    [owner],
  );
  await db.sql(
    "insert into org_memberships (org_id, user_id, role, supervisor_id) values ($1, $2, 'professor', null), ($1, $3, 'phd', $2)",
    [org!.id, owner, member],
  );
  return { org: org!.id, owner, member, outsider };
}

async function count(userId: string, query: string, params: unknown[]): Promise<number> {
  const db = await testDb();
  const [row] = await db.as(userId).sql<{ n: number }>(query, params);
  return row!.n;
}

describe("org read policies without the admin branch (39-06)", () => {
  it("no longer mention the removed admin role", async () => {
    for (const [table, name] of [
      ["org_memberships", "org_memberships_select_lab"],
      ["organizations", "organizations_select_member"],
    ] as const) {
      assert.doesNotMatch(await policySource(table, name), /admin/, `${name} still checks for admin`);
    }
  });

  it("still let members and the supervisor read the org and its memberships", async () => {
    const { org, owner, member } = await lab();
    for (const user of [owner, member]) {
      assert.equal(await count(user, "select count(*)::int as n from organizations where id = $1", [org]), 1);
      assert.equal(await count(user, "select count(*)::int as n from org_memberships where org_id = $1", [org]), 2);
    }
  });

  it("still hide the org from a user outside it", async () => {
    const { org, outsider } = await lab();
    assert.equal(await count(outsider, "select count(*)::int as n from organizations where id = $1", [org]), 0);
    assert.equal(await count(outsider, "select count(*)::int as n from org_memberships where org_id = $1", [org]), 0);
  });
});

const tokenHash = (seed: string) => new Uint8Array(32).fill(seed.charCodeAt(0));

async function sdkToken(seed: string, extra = "") {
  const db = await testDb();
  const owner = await db.createUser();
  const [row] = await db.sql<{ id: string }>(
    `insert into api_tokens (user_id, name, token_hash, token_prefix, scopes${extra ? ", expires_at" : ""})
     values ($1, 'sdk', $2::bytea, 'tt_sdk', array['sdk']${extra ? `, ${extra}` : ""}) returning id`,
    [owner, tokenHash(seed)],
  );
  return { id: row!.id, owner };
}

async function resolve(seed: string): Promise<string | null> {
  const db = await testDb();
  const [row] = await db.sql<{ u: string | null }>("select public.resolve_api_token($1::bytea) as u", [tokenHash(seed)]);
  return row!.u;
}

async function lastUsed(id: string): Promise<string | null> {
  const db = await testDb();
  const [row] = await db.sql<{ t: string | null }>("select last_used_at::text as t from api_tokens where id = $1", [id]);
  return row!.t;
}

describe("resolve_api_token touches last_used_at at most hourly (40-10)", () => {
  it("sets it on the first use", async () => {
    const { id, owner } = await sdkToken("p");
    assert.equal(await lastUsed(id), null);
    assert.equal(await resolve("p"), owner);
    assert.notEqual(await lastUsed(id), null);
  });

  it("leaves a recent value alone on the next call", async () => {
    const { id, owner } = await sdkToken("q");
    const db = await testDb();
    await db.sql("update api_tokens set last_used_at = now() - interval '10 minutes' where id = $1", [id]);
    const before = await lastUsed(id);
    assert.equal(await resolve("q"), owner);
    assert.equal(await lastUsed(id), before, "a call within the hour must not write the row");
  });

  it("refreshes a value older than an hour", async () => {
    const { id, owner } = await sdkToken("r");
    const db = await testDb();
    await db.sql("update api_tokens set last_used_at = now() - interval '2 hours' where id = $1", [id]);
    const before = await lastUsed(id);
    assert.equal(await resolve("r"), owner);
    assert.notEqual(await lastUsed(id), before);
  });

  it("still refuses an expired token and does not touch it", async () => {
    const { id } = await sdkToken("s", "now() - interval '1 minute'");
    assert.equal(await resolve("s"), null);
    assert.equal(await lastUsed(id), null);
  });
});

describe("0148 and 0149 rollbacks", () => {
  it("restore the old shapes, and the migrations apply again on top", async () => {
    const db = await testDb();
    await db.exec(sqlFile("db/migrations-rollback/0148_org_policies_drop_admin.sql"));
    await db.exec(sqlFile("db/migrations-rollback/0149_api_token_touch_hourly.sql"));
    assert.match(await policySource("organizations", "organizations_select_member"), /admin/);
    const { id, owner } = await sdkToken("t");
    await db.sql("update api_tokens set last_used_at = now() - interval '10 minutes' where id = $1", [id]);
    const before = await lastUsed(id);
    assert.equal(await resolve("t"), owner);
    assert.notEqual(await lastUsed(id), before, "the rolled-back resolver writes on every call");

    await db.exec(sqlFile("db/migrations/0148_org_policies_drop_admin.sql"));
    await db.exec(sqlFile("db/migrations/0149_api_token_touch_hourly.sql"));
    assert.doesNotMatch(await policySource("organizations", "organizations_select_member"), /admin/);
    const after = await lastUsed(id);
    assert.equal(await resolve("t"), owner);
    assert.equal(await lastUsed(id), after);
  });
});
