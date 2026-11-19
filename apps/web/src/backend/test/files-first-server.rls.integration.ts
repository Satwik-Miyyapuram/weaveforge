import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { testDb } from "@/backend/test/pg-test-db";

/**
 * `0161_files_first_server.sql`: grants, shared_docs and sdk_inbox.
 *
 * The test database grants every table to `authenticated` by default, as the
 * OCI database does (`0026_self_host_grants.sql`, which a follow-up replay runs
 * again). So row-level security, not the migration's own grants, is what keeps
 * a signed-in user out, and these checks are written against that: the
 * migration replays cleanly, and a signed-in user can change only its own rows.
 * An update or delete that RLS filters changes nothing rather than failing.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");
const MIGRATION = readFileSync(
  path.join(ROOT, "db/migrations/0161_files_first_server.sql"),
  "utf8",
);

async function denied(run: () => Promise<unknown>): Promise<void> {
  await assert.rejects(run, /permission denied|row-level security/i);
}

describe("0161 files-first server", () => {
  it("replays twice without error and keeps rows", async () => {
    const db = await testDb();
    const owner = await db.createUser();
    await db.sql(
      "insert into shared_docs (item_id, owner, kind) values ('replay-doc', $1, 'note')",
      [owner],
    );
    await db.exec(MIGRATION);
    await db.exec(MIGRATION);
    const rows = await db.sql("select item_id from shared_docs where item_id = 'replay-doc'");
    assert.equal(rows.length, 1);
  });

  it("gives a grantee read access through an item grant, and nobody else", async () => {
    const db = await testDb();
    const owner = await db.createUser();
    const grantee = await db.createUser();
    const stranger = await db.createUser();
    await db.sql(
      "insert into shared_docs (item_id, owner, kind) values ('granted-doc', $1, 'canvas')",
      [owner],
    );
    await db
      .as(owner)
      .sql(
        "insert into grants (scope, target_id, grantee_user, permission) values ('item', 'granted-doc', $1, 'edit')",
        [grantee],
      );
    const seen = await db.as(grantee).sql("select item_id from shared_docs where item_id = 'granted-doc'");
    assert.equal(seen.length, 1);
    const hidden = await db.as(stranger).sql("select item_id from shared_docs where item_id = 'granted-doc'");
    assert.equal(hidden.length, 0);
    const level = await db
      .as(grantee)
      .sql<{ level: string }>("select shared_doc_access('granted-doc', $1) as level", [grantee]);
    assert.equal(level[0]?.level, "edit");
  });

  it("does not let a signed-in user write shared_docs, even its own row", async () => {
    const db = await testDb();
    const owner = await db.createUser();
    await db.sql(
      "insert into shared_docs (item_id, owner, kind) values ('owned-doc', $1, 'note')",
      [owner],
    );
    const me = db.as(owner);
    await denied(() =>
      me.sql("insert into shared_docs (item_id, owner, kind) values ('mine-2', $1, 'note')", [owner]),
    );
    await me.sql("update shared_docs set epoch = 9 where item_id = 'owned-doc'");
    await me.sql("delete from shared_docs where item_id = 'owned-doc'");
    const after = await db.sql<{ epoch: string }>(
      "select epoch::text as epoch from shared_docs where item_id = 'owned-doc'",
    );
    assert.deepEqual(after, [{ epoch: "1" }]);
  });

  it("gives no access through a grant written by someone who does not own the doc", async () => {
    const db = await testDb();
    const owner = await db.createUser();
    const other = await db.createUser();
    await db.sql(
      "insert into shared_docs (item_id, owner, kind) values ('not-yours', $1, 'note')",
      [owner],
    );
    await db
      .as(other)
      .sql(
        "insert into grants (scope, target_id, grantee_user, permission) values ('item', 'not-yours', $1, 'edit')",
        [other],
      );
    const seen = await db.as(other).sql("select item_id from shared_docs where item_id = 'not-yours'");
    assert.equal(seen.length, 0);
    await denied(() =>
      db
        .as(other)
        .sql(
          "insert into grants (owner, scope, target_id, grantee_user, permission) values ($1, 'item', 'not-yours', $2, 'edit')",
          [owner, other],
        ),
    );
  });

  it("keeps each user's SDK inbox rows to that user", async () => {
    const db = await testDb();
    const user = await db.createUser();
    const other = await db.createUser();
    await db.as(user).sql("insert into sdk_inbox (kind, payload) values ('metrics', '{\"loss\": 1}'::jsonb)");
    const claimed = await db
      .as(user)
      .sql<{ claimed_by: string }>("select claimed_by from sdk_inbox_claim(0, 'device-a', 10)");
    assert.deepEqual(claimed, [{ claimed_by: "device-a" }]);
    const stolen = await db.as(other).sql("select id from sdk_inbox_claim(0, 'device-b', 10)");
    assert.equal(stolen.length, 0);
    await denied(() =>
      db
        .as(other)
        .sql("insert into sdk_inbox (user_id, kind, payload) values ($1, 'metrics', '{}'::jsonb)", [user]),
    );
  });

  it("keeps restore and revoke RPCs for the server only", async () => {
    const db = await testDb();
    const user = await db.createUser();
    await denied(() => db.as(user).sql("select shared_doc_restore('x', 'note', ''::bytea)"));
    await denied(() => db.as(user).sql("select revoke_grant(gen_random_uuid(), $1)", [user]));
  });
});
