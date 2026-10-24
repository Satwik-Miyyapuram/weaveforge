/**
 * Status contract of the linked report content read: 404 only when a row is
 * missing, 500 when the database cannot say (14-04).
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { linkedReportContent } from "../_content";

type Answer = { data: unknown; error: unknown };

/** A db whose `maybeSingle` answers per table, and whose updates succeed. */
function fakeDb(answers: Record<string, Answer>) {
  return {
    from(table: string) {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => answers[table] ?? { data: null, error: null },
        update: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }),
      };
      return chain;
    },
  } as never;
}

const REPORT = {
  id: "r1",
  overleaf_project_id: "abc123",
  entry_file: "main.tex",
  external_url: null,
  connection_id: "c1",
};

const neverRead = async () => {
  throw new Error("the reader should not run");
};

test("a report lookup error is a 500", async () => {
  const db = fakeDb({ overleaf_linked_reports: { data: null, error: { message: "db down" } } });
  const res = await linkedReportContent({ db, userId: "u1" }, "r1", neverRead);
  assert.equal(res.status, 500);
});

test("no report row is a 404", async () => {
  const res = await linkedReportContent({ db: fakeDb({}), userId: "u1" }, "r1", neverRead);
  assert.equal(res.status, 404);
});

test("a connection lookup error is a 500, not 'unavailable' (14-04)", async () => {
  const db = fakeDb({
    overleaf_linked_reports: { data: REPORT, error: null },
    overleaf_connections: { data: null, error: { message: "permission denied for table overleaf_connections" } },
  });
  const res = await linkedReportContent({ db, userId: "u1" }, "r1", neverRead);
  assert.equal(res.status, 500);
  assert.doesNotMatch((await res.json()).error, /unavailable/);
});

test("no connection row is still a 404", async () => {
  const db = fakeDb({ overleaf_linked_reports: { data: REPORT, error: null } });
  const res = await linkedReportContent({ db, userId: "u1" }, "r1", neverRead);
  assert.equal(res.status, 404);
  assert.match((await res.json()).error, /unavailable/);
});
