import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { testDb } from "./pg-test-db";

/**
 * Deleting the auth user is the last step of deleting an account, after
 * `delete_user_account_data` has taken what it knows about. Anything still
 * pointing at the user must go with them, or that final delete fails and the
 * account survives.
 */
describe("deleting a user", () => {
  it("takes every row that references them, whatever table it is in", async () => {
    const db = await testDb();
    const user = await db.createUser();
    const as = db.as(user);
    // A paper with no project: nothing else would cascade it away.
    await as.sql("insert into papers (user_id, title) values ($1, $2)", [user, "orphan"]);
    await as.sql("insert into experiments (user_id, name) values ($1, $2)", [user, "run"]);
    const dangling = await db.sql<{ conname: string }>(
      `select conname from pg_constraint
        where contype = 'f' and confrelid = 'auth.users'::regclass and confdeltype <> 'c'`,
    );
    assert.deepEqual(dangling, []);
    await db.sql("delete from auth.users where id = $1", [user]);
    const left = await db.sql<{ n: string }>(
      "select count(*) as n from papers where user_id = $1",
      [user],
    );
    assert.equal(Number(left[0]!.n), 0);
  });
});
