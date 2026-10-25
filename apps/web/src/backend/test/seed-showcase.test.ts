import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createLocalClient, type LocalQuery } from "@/backend/providers/local/pglite-client";
import { requireItem, seedShowcase } from "@/features/showcase/infrastructure/seed-showcase";
import {
  SHOWCASE_MILESTONES,
  SHOWCASE_PAPER_FIGURES,
  SHOWCASE_READING_LISTS,
  SHOWCASE_SCREENING,
} from "@/features/showcase/domain/showcase-data";
import { testDb } from "./pg-test-db";

/**
 * The whole demo seed against the real schema (review 36-19…36-22): the
 * counts it reports, and the links between tables it builds from id maps.
 */

const PNG = new Uint8Array([137, 80, 78, 71]);
const NOW = new Date("2026-05-01T12:00:00Z");

async function seeded(chart: (kind: string) => Promise<Uint8Array | null>) {
  const db = await testDb();
  const user = await db.createUser();
  const client = createLocalClient(db.as(user).sql as LocalQuery) as unknown as SupabaseClient;
  const uploads: string[] = [];
  const result = await seedShowcase({
    db: client,
    userId: user,
    now: NOW,
    chart,
    store: { upload: async (bucket, path) => void uploads.push(`${bucket}/${path}`) },
  });
  return { db, user, result, uploads };
}

test("the seed reports what it wrote, and every list item and screening answer is linked", async () => {
  const { db, result, uploads } = await seeded(async () => PNG);
  const figureCount = Object.values(SHOWCASE_PAPER_FIGURES).reduce((n, list) => n + list.length, 0);
  assert.equal(result.counts.figures, figureCount);
  assert.ok(uploads.length > figureCount, "experiment artifacts upload too");
  assert.equal(result.counts.readingLists, SHOWCASE_READING_LISTS.length);
  assert.equal(
    result.counts.readingListItems,
    SHOWCASE_READING_LISTS.reduce((n, l) => n + l.papers.length, 0),
  );
  assert.equal(result.counts.milestones, SHOWCASE_MILESTONES.length);

  // Each screening answer sits on the item for its own list and paper.
  const answers = await db.sql<{ list: string; paper: string }>(
    `select l.name as list, p.title as paper
       from screening_decisions d
       join reading_list_items i on i.id = d.item_id
       join reading_lists l on l.id = i.list_id
       join papers p on p.id = i.paper_id
      where l.project_id = $1`,
    [result.projectId],
  );
  assert.equal(answers.length, SHOWCASE_SCREENING.length);
  const want = SHOWCASE_SCREENING.map((d) => `${d.list}|${d.paper}`).sort();
  assert.deepEqual(answers.map((a) => `${a.list}|${a.paper}`).sort(), want);

  // Sublists hang off their parent; a milestone dependency names a real milestone.
  const orphans = await db.sql<{ n: number }>(
    `select count(*)::int as n from reading_lists c
      where c.project_id = $1 and c.parent_id is not null
        and not exists (select 1 from reading_lists p where p.id = c.parent_id)`,
    [result.projectId],
  );
  assert.equal(orphans[0]!.n, 0);
  const deps = await db.sql<{ ref: string | null }>(
    `select d->>'refId' as ref from milestones m, jsonb_array_elements(m.dependencies) d
      where m.project_id = $1 and d->>'kind' = 'milestone'`,
    [result.projectId],
  );
  assert.ok(deps.length > 0);
  const ids = new Set(
    (await db.sql<{ id: string }>("select id from milestones where project_id = $1", [result.projectId])).map((r) => r.id),
  );
  for (const d of deps) assert.ok(d.ref && ids.has(d.ref), "milestone dependency resolves");

  const pins = await db.sql<{ n: number }>("select count(*)::int as n from library_pins where project_id = $1", [
    result.projectId,
  ]);
  assert.equal(pins[0]!.n, result.counts.libraryPins);
});

test("with no charts the seed still completes, without figures or uploads", async () => {
  const { result, uploads } = await seeded(async () => null);
  assert.equal(result.counts.figures, 0);
  assert.equal(result.counts.artifacts, 0);
  assert.deepEqual(uploads, []);
  assert.ok((result.counts.papers ?? 0) > 0);
});

test("a screening answer whose list item is missing fails with its list and paper (36-20)", () => {
  const items = new Map([["A\u0000p1", "item-1"]]);
  assert.equal(requireItem(items, "A", "p1"), "item-1");
  assert.throws(() => requireItem(items, "A", "p2"), /missing item A\/p2/);
  assert.throws(() => requireItem(items, "B", "p1"), /missing item B\/p1/);
});
