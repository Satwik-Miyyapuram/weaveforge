import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import { SupabasePaperRepository } from "../supabase-paper-repository";
import { createLocalClient, type LocalQuery } from "@/backend/providers/local/pglite-client";
import type { ProjectContext } from "@/lib/project-context";

/**
 * What the papers repository sends, and in what order it sends it.
 *
 * These are the two things the shared contract suite cannot check. It runs
 * against the in-memory repository, which has no project to be scoped to and no
 * round trips to count — so `listByIds` returning every project's rows, or
 * issuing its chunks one after another, passes it either way.
 *
 * The client is the real local one over a recording `run`, so the statements
 * asserted here are the statements the app would send.
 */

interface Recorder {
  run: LocalQuery;
  sql: string[];
  /** Parameters bound to each statement, in statement order. */
  params: unknown[][];
  /** Calls in flight, and the most that ever were at once. */
  inFlight: () => number;
  peak: () => number;
}

function recorder(rows: unknown[] = []): Recorder {
  const sql: string[] = [];
  const params: unknown[][] = [];
  let inFlight = 0;
  let peak = 0;
  const run: LocalQuery = async (statement, bound) => {
    sql.push(statement);
    params.push(bound ?? []);
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    // Yield, so a caller that awaits each request in turn never overlaps and a
    // caller that issues them together does.
    await new Promise((resolve) => setTimeout(resolve, 0));
    inFlight -= 1;
    return rows as never;
  };
  return { run, sql, params, inFlight: () => inFlight, peak: () => peak };
}

function repo(
  rec: Recorder,
  projectId: string | null = "p1",
): SupabasePaperRepository {
  const ctx: ProjectContext = { projectId };
  return new SupabasePaperRepository(
    createLocalClient(rec.run) as unknown as SupabaseClient,
    ctx,
  );
}

const STAMP_ROW = [
  { id: "a", updated_at: "2026-01-01T00:00:00.000Z", created_at: "2026-01-01T00:00:00.000Z" },
];

test("papers: a batch read is scoped to the project", async () => {
  // On the hosted path RLS hides the omission; on a self-hosted Postgres or the
  // local backend the same call returns another project's papers into this
  // project's sync, search index and prefetch.
  const rec = recorder([]);
  await repo(rec).listByIds(["a", "b"]);

  assert.equal(rec.sql.length, 1);
  assert.match(rec.sql[0]!, /"project_id" = \$1/);
});

test("papers: a single read and a delete are scoped too", async () => {
  const single = recorder([]);
  await repo(single).getById("a");
  assert.match(single.sql[0]!, /"project_id" = \$1/);

  const removal = recorder([]);
  await repo(removal).delete("a");
  assert.match(removal.sql[0]!, /delete from "papers"/);
  assert.match(removal.sql[0]!, /"project_id" = \$1/);
});

test("papers: with no project selected the read is not filtered by null", async () => {
  // Repositories are built before a project is chosen, and `pid` may still be
  // null; the rule is "filter when there is a project", not "filter by null".
  // (`project_id` still appears in the select list, which is why this asserts on
  // the filter rather than on the word appearing at all.)
  const rec = recorder([]);
  await repo(rec, null).getById("a");

  assert.doesNotMatch(rec.sql[0]!, /"project_id" = /);
});

test("papers: a batch read issues its chunks together", async () => {
  // Ten sequential round trips for a 2 000-id delta read is nine round trips
  // nobody asked for. Chunking exists to keep the `in` list inside the URL
  // length limit, not to serialise.
  const rec = recorder([]);
  const ids = Array.from({ length: 450 }, (_, index) => `id-${index}`);
  await repo(rec).listByIds(ids);

  assert.equal(rec.sql.length, 3, "450 ids at 200 per request");
  assert.equal(rec.peak(), 3, "and all three were in flight at once");
});

test("papers: a batch read has a deterministic order", async () => {
  const rec = recorder([]);
  await repo(rec).listByIds(["a", "b"]);

  assert.match(rec.sql[0]!, /order by "id" asc$/);
});

test("papers: an empty DOI matches nothing, and is not asked of the server", async () => {
  // `normalizeDoi` answers `undefined` for falsy input only — it normalises, it
  // does not validate — so the non-null assertion that used to be here was
  // unsound rather than wrong in practice. This pins the falsy case, which is
  // the one the assertion would have turned into `.eq("doi", undefined)`.
  const rec = recorder([]);
  const found = await repo(rec).findByDoi("");

  assert.equal(found, null);
  assert.deepEqual(rec.sql, [], "and nothing was asked of the server");
});

test("papers: a DOI is normalised before it is used as a filter", async () => {
  const rec = recorder([]);
  await repo(rec).list({ doi: "https://doi.org/10.1234/ABC" });

  assert.equal(rec.sql.length, 1);
  assert.match(rec.sql[0]!, /"doi" = \$/);
  assert.deepEqual(
    rec.params[0],
    ["p1", "10.1234/abc"],
    "the URL prefix is stripped and the value is lowercased",
  );
});

test("papers: the list projection is the one the caller may rely on", async () => {
  // `listSummaries` selects summary columns and must not claim more than that —
  // a caller reading `.abstract` off a summary is how a card edit wrote
  // `undefined` over a real row (review-2 F6).
  const rec = recorder([]);
  await repo(rec).listSummaries();

  assert.match(rec.sql[0]!, /"id", "title"/);
  assert.doesNotMatch(rec.sql[0]!, /"bibtex"|"metadata"/);
});

test("papers: stamps come back ordered so a delta read is stable", async () => {
  const rec = recorder(STAMP_ROW);
  const stamps = await repo(rec).listStamps();

  assert.deepEqual(stamps, [{ id: "a", updatedAt: "2026-01-01T00:00:00.000Z" }]);
  assert.match(rec.sql[0]!, /order by "created_at" desc, "id" asc$/);
});
