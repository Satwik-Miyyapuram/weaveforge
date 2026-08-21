import assert from "node:assert/strict";
import test from "node:test";
import { testDb } from "@/backend/test/pg-test-db";

/**
 * `reader_annotations` (migration 0110) against the real migrations.
 *
 * Two things unit tests cannot prove: that the deployed schema matches what the
 * repositories write, and that RLS isolates one researcher's annotations from
 * another's. Both are checked here on an in-process Postgres — no project, no
 * accounts, no secrets. See backend/test/pg-test-db.ts for its limits.
 */

const anchor = {
  zoteroPosition: { pageIndex: 3, rects: [[72, 700, 172, 712]] },
  locus: { quote: { type: "TextQuoteSelector", exact: "integration probe" } },
};

interface Annotation {
  id: string; user_id: string; anchor: unknown; sync_state: string;
  tags: string[]; comment: string; updated_at: string;
}

test("reader_annotations enforces per-user RLS and accepts the repository's shape", async () => {
  const db = await testDb();
  const owner = await db.createUser();
  const other = await db.createUser();

  const [project] = await db.as(owner).sql<{ id: string }>(
    "insert into projects (name) values ('Reader RLS') returning id",
  );
  const [paper] = await db.as(owner).sql<{ id: string }>(
    "insert into papers (project_id, title) values ($1, 'Attention') returning id", [project!.id],
  );

  // Exactly the payload SupabaseReaderAnnotationRepository.create builds.
  const [created] = await db.as(owner).sql<Annotation>(
    `insert into reader_annotations
       (project_id, paper_id, origin, type, color, text, comment, tags, anchor, page_index, sort_index, sync_state)
     values ($1, $2, 'local', 'highlight', '#ffd400', 'integration probe', '', '{}', $3, 3, '00003|000000|00080', 'local')
     returning *`,
    [project!.id, paper!.id, JSON.stringify(anchor)],
  );
  // user_id defaults to auth.uid() — the repository relies on the column
  // existing, but the default is what makes the RLS check pass on insert.
  assert.equal(created!.user_id, owner, "user_id must be populated by its default");
  assert.deepEqual(created!.anchor, anchor, "jsonb anchor round-trips unchanged");
  assert.equal(created!.sync_state, "local");
  assert.deepEqual(created!.tags, []);

  // Every Zotero type must be storable; a CHECK that rejects one would only
  // surface when a user drew it.
  for (const type of ["underline", "note", "image", "ink", "text"]) {
    const [typed] = await db.as(owner).sql<{ id: string }>(
      "insert into reader_annotations (project_id, paper_id, type, anchor, page_index) values ($1, $2, $3, '{}', 0) returning id",
      [project!.id, paper!.id, type],
    );
    await db.as(owner).sql("delete from reader_annotations where id = $1", [typed!.id]);
  }

  // `strikeout` is not a Zotero type, and an unknown sync_state must be refused
  // too — R5 reads that column.
  await assert.rejects(
    () => db.as(owner).sql(
      "insert into reader_annotations (project_id, paper_id, type, anchor, page_index) values ($1, $2, 'strikeout', '{}', 0)",
      [project!.id, paper!.id]),
    /type/, "the type CHECK must reject a non-Zotero type",
  );
  await assert.rejects(
    () => db.as(owner).sql(
      "insert into reader_annotations (project_id, paper_id, type, anchor, page_index, sync_state) values ($1, $2, 'highlight', '{}', 0, 'totally-made-up')",
      [project!.id, paper!.id]),
    /sync_state/, "the sync_state CHECK must reject an unknown state",
  );

  // The updated_at trigger must fire, or R5 cannot tell what changed.
  // Compared in SQL: both timestamps land in the same wall-clock second often
  // enough that comparing their rendered strings is a coin flip.
  const [touched] = await db.as(owner).sql<{ bumped: boolean }>(
    "update reader_annotations set comment = 'edited' where id = $1 returning updated_at > created_at as bumped", [created!.id],
  );
  assert.equal(touched!.bumped, true, "reader_annotations_set_updated_at must fire");

  // RLS: the other user must not see, edit, or delete this row.
  assert.deepEqual(
    await db.as(other).sql("select id from reader_annotations where id = $1", [created!.id]),
    [], "annotations must not leak across users",
  );
  assert.deepEqual(
    await db.as(other).sql("update reader_annotations set comment = 'tampered' where id = $1 returning id", [created!.id]),
    [], "a foreign user must not edit someone's annotation",
  );
  assert.deepEqual(
    await db.as(other).sql("delete from reader_annotations where id = $1 returning id", [created!.id]),
    [], "a foreign user must not delete someone's annotation",
  );

  const [survivor] = await db.as(owner).sql<{ comment: string }>(
    "select comment from reader_annotations where id = $1", [created!.id],
  );
  assert.equal(survivor!.comment, "edited", "the row is still there and unmodified after all that");
});
