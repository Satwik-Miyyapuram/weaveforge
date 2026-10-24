/**
 * Tag counts read only the links to this project's tags (26-09).
 *
 * `listWithCounts` used to select every `paper_tags` row the user could read,
 * across every project, on each dashboard load. It now asks only for the
 * project's tag ids, in URL-sized chunks.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import { PostgrestTagRepository } from "../infrastructure/postgrest-tag-repository";

interface Link {
  tag_id: string;
  paper_id: string;
}

/** A client over two tables that applies `eq` and `in`, and logs paper_tags reads. */
function fakeDb(tags: { id: string; name: string; project_id: string }[], links: Link[]) {
  const reads: { filters: [string, string, unknown][] }[] = [];
  const db = {
    from(table: string) {
      const filters: [string, string, unknown][] = [];
      if (table === "paper_tags") reads.push({ filters });
      const source = (table === "tags" ? tags : table === "paper_tags" ? links : []) as Record<string, unknown>[];
      const result = () => ({
        data: source.filter((row) =>
          filters.every(([op, col, v]) => (op === "eq" ? row[col] === v : (v as unknown[]).includes(row[col]))),
        ),
        error: null,
      });
      const builder: Record<string, unknown> = {
        then: (resolve: (value: unknown) => unknown, reject?: (e: unknown) => unknown) =>
          Promise.resolve(result()).then(resolve, reject),
        select: () => builder,
        order: () => builder,
        eq: (col: string, v: unknown) => (filters.push(["eq", col, v]), builder),
        in: (col: string, v: unknown[]) => (filters.push(["in", col, v]), builder),
      };
      return builder;
    },
  };
  return { db: db as unknown as SupabaseClient, reads };
}

const tag = (id: string, project_id = "P") => ({ id, name: id, project_id });

test("counts only links to the project's tags, each paper once", async () => {
  const { db, reads } = fakeDb(
    [tag("t1"), tag("t2"), tag("x", "OTHER")],
    [
      { tag_id: "t1", paper_id: "a" },
      { tag_id: "t1", paper_id: "a" },
      { tag_id: "t1", paper_id: "b" },
      { tag_id: "x", paper_id: "c" },
    ],
  );
  const repo = new PostgrestTagRepository(db, { projectId: "P" });
  const counts = await repo.listWithCounts();
  assert.deepEqual(
    counts.map((t) => [t.id, t.paperCount]),
    [["t1", 2], ["t2", 0]],
  );
  assert.equal(reads.length, 1);
  assert.deepEqual(reads[0]!.filters, [["in", "tag_id", ["t1", "t2"]]], "the read is limited to the project's tags");
});

test("no tags, no paper_tags read", async () => {
  const { db, reads } = fakeDb([tag("x", "OTHER")], [{ tag_id: "x", paper_id: "c" }]);
  const counts = await new PostgrestTagRepository(db, { projectId: "P" }).listWithCounts();
  assert.deepEqual(counts, []);
  assert.equal(reads.length, 0);
});

test("many tags are read in chunks that fit a URL, and every count is kept", async () => {
  const many = Array.from({ length: 450 }, (_, i) => tag(`t${String(i).padStart(3, "0")}`));
  const links = many.map((t, i) => ({ tag_id: t.id, paper_id: `p${i % 7}` }));
  const { db, reads } = fakeDb(many, links);
  const counts = await new PostgrestTagRepository(db, { projectId: "P" }).listWithCounts();
  assert.equal(counts.length, 450);
  assert.ok(counts.every((t) => t.paperCount === 1));
  assert.ok(reads.length > 1);
  for (const r of reads) assert.ok((r.filters[0]![2] as unknown[]).length <= 200);
});
