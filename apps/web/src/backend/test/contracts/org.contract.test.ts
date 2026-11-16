// contract-repos: org, supervision
import assert from "node:assert/strict";
import test from "node:test";
import type { LogEntry, Milestone } from "@weaveforge/core";
import { rustRepository } from "@/backend/providers/postgrest/rust-repository";
import { testDb } from "../pg-test-db";
import { clientFor, type Db } from "./harness";

/**
 * The `org` and `supervision` repositories, end to end: Rust plans each query,
 * the TS sender runs it against PGlite with the real org, milestone and log
 * migrations and RLS. Rows are seeded as the database owner, since `user_id`
 * defaults to `auth.uid()` and a raw insert has no caller.
 *
 * `memberships()` is not here: its PostgREST embed (organizations name) cannot
 * run on the local translator. Its mapping is covered by the Rust test in
 * `crates/wf-core/src/repos/org.rs`.
 */

/** The org RPCs and reads Rust plans (`crates/wf-core/src/repos/org.rs`). */
type OrgSteps = {
  memberships(): Promise<{ orgId: string; orgName: string; role: string; joinSource: string }[]>;
  switchActive(orgId: string): Promise<void>;
  leave(orgId: string): Promise<void>;
};

/** The supervision reads Rust plans (`crates/wf-core/src/repos/supervision.rs`). */
type SupervisionSteps = {
  listMilestones(memberId: string): Promise<Milestone[]>;
  listLogs(memberId: string): Promise<LogEntry[]>;
  listMilestonesFor(memberIds: readonly string[]): Promise<[string, Milestone[]][]>;
  listLogsFor(memberIds: readonly string[]): Promise<[string, LogEntry[]][]>;
};

/** The repositories as `userId`: RLS sees that user as `auth.uid()`. */
function reposFor(db: Db, userId: string) {
  const client = clientFor(db, userId);
  return {
    org: rustRepository<OrgSteps>(client, "org", ["memberships", "switchActive", "leave"], () => ({ userId })),
    supervision: rustRepository<SupervisionSteps>(client, "supervision", [
      "listMilestones",
      "listLogs",
      "listMilestonesFor",
      "listLogsFor",
    ]),
  };
}

async function seedOrg(db: Db, ownerId: string, name = "Lab"): Promise<string> {
  const [row] = await db.sql<{ id: string }>(
    "insert into organizations (name, owner_id) values ($1, $2) returning id",
    [name, ownerId],
  );
  return row!.id;
}

async function join(db: Db, orgId: string, userId: string, joinedAt: string): Promise<void> {
  await db.sql(
    "insert into org_memberships (org_id, user_id, role, joined_at) values ($1, $2, 'phd', $3)",
    [orgId, userId, joinedAt],
  );
}

async function seedMilestone(db: Db, userId: string, title: string): Promise<string> {
  const [row] = await db.sql<{ id: string }>(
    "insert into milestones (user_id, title) values ($1, $2) returning id",
    [userId, title],
  );
  return row!.id;
}

async function seedLog(db: Db, userId: string, entryDate: string, body: string): Promise<string> {
  const [row] = await db.sql<{ id: string }>(
    "insert into log_entries (user_id, entry_date, body) values ($1, $2, $3) returning id",
    [userId, entryDate, body],
  );
  return row!.id;
}

/**
 * `can_access(owner)` (migration 0147) is true for the owner and for anyone up
 * the `profiles.supervisor_id` chain, so `supervisor` sees `member`'s rows only
 * once `member` names them as supervisor.
 */
async function supervises(db: Db, supervisor: string, member: string): Promise<void> {
  await db.sql("update profiles set supervisor_id = $1 where user_id = $2", [supervisor, member]);
}

test("leave removes the caller's membership", async () => {
  const db = await testDb();
  const owner = await db.createUser();
  const me = await db.createUser();
  const orgId = await seedOrg(db, owner);
  await join(db, orgId, me, "2026-06-01T00:00:00Z");
  await reposFor(db, me).org.leave(orgId);
  const left = await db.sql<{ x: number }>(
    "select 1 as x from org_memberships where org_id = $1 and user_id = $2",
    [orgId, me],
  );
  assert.equal(left.length, 0);
});

test("switchActive rejects for a lab the caller is not in", async () => {
  const db = await testDb();
  const owner = await db.createUser();
  const me = await db.createUser();
  const orgId = await seedOrg(db, owner);
  await assert.rejects(reposFor(db, me).org.switchActive(orgId), (e: Error) =>
    e.message.includes("Not a member of this lab"),
  );
});

test("milestones: listMilestones returns the member's milestones", async () => {
  const db = await testDb();
  const me = await db.createUser();
  const other = await db.createUser();
  const mine = await seedMilestone(db, me, "Draft intro");
  await seedMilestone(db, other, "Not mine");
  const found = await reposFor(db, me).supervision.listMilestones(me);
  assert.deepEqual(found.map((m) => m.id), [mine]);
});

test("logs: listLogs returns the member's log entries newest first", async () => {
  const db = await testDb();
  const me = await db.createUser();
  const older = await seedLog(db, me, "2026-06-01", "older");
  const newer = await seedLog(db, me, "2026-06-20", "newer");
  const found = await reposFor(db, me).supervision.listLogs(me);
  assert.deepEqual(found.map((e) => e.id), [newer, older]);
});

// RLS (0082 log_entries, 0087 milestones) lets a supervisor read only what the student shares (intended); same on main.
test("listMilestonesFor groups milestones by member; RLS hides supervisee rows", async () => {
  const db = await testDb();
  const a = await db.createUser();
  const b = await db.createUser();
  await supervises(db, a, b);
  const aMilestone = await seedMilestone(db, a, "A's milestone");
  await seedMilestone(db, b, "B's milestone");
  const grouped = new Map(await reposFor(db, a).supervision.listMilestonesFor([a, b]));
  assert.deepEqual(grouped.get(a)?.map((m) => m.id), [aMilestone]);
  assert.deepEqual(grouped.get(b) ?? [], []);
});

// RLS (0082 log_entries, 0087 milestones) lets a supervisor read only what the student shares (intended); same on main.
test("listLogsFor groups log entries by member; RLS hides supervisee rows", async () => {
  const db = await testDb();
  const a = await db.createUser();
  const b = await db.createUser();
  await supervises(db, a, b);
  const aLog = await seedLog(db, a, "2026-06-10", "a");
  await seedLog(db, b, "2026-06-10", "b");
  const grouped = new Map(await reposFor(db, a).supervision.listLogsFor([a, b]));
  assert.deepEqual(grouped.get(a)?.map((e) => e.id), [aLog]);
  assert.deepEqual(grouped.get(b) ?? [], []);
});

test("a stranger sees no milestones or logs of another member", async () => {
  const db = await testDb();
  const member = await db.createUser();
  const stranger = await db.createUser();
  await seedMilestone(db, member, "Private");
  await seedLog(db, member, "2026-06-10", "Private");
  const repos = reposFor(db, stranger);
  assert.deepEqual(await repos.supervision.listMilestones(member), []);
  assert.deepEqual(await repos.supervision.listLogs(member), []);
});
