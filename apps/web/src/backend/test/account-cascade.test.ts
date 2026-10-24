import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { testDb, type TestDb } from "./pg-test-db";

/**
 * Deleting the auth user is the last step of deleting an account, after
 * `delete_user_account_data` has taken what it knows about. Anything the user
 * owns must go with them, or that final delete fails and the account survives.
 *
 * A few columns only point at a user who is somebody else's: a student's
 * supervisor, the author of an edit in another user's shared document. Those
 * are unlinked (set null), not deleted, so one account's deletion does not
 * take other people's rows with it. Review row 40-01.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");
const sqlFile = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

/** Columns that refer to another person rather than to the row's owner. */
const UNLINKED = ["crdt_updates.author_id", "org_memberships.supervisor_id", "profiles.supervisor_id"];

async function authUserForeignKeys(db: TestDb) {
  return db.sql<{ col: string; action: string }>(
    `select con.conrelid::regclass::text || '.' || att.attname as col, con.confdeltype::text as action
       from pg_constraint con
       join pg_attribute att on att.attrelid = con.conrelid and att.attnum = any (con.conkey)
      where con.contype = 'f' and con.confrelid = 'auth.users'::regclass
      order by 1`,
  );
}

/** A lab: `supervisor` owns it, `student` is a member supervised by them. */
async function lab(db: TestDb) {
  const owner = await db.createUser();
  const supervisor = await db.createUser();
  const student = await db.createUser();
  const [org] = await db.sql<{ id: string }>(
    "insert into organizations (name, owner_id) values ('lab', $1) returning id",
    [owner],
  );
  // A trigger on auth.users already made the profile.
  await db.sql("update profiles set role = 'phd', supervisor_id = $2 where user_id = $1", [student, supervisor]);
  await db.sql(
    "insert into org_memberships (org_id, user_id, role, supervisor_id) values ($1, $2, 'phd', $3)",
    [org!.id, student, supervisor],
  );
  return { owner, supervisor, student, orgId: org!.id };
}

/** A report section of `owner`'s, edited by `editor` (a CRDT op) and commented on. */
async function sharedDocument(db: TestDb) {
  const owner = await db.createUser();
  const editor = await db.createUser();
  const [project] = await db.sql<{ id: string }>(
    "insert into projects (user_id, name) values ($1, 'shared') returning id",
    [owner],
  );
  const [section] = await db.sql<{ id: string }>(
    "insert into report_sections (user_id, project_id, title) values ($1, $2, 'intro') returning id",
    [owner, project!.id],
  );
  const [op] = await db.sql<{ id: string }>(
    `insert into crdt_updates (resource_type, resource_id, project_id, payload, author_id)
     values ('report_section', $1, $2, '\\x01', $3) returning id`,
    [section!.id, project!.id, editor],
  );
  await db.sql(
    "insert into comments (resource_type, resource_id, author_id, body) values ('report_section', $1, $2, 'nice')",
    [section!.id, editor],
  );
  return { owner, editor, sectionId: section!.id, projectId: project!.id, opId: op!.id };
}

describe("deleting a user", () => {
  it("takes every row they own, whatever table it is in", async () => {
    const db = await testDb();
    const user = await db.createUser();
    const as = db.as(user);
    // A paper with no project: nothing else would cascade it away.
    await as.sql("insert into papers (user_id, title) values ($1, $2)", [user, "orphan"]);
    await as.sql("insert into experiments (user_id, name) values ($1, $2)", [user, "run"]);
    await db.sql("delete from auth.users where id = $1", [user]);
    const left = await db.sql<{ n: string }>("select count(*) as n from papers where user_id = $1", [user]);
    assert.equal(Number(left[0]!.n), 0);
  });

  it("cascades every reference to a user except the ones naming somebody else's row", async () => {
    const db = await testDb();
    const fks = await authUserForeignKeys(db);
    const unlinked = fks.filter((fk) => fk.action === "n").map((fk) => fk.col);
    const other = fks.filter((fk) => fk.action !== "c" && fk.action !== "n");
    assert.deepEqual(unlinked, UNLINKED);
    assert.deepEqual(other, [], "no plain foreign key blocks the final delete");
  });

  it("keeps a supervisor's students and their lab membership, unlinked", async () => {
    const db = await testDb();
    const { supervisor, student, orgId } = await lab(db);
    await db.sql("delete from auth.users where id = $1", [supervisor]);

    const [profile] = await db.sql<{ supervisor_id: string | null }>(
      "select supervisor_id from profiles where user_id = $1",
      [student],
    );
    assert.ok(profile, "the student's profile survives");
    assert.equal(profile.supervisor_id, null);
    const [member] = await db.sql<{ supervisor_id: string | null }>(
      "select supervisor_id from org_memberships where org_id = $1 and user_id = $2",
      [orgId, student],
    );
    assert.ok(member, "the student stays in the lab");
    assert.equal(member.supervisor_id, null);
  });

  it("still removes the student's own rows when the student goes", async () => {
    const db = await testDb();
    const { student, orgId } = await lab(db);
    await db.sql("delete from auth.users where id = $1", [student]);
    assert.deepEqual(await db.sql("select 1 from profiles where user_id = $1", [student]), []);
    assert.deepEqual(
      await db.sql("select 1 from org_memberships where org_id = $1 and user_id = $2", [orgId, student]),
      [],
    );
  });

  it("keeps a collaborator's edits in a shared document, and drops their comments", async () => {
    const db = await testDb();
    const { editor, opId, sectionId } = await sharedDocument(db);
    await db.sql("delete from auth.users where id = $1", [editor]);

    const [op] = await db.sql<{ author_id: string | null }>("select author_id from crdt_updates where id = $1", [opId]);
    assert.ok(op, "the document keeps the edit");
    assert.equal(op.author_id, null);
    assert.deepEqual(await db.sql("select 1 from comments where resource_id = $1", [sectionId]), []);
  });

  it("drops the document's edits with the owner's project", async () => {
    const db = await testDb();
    const { owner, opId } = await sharedDocument(db);
    await db.sql("delete from auth.users where id = $1", [owner]);
    assert.deepEqual(await db.sql("select 1 from crdt_updates where id = $1", [opId]), []);
  });

  it("refuses a new edit with no author", async () => {
    const db = await testDb();
    const { owner, sectionId, projectId } = await sharedDocument(db);
    await assert.rejects(
      db.as(owner).sql(
        `insert into crdt_updates (resource_type, resource_id, project_id, payload, author_id)
         values ('report_section', $1, $2, '\\x02', null)`,
        [sectionId, projectId],
      ),
      /row-level security/i,
    );
  });
});

// Last: it swaps the constraints of the shared test database, then puts 0143 back.
describe("0143 rollback", () => {
  it("restores cascade, keeps unlinked rows, and 0143 re-applies cleanly", async () => {
    const db = await testDb();
    const { editor, opId } = await sharedDocument(db);
    await db.sql("delete from auth.users where id = $1", [editor]);

    await db.exec(sqlFile("db/migrations-rollback/0143_unlink_not_cascade.sql"));
    const rolledBack = await authUserForeignKeys(db);
    assert.deepEqual(rolledBack.filter((fk) => fk.action !== "c"), []);
    assert.equal((await db.sql("select 1 from crdt_updates where id = $1", [opId])).length, 1, "rollback loses no rows");

    await db.exec(sqlFile("db/migrations/0143_unlink_not_cascade.sql"));
    const reapplied = await authUserForeignKeys(db);
    assert.deepEqual(reapplied.filter((fk) => fk.action === "n").map((fk) => fk.col), UNLINKED);
  });
});
