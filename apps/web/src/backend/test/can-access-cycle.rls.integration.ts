import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { testDb } from "@/backend/test/pg-test-db";

/**
 * `can_access` walks the supervisor tree down from the caller. Nothing stops
 * `profiles.supervisor_id` from forming a loop (A supervises B, B supervises
 * A), and with `union all` the recursive CTE never stops on one: every RLS
 * check that reaches it hangs the query (39-05). `union` drops rows it has
 * already seen, so the walk ends after one lap.
 */

/** Profiles for fresh users, with the supervisor links set as given. */
async function users(n: number) {
  const db = await testDb();
  const ids: string[] = [];
  for (let i = 0; i < n; i += 1) ids.push(await db.createUser());
  for (const id of ids) {
    await db.sql("insert into profiles (user_id) values ($1) on conflict (user_id) do nothing", [id]);
  }
  return ids;
}

async function supervise(supervisor: string, member: string) {
  const db = await testDb();
  await db.sql("update profiles set supervisor_id = $1 where user_id = $2", [supervisor, member]);
}

async function canAccess(caller: string, owner: string): Promise<boolean> {
  const db = await testDb();
  // PGlite runs on this thread and ignores statement_timeout, so a looping
  // walk would hang the file. Refuse to call the old shape at all.
  const [fn] = await db.sql<{ src: string }>("select prosrc as src from pg_proc where proname = 'can_access'");
  assert.doesNotMatch(fn!.src, /union\s+all/i, "can_access must not walk the tree with union all");
  const [row] = await db.as(caller).sql<{ ok: boolean }>("select can_access($1::uuid) as ok", [owner]);
  return row!.ok;
}

describe("can_access on a supervisor loop (39-05)", () => {
  it("ends on a two-person loop and still sees the other member", async () => {
    const [a, b] = await users(2);
    await supervise(a!, b!);
    await supervise(b!, a!);
    assert.equal(await canAccess(a!, b!), true);
    assert.equal(await canAccess(b!, a!), true);
  });

  it("ends on a self loop and denies an outsider", async () => {
    const [a, outsider] = await users(2);
    await supervise(a!, a!);
    assert.equal(await canAccess(a!, outsider!), false);
    assert.equal(await canAccess(a!, a!), true);
  });

  it("keeps the plain tree rules beside a loop", async () => {
    const [top, mid, low, x, y] = await users(5);
    await supervise(top!, mid!);
    await supervise(mid!, low!);
    await supervise(x!, y!);
    await supervise(y!, x!);
    assert.equal(await canAccess(top!, low!), true);
    assert.equal(await canAccess(mid!, low!), true);
    assert.equal(await canAccess(low!, top!), false);
    assert.equal(await canAccess(top!, x!), false);
    assert.equal(await canAccess(x!, top!), false);
  });

  it("denies a null owner", async () => {
    const [a] = await users(1);
    const db = await testDb();
    const [row] = await db.as(a!).sql<{ ok: boolean }>("select can_access(null) as ok");
    assert.equal(row!.ok, false);
  });
});
