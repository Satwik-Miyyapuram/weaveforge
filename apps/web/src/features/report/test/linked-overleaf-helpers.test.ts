/**
 * The order of the linked Overleaf link form's writes (30-09).
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { linkOverleafReport } from "../application/parts";

function steps() {
  const calls: string[] = [];
  return {
    calls,
    saveConnection: async () => { calls.push("connection"); return "c1"; },
    createReport: async (input: { connectionId: string }) => { calls.push(`report:${input.connectionId}`); },
  };
}

const LINK = { projectId: "p1", title: "Thesis", overleafProjectId: "abc123", entryFile: "main.tex" };

for (const [label, bad] of [
  ["a bad project id", { overleafProjectId: "../x" }],
  ["an empty project id", { overleafProjectId: "  " }],
  ["a bad entry file", { entryFile: "../main.tex" }],
  ["an empty title", { title: " " }],
] as const) {
  test(`${label} saves no connection (30-09)`, async () => {
    const s = steps();
    await assert.rejects(() => linkOverleafReport({ ...LINK, ...bad }, s));
    assert.deepEqual(s.calls, []);
  });
}

test("a valid link saves the connection, then the report with its id", async () => {
  const s = steps();
  await linkOverleafReport(LINK, s);
  assert.deepEqual(s.calls, ["connection", "report:c1"]);
});

test("a padded project id is accepted, as the route trims it", async () => {
  const s = steps();
  await linkOverleafReport({ ...LINK, overleafProjectId: " abc123 " }, s);
  assert.deepEqual(s.calls, ["connection", "report:c1"]);
});
