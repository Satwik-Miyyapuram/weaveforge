/**
 * The parts of the linked Overleaf panel that decide what it shows and saves:
 * stale clone results (30-03), repeated section titles (30-08) and the order
 * of the link form's writes (30-09).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { LatexSectionNode } from "@weaveforge/core";

import { latestRequest } from "../lib/latest-request";
import { sectionTargetKeys } from "../lib/section-target-keys";
import { linkOverleafReport } from "../application/link-overleaf-report";

test("only the newest request is current (30-03)", () => {
  const latest = latestRequest();
  const a = latest.begin();
  assert.equal(a(), true);
  const b = latest.begin();
  assert.equal(a(), false, "A resolving after B opened must be ignored");
  assert.equal(b(), true);
});

const node = (title: string) => ({ title, children: [] }) as unknown as LatexSectionNode;

test("unique sibling titles keep the stored key, the lowercased title path (30-08)", () => {
  assert.deepEqual(sectionTargetKeys([], [node("Intro"), node("Method")]), ["intro", "method"]);
  assert.deepEqual(sectionTargetKeys(["intro"], [node("Background")]), ["intro > background"]);
});

test("a repeated sibling title gets its own key; the first keeps the old one (30-08)", () => {
  assert.deepEqual(
    sectionTargetKeys(["results"], [node("Discussion"), node("discussion"), node("Discussion")]),
    ["results > discussion", "results > discussion#2", "results > discussion#3"],
  );
});

test("untitled siblings get separate keys too (30-08)", () => {
  assert.deepEqual(sectionTargetKeys([], [node(""), node("")]), ["(untitled)", "(untitled)#2"]);
});

test("the same title under different parents is not a repeat", () => {
  assert.deepEqual(sectionTargetKeys(["a"], [node("Notes")]), ["a > notes"]);
  assert.deepEqual(sectionTargetKeys(["b"], [node("Notes")]), ["b > notes"]);
});

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
