import { test } from "node:test";
import assert from "node:assert/strict";
import { SHOWCASE_LOG, SHOWCASE_MILESTONES, SHOWCASE_SUPERVISOR_COMMENTS } from "../domain/showcase-data";
import { createRecordingDb } from "../infrastructure/recording-db";
import { seedCollabShowcase, seedShowcase } from "../infrastructure/seed-showcase";

const RESEARCHER = "00000000-0000-4000-8000-00000000000c";
const SUPERVISOR = "00000000-0000-4000-8000-00000000000b";
const PEER = "00000000-0000-4000-8000-00000000000d";
const NOW = new Date("2026-10-25T09:00:00Z");

async function seedResearcher() {
  const rec = createRecordingDb();
  const uploads: string[] = [];
  const seeded = await seedShowcase({
    db: rec.db,
    userId: RESEARCHER,
    store: { upload: async (_b, path) => uploads.push(path) },
    chart: async () => new Uint8Array([137, 80, 78, 71]),
    now: NOW,
  });
  return { rec, seeded };
}

test("the recording db echoes inserts with ids and records every write", async () => {
  const rec = createRecordingDb();
  const res = await rec.db.from("papers").insert([{ title: "A" }, { title: "B" }]).select("id, title");
  assert.equal(res.error, null);
  assert.equal(res.data!.length, 2);
  assert.ok(res.data!.every((r: { id?: string }) => typeof r.id === "string"));
  const one = await rec.db.from("projects").insert({ name: "P" }).select("id").single();
  assert.equal((one.data as unknown as { name: string }).name, "P");
  await rec.db.from("projects").delete().eq("user_id", "u").eq("name", "P");
  await rec.db.from("papers").update({ summary: "s" }).eq("id", "x");
  assert.deepEqual(rec.rows("papers").map((r) => r.title), ["A", "B"]);
  assert.deepEqual(rec.writes.map((w) => `${w.op} ${w.table}`), [
    "insert papers",
    "insert projects",
    "delete projects",
    "update papers",
  ]);
  assert.deepEqual(rec.writes[2]!.filters, [["user_id", "u"], ["name", "P"]]);
});

test("seedShowcase hands back the ids collab seeding needs", async () => {
  const { rec, seeded } = await seedResearcher();
  assert.equal(Object.keys(seeded.milestoneIds).length, SHOWCASE_MILESTONES.length);
  assert.equal(Object.keys(seeded.logIds).length, SHOWCASE_LOG.length);
  const logRows = rec.rows("log_entries");
  for (const e of SHOWCASE_LOG) {
    const row = logRows.find((r) => r.id === seeded.logIds[e.daysAgo]);
    assert.equal(row?.body, e.body);
  }
  const msRows = rec.rows("milestones");
  for (const m of SHOWCASE_MILESTONES) {
    assert.equal(msRows.find((r) => r.id === seeded.milestoneIds[m.title])?.title, m.title);
  }
  assert.ok(Object.keys(seeded.listIds).length > 0);
});

test("collab seeding: supervisor threads with student replies, resolved threads closed", async () => {
  const { seeded } = await seedResearcher();
  const rec = createRecordingDb();
  await seedCollabShowcase({ db: rec.db, now: NOW, researcherId: RESEARCHER, supervisorId: SUPERVISOR, peerId: PEER, seeded });

  const comments = rec.rows("comments");
  const roots = comments.filter((c) => c.parent_id == null);
  const replies = comments.filter((c) => c.parent_id != null);
  assert.equal(roots.length, SHOWCASE_SUPERVISOR_COMMENTS.length);
  assert.equal(replies.length, SHOWCASE_SUPERVISOR_COMMENTS.reduce((n, t) => n + t.replies.length, 0));
  assert.ok(roots.every((c) => c.author_id === SUPERVISOR));
  assert.ok(replies.every((c) => c.author_id === RESEARCHER));

  // Roots go in before replies (the insert trigger checks the parent exists).
  const rootWrite = rec.writes.findIndex((w) => w.table === "comments" && w.rows!.every((r) => r.parent_id == null));
  const replyWrite = rec.writes.findIndex((w) => w.table === "comments" && w.rows!.some((r) => r.parent_id != null));
  assert.ok(rootWrite >= 0 && replyWrite > rootWrite);

  const ids = new Set([...Object.values(seeded.milestoneIds), ...Object.values(seeded.logIds)]);
  for (const c of comments) assert.ok(ids.has(c.resource_id as string), "comment on a seeded resource");
  for (const r of replies) {
    const parent = roots.find((p) => p.id === r.parent_id)!;
    assert.equal(r.resource_type, parent.resource_type);
    assert.equal(r.resource_id, parent.resource_id);
    assert.ok(String(r.created_at) > String(parent.created_at), "a reply comes after its root");
  }
  for (const t of SHOWCASE_SUPERVISOR_COMMENTS) {
    const resourceId = t.resource === "milestone" ? seeded.milestoneIds[String(t.target)] : seeded.logIds[Number(t.target)];
    const root = roots.find((c) => c.resource_id === resourceId && c.body === t.body)!;
    assert.ok(root, t.body);
    assert.equal(root.resource_type, t.resource);
  }

  const resolved = rec.writes.filter((w) => w.op === "update" && w.table === "comments");
  assert.equal(resolved.length, SHOWCASE_SUPERVISOR_COMMENTS.filter((t) => t.resolved).length);
  assert.ok(resolved.every((w) => typeof w.values!.resolved_at === "string"));
});

test("collab seeding: shares are replaced, not duplicated, on a re-run", async () => {
  const { seeded } = await seedResearcher();
  const rec = createRecordingDb();
  await seedCollabShowcase({ db: rec.db, now: NOW, researcherId: RESEARCHER, supervisorId: SUPERVISOR, peerId: PEER, seeded });

  const shares = rec.rows("shares").map((s) => `${s.owner_id}>${s.recipient_id} ${s.resource_type} ${s.resource_id ?? "all"} ${s.access}`);
  const list = Object.values(seeded.listIds)[0];
  assert.deepEqual(shares.sort(), [
    `${PEER}>${RESEARCHER} milestone all comment`,
    `${RESEARCHER}>${PEER} reading_list ${list} view`,
    `${RESEARCHER}>${SUPERVISOR} milestone all comment`,
  ].sort());

  // Each share is preceded by a delete of the same owner, recipient and type.
  for (const s of rec.rows("shares")) {
    const del = rec.writes.find(
      (w) =>
        w.op === "delete" &&
        w.table === "shares" &&
        JSON.stringify(w.filters) ===
          JSON.stringify([["owner_id", s.owner_id], ["recipient_id", s.recipient_id], ["resource_type", s.resource_type]]),
    );
    assert.ok(del, `delete before share ${s.owner_id}>${s.recipient_id}`);
  }
});
