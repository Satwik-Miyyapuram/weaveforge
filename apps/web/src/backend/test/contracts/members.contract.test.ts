// contract-repos: members
import assert from "node:assert/strict";
import test from "node:test";
import { memberRepository } from "@/features/org/infrastructure/postgrest-member-repository";
import { testDb } from "../pg-test-db";
import { clientFor, sessionFor, type Db } from "./harness";

/**
 * The `IMemberRepository` contract, end to end: Rust plans the `members` queries,
 * the TS sender runs them against PGlite with the real migrations and RLS. Ported
 * from the deleted `member-repository-contract.ts` suite.
 *
 * Each test builds its own lab (professor, PhD, master's student) because the
 * database is shared by the whole process. Profiles are set directly as the
 * owner, the way `lab-snapshot-comments.test.ts` does.
 */

async function seedLab(db: Db) {
  const prof = await db.createUser();
  const phd = await db.createUser();
  const masters = await db.createUser();
  await db.sql("update profiles set role = 'professor' where user_id = $1", [prof]);
  await db.sql("update profiles set role = 'phd', supervisor_id = $2 where user_id = $1", [phd, prof]);
  await db.sql("update profiles set role = 'masters', supervisor_id = $2 where user_id = $1", [masters, phd]);
  // The team and lab views only widen for an explicit membership (invite or create), not a legacy backfill.
  const [org] = await db.sql<{ id: string }>(
    "insert into organizations (name, owner_id) values ('Lab', $1) returning id",
    [prof],
  );
  const orgId = org!.id;
  await db.sql(
    "insert into org_memberships (org_id, user_id, role, supervisor_id, joined_via) values ($1, $2, 'professor', null, 'create')",
    [orgId, prof],
  );
  await db.sql(
    "insert into org_memberships (org_id, user_id, role, supervisor_id, joined_via) values ($1, $2, 'phd', $3, 'invite')",
    [orgId, phd, prof],
  );
  await db.sql(
    "insert into org_memberships (org_id, user_id, role, supervisor_id, joined_via) values ($1, $2, 'masters', $3, 'invite')",
    [orgId, masters, phd],
  );
  for (const user of [prof, phd, masters]) {
    await db.sql("update profiles set active_org_id = $2 where user_id = $1", [user, orgId]);
  }
  return { prof, phd, masters };
}

test("getMine returns the signed-in member", async () => {
  const db = await testDb();
  const { phd } = await seedLab(db);
  const repo = memberRepository(clientFor(db, phd), sessionFor(phd));
  const mine = await repo.getMine();
  assert.ok(mine);
  assert.equal(mine.id, phd);
});

test("listTeam includes supervisees transitively", async () => {
  const db = await testDb();
  const { prof, phd, masters } = await seedLab(db);
  const repo = memberRepository(clientFor(db, prof), sessionFor(prof));
  const ids = new Set((await repo.listTeam()).map((m) => m.id));
  assert.ok(ids.has(prof));
  assert.ok(ids.has(phd));
  assert.ok(ids.has(masters));
});

test("listDirectory includes the whole lab", async () => {
  const db = await testDb();
  const { prof, phd, masters } = await seedLab(db);
  const repo = memberRepository(clientFor(db, phd), sessionFor(phd));
  // The directory is shared by every test in the process, so check membership, not the count.
  const ids = new Set((await repo.listDirectory()).map((m) => m.id));
  assert.ok(ids.has(prof));
  assert.ok(ids.has(phd));
  assert.ok(ids.has(masters));
});

test("listLab includes supervisors for org chart", async () => {
  const db = await testDb();
  const { prof, phd, masters } = await seedLab(db);
  const repo = memberRepository(clientFor(db, phd), sessionFor(phd));
  const ids = new Set((await repo.listLab()).map((m) => m.id));
  assert.ok(ids.has(prof));
  assert.ok(ids.has(phd));
  assert.ok(ids.has(masters));
});
