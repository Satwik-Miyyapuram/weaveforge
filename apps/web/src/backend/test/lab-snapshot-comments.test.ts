import assert from "node:assert/strict";
import test from "node:test";

import { testDb, type TestDb } from "./pg-test-db";

/**
 * A sent check-in (a lab snapshot) could not be commented on: comments only
 * knew milestones, papers, notes and the like, so the supervisor read it and
 * had nowhere to answer (design D-23, D24, migration 0153). The student and
 * their supervisor may comment; nobody else may read or write.
 */

async function checkIn(db: TestDb) {
  const supervisor = await db.createUser();
  const student = await db.createUser();
  const stranger = await db.createUser();
  await db.sql("update profiles set role = 'phd', supervisor_id = $2 where user_id = $1", [student, supervisor]);
  const [project] = await db.sql<{ id: string }>(
    "insert into projects (user_id, name) values ($1, 'thesis') returning id",
    [student],
  );
  const [snap] = await db.as(student).sql<{ id: string }>(
    `insert into lab_snapshots (project_id, title, content)
     values ($1, 'Week 3', '{"milestones":[],"logs":[]}') returning id`,
    [project!.id],
  );
  return { supervisor, student, stranger, snapId: snap!.id };
}

const comment = (db: TestDb, as: string, id: string, body: string) =>
  db.as(as).sql("insert into comments (resource_type, resource_id, body) values ('lab_snapshot', $1, $2)", [id, body]);

const read = (db: TestDb, as: string, id: string) =>
  db.as(as).sql<{ body: string }>(
    "select body from comments where resource_type = 'lab_snapshot' and resource_id = $1 order by created_at",
    [id],
  );

test("the supervisor comments on a check-in and the student sees it", async () => {
  const db = await testDb();
  const { supervisor, student, snapId } = await checkIn(db);
  await comment(db, supervisor, snapId, "Good progress on the baseline");
  await comment(db, student, snapId, "Thanks, next week the ablation");
  assert.deepEqual((await read(db, student, snapId)).map((r) => r.body), [
    "Good progress on the baseline",
    "Thanks, next week the ablation",
  ]);
  assert.equal((await read(db, supervisor, snapId)).length, 2);
});

test("someone outside the lab can neither read nor comment", async () => {
  const db = await testDb();
  const { supervisor, stranger, snapId } = await checkIn(db);
  await comment(db, supervisor, snapId, "private");
  assert.deepEqual(await read(db, stranger, snapId), []);
  await assert.rejects(comment(db, stranger, snapId, "hi"), /row-level security/);
});

test("other comment targets keep their owner", async () => {
  const db = await testDb();
  const owner = await db.createUser();
  const [page] = await db.as(owner).sql<{ id: string }>(
    "insert into vault_pages (user_id, title, body) values ($1, 'n', 'b') returning id",
    [owner],
  );
  const [owned] = await db.sql<{ o: string }>("select resource_owner('vault_page', $1) as o", [page!.id]);
  assert.equal(owned!.o, owner);
  const [missing] = await db.sql<{ o: string | null }>("select resource_owner('nope', gen_random_uuid()) as o");
  assert.equal(missing!.o, null);
});
