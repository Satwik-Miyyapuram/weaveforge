/**
 * The attachment-paper prune keeps any paper another table points at (41-20).
 *
 * It used to check a fixed list of four tables, so a paper with a citation
 * alert, an annotation pin or a field value — tables added after the script —
 * counted as untouched and was deleted, taking that row with it by cascade.
 * Run against the full schema, so a table added later is covered without
 * anyone remembering this script.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { findAttachmentPapers } from "../../../../../scripts/lib/zotero-attachment-prune.mjs";
import { testDb } from "./pg-test-db";

describe("pruning attachment-shaped papers", () => {
  it("keeps a paper any table references and only reports, never writes", async () => {
    const db = await testDb();
    const user = await db.createUser();
    const [project] = await db.sql<{ id: string }>(
      "insert into projects (user_id, name) values ($1, 'p') returning id",
      [user],
    );
    const paper = async (title: string) =>
      (
        await db.sql<{ id: string }>(
          "insert into papers (user_id, title) values ($1, $2) returning id",
          [user, title],
        )
      )[0]!.id;

    const bare = await paper("Snapshot");
    const alerted = await paper("Preprint PDF");
    const linked = await paper("Full Text PDF");
    const real = await paper("Snapshot ensembles for neural networks");
    await db.sql(
      "insert into citation_alert_tracks (user_id, project_id, paper_id) values ($1, $2, $3)",
      [user, project!.id, alerted],
    );
    await db.sql(
      "insert into experiments (user_id, name, related_paper) values ($1, 'run', $2)",
      [user, linked],
    );

    const query = async (sql: string, params?: unknown[]) => ({ rows: await db.sql(sql, params) });
    const before = await db.sql<{ n: number }>("select count(*)::int as n from papers");
    const found = await findAttachmentPapers(query);
    const after = await db.sql<{ n: number }>("select count(*)::int as n from papers");

    const removable = found.removable.map((r) => r.id);
    const kept = new Map(found.touched.map((r) => [r.id, r.why]));
    assert.ok(removable.includes(bare));
    assert.ok(!removable.includes(alerted) && !removable.includes(linked));
    assert.match(kept.get(alerted) ?? "", /citation_alert_tracks/);
    assert.match(kept.get(linked) ?? "", /experiments/);
    assert.ok(!removable.includes(real) && !kept.has(real), "a real title is not a candidate");
    assert.equal(after[0]!.n, before[0]!.n, "finding writes nothing");
  });

  it("keeps a paper that carries Zotero annotations in its metadata", async () => {
    const db = await testDb();
    const user = await db.createUser();
    const [row] = await db.sql<{ id: string }>(
      `insert into papers (user_id, title, metadata) values ($1, 'Snapshot', '{"annotations": []}') returning id`,
      [user],
    );
    const query = async (sql: string, params?: unknown[]) => ({ rows: await db.sql(sql, params) });
    const found = await findAttachmentPapers(query);

    assert.ok(!found.removable.some((r) => r.id === row!.id));
    assert.match(found.touched.find((r) => r.id === row!.id)?.why ?? "", /zotero annotations/);
  });
});
