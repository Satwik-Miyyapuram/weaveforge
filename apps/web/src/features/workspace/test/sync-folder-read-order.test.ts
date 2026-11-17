import assert from "node:assert/strict";
import { test } from "node:test";

import { restTableReader } from "../application/workspace-folder-tables";
import type { SyncRow } from "../application/sync-tables";

/**
 * G1: a paged PostgREST read with no order lets Postgres return rows in any order
 * between pages, so a row can be dropped or repeated. The fake below does that on
 * purpose when the query has no order, and sorts by the order columns when it does.
 */
type Log = { table: string; order: string[] }[];

function fakeClient(tables: Record<string, SyncRow[]>, log: Log) {
  let unorderedCall = 0;
  return {
    from(table: string) {
      const orders: string[] = [];
      let from = 0;
      let to = 0;
      const builder = {
        select() {
          return builder;
        },
        order(column: string) {
          orders.push(column);
          return builder;
        },
        range(a: number, b: number) {
          from = a;
          to = b;
          log.push({ table, order: [...orders] });
          const rows = [...(tables[table] ?? [])];
          if (orders.length > 0) {
            rows.sort((x, y) => {
              for (const c of orders) {
                const xv = x[c] as number | string;
                const yv = y[c] as number | string;
                if (xv < yv) return -1;
                if (xv > yv) return 1;
              }
              return 0;
            });
          } else {
            // Unordered: the heap order shifts between requests.
            unorderedCall += 1;
            const shift = (unorderedCall * 7) % Math.max(rows.length, 1);
            rows.push(...rows.splice(0, shift));
          }
          return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
        },
      };
      return builder;
    },
  };
}

test("a paged read returns every row exactly once, ordered by the primary key", async () => {
  const papers: SyncRow[] = Array.from({ length: 2500 }, (_, i) => ({ id: `p-${String(i).padStart(5, "0")}` }));
  const log: Log = [];
  const reader = restTableReader(fakeClient({ papers }, log) as never);
  const rows = await reader("papers");
  const ids = rows.map((r) => r.id);
  assert.equal(ids.length, 2500, "no row dropped across pages");
  assert.equal(new Set(ids).size, 2500, "no row repeated across pages");
  assert.deepEqual(log.find((l) => l.table === "papers")?.order, ["id"], "each page request is ordered by id");
});

test("the paged read of a composite-key table orders by its whole key", async () => {
  const paper_tags: SyncRow[] = Array.from({ length: 1200 }, (_, i) => ({
    paper_id: `paper-${i % 40}`,
    tag_id: `tag-${i % 30}`,
    source: i % 2 === 0 ? "user" : "ai",
  }));
  const log: Log = [];
  const rows = await restTableReader(fakeClient({ paper_tags }, log) as never)("paper_tags");
  assert.equal(rows.length, 1200);
  assert.deepEqual(log.find((l) => l.table === "paper_tags")?.order, ["paper_id", "tag_id", "source"]);
});

test("experiment metric points and chunks page on their composite keys, which have no id column", async () => {
  const points: SyncRow[] = Array.from({ length: 1100 }, (_, i) => ({
    experiment_id: "e1",
    metric_id: i % 3,
    step: i,
    value: i,
  }));
  const chunks: SyncRow[] = Array.from({ length: 1100 }, (_, i) => ({
    experiment_id: "e1",
    metric_id: i % 3,
    chunk_no: i,
  }));
  const log: Log = [];
  const client = fakeClient({ experiment_metric_points: points, experiment_metric_chunks: chunks }, log);
  const pointRows = await restTableReader(client as never)("experiment_metric_points");
  const chunkRows = await restTableReader(client as never)("experiment_metric_chunks");
  assert.equal(pointRows.length, 1100);
  assert.equal(chunkRows.length, 1100);
  assert.deepEqual(log.find((l) => l.table === "experiment_metric_points")?.order, ["experiment_id", "metric_id", "step"]);
  assert.deepEqual(log.find((l) => l.table === "experiment_metric_chunks")?.order, [
    "experiment_id",
    "metric_id",
    "chunk_no",
  ]);
});
