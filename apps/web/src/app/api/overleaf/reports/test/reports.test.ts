/**
 * Body and lookup handling of the linked report writes (14-05). A body that is
 * not an object, or a field that is not a string, is the caller's mistake (400),
 * not a crash (500). A lookup the database cannot answer is a 500, not "not found".
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { createLinkedReport, patchLinkedReport } from "../_reports";

type Answer = { data: unknown; error: unknown };

/** Every chain ends in `maybeSingle` or `single`, answered per table. */
function fakeDb(answers: Record<string, Answer>) {
  const writes: { table: string; values: unknown }[] = [];
  const db = {
    from(table: string) {
      const chain: Record<string, unknown> = {};
      const self = () => chain;
      Object.assign(chain, {
        select: self,
        eq: self,
        insert: (values: unknown) => { writes.push({ table, values }); return chain; },
        update: (values: unknown) => { writes.push({ table, values }); return chain; },
        maybeSingle: async () => answers[table] ?? { data: null, error: null },
        single: async () => answers[table] ?? { data: null, error: null },
      });
      return chain;
    },
  };
  return { writes, caller: { db: db as never, userId: "u1" } };
}

const VALID = { projectId: "p1", connectionId: "c1", title: "Thesis", overleafProjectId: "abc123", entryFile: "main.tex" };
const FOUND: Record<string, Answer> = {
  projects: { data: { id: "p1" }, error: null },
  overleaf_connections: { data: { id: "c1" }, error: null },
  overleaf_linked_reports: { data: { id: "r1" }, error: null },
};

for (const body of [null, "text", 42, ["a"]]) {
  test(`POST with a ${JSON.stringify(body)} body is a 400`, async () => {
    const { caller, writes } = fakeDb(FOUND);
    assert.equal((await createLinkedReport(caller, body)).status, 400);
    assert.equal(writes.length, 0);
  });
  test(`PATCH with a ${JSON.stringify(body)} body is a 400`, async () => {
    const { caller, writes } = fakeDb(FOUND);
    assert.equal((await patchLinkedReport(caller, body)).status, 400);
    assert.equal(writes.length, 0);
  });
}

for (const field of ["projectId", "connectionId", "title", "overleafProjectId", "entryFile"]) {
  test(`POST with a non-string ${field} is a 400`, async () => {
    const { caller, writes } = fakeDb(FOUND);
    assert.equal((await createLinkedReport(caller, { ...VALID, [field]: 7 })).status, 400);
    assert.equal(writes.length, 0);
  });
}

for (const field of ["id", "title", "overleafProjectId", "entryFile"]) {
  test(`PATCH with a non-string ${field} is a 400`, async () => {
    const { caller, writes } = fakeDb(FOUND);
    assert.equal((await patchLinkedReport(caller, { id: "r1", title: "T", [field]: { x: 1 } })).status, 400);
    assert.equal(writes.length, 0);
  });
}

test("POST with a valid body creates the report", async () => {
  const { caller, writes } = fakeDb(FOUND);
  assert.equal((await createLinkedReport(caller, VALID)).status, 201);
  assert.equal(writes.length, 1);
});

test("POST with no entry file defaults to main.tex", async () => {
  const { caller, writes } = fakeDb(FOUND);
  const { entryFile: _omit, ...rest } = VALID;
  assert.equal((await createLinkedReport(caller, rest)).status, 201);
  assert.equal((writes[0]!.values as { entry_file: string }).entry_file, "main.tex");
});

test("POST whose project lookup errors is a 500, not a 404", async () => {
  const { caller, writes } = fakeDb({ ...FOUND, projects: { data: null, error: { message: "db down" } } });
  assert.equal((await createLinkedReport(caller, VALID)).status, 500);
  assert.equal(writes.length, 0);
});

test("POST whose connection lookup errors is a 500, not a 404", async () => {
  const { caller, writes } = fakeDb({ ...FOUND, overleaf_connections: { data: null, error: { message: "db down" } } });
  assert.equal((await createLinkedReport(caller, VALID)).status, 500);
  assert.equal(writes.length, 0);
});

test("POST for a missing project or connection is still a 404", async () => {
  for (const table of ["projects", "overleaf_connections"]) {
    const { caller } = fakeDb({ ...FOUND, [table]: { data: null, error: null } });
    assert.equal((await createLinkedReport(caller, VALID)).status, 404);
  }
});

test("PATCH of section targets alone still works", async () => {
  const { caller, writes } = fakeDb(FOUND);
  assert.equal((await patchLinkedReport(caller, { id: "r1", sectionTargets: { intro: 500 } })).status, 200);
  assert.deepEqual(writes[0]!.values, { section_targets: { intro: 500 } });
});

test("PATCH of a missing report is a 404", async () => {
  const { caller } = fakeDb({ ...FOUND, overleaf_linked_reports: { data: null, error: null } });
  assert.equal((await patchLinkedReport(caller, { id: "r1", title: "T" })).status, 404);
});
