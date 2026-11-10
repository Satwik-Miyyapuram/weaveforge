import { before, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initSync } from "../src/index.js";
import {
  parseResultsTableRefs,
  resolveResultsTables,
  serialiseResultsTableRef,
} from "../src/report-results-tables.js";
import type { ResultsTableExperiment } from "../src/report-results-tables.js";

const pkgDir = new URL("../pkg/", import.meta.url);

before(() => {
  initSync({ module: readFileSync(new URL("wf_wasm_bg.wasm", pkgDir)) });
});

function exp(id: string, name: string, metrics: Record<string, unknown>) {
  const run = { id, name, status: "done", config: {}, metrics, artifacts: [], createdAt: "2026-01-01T00:00:00.000Z" };
  const typed: ResultsTableExperiment = run;
  return typed;
}

const A = exp("a", "baseline", { acc: 0.9, loss: 0.25 });
const B = exp("b", "big|lr", { acc: 0.95, f1: 0.8 });

test("serialise and parse round-trip ids and caption", () => {
  const md = `Intro ${serialiseResultsTableRef(["a", "b,c"], "Main [results]")} end`;
  const refs = parseResultsTableRefs(md);
  assert.equal(refs.length, 1);
  assert.deepEqual(refs[0]!.experimentIds, ["a", "b,c"]);
  assert.equal(refs[0]!.caption, "Main results");
  assert.equal(md.slice(refs[0]!.start, refs[0]!.end), refs[0]!.raw);
});

test("serialise uses Results as the default caption", () => {
  assert.equal(serialiseResultsTableRef(["a"]), "![Results](exptable:a)");
});

test("parse ignores expartifact refs, empty id lists and plain images", () => {
  const md = "![x](expartifact:a/loss.png) ![y](exptable:) ![z](https://e.org/t.png)";
  assert.deepEqual(parseResultsTableRefs(md), []);
});

test("markdown table escapes pipes and is a GFM table", () => {
  const md = resolveResultsTables(serialiseResultsTableRef(["a", "b"], "Results"), [A, B], "markdown");
  const lines = md.split("\n");
  assert.ok(lines.includes("| Run | acc | f1 | loss |"), md);
  assert.ok(lines.includes("| --- | --- | --- | --- |"), md);
  assert.ok(md.includes("big\\|lr"), md);
  assert.ok(md.startsWith("**Results**"), md);
});

test("latex table is a figure block with escaped cells and caption", () => {
  const tex = resolveResultsTables(serialiseResultsTableRef(["a", "b"], "Results & more"), [A, B], "latex");
  const lines = tex.split("\n");
  assert.equal(lines[0], "\\begin{figure}[ht]");
  assert.equal(lines.at(-1), "\\end{figure}");
  assert.ok(tex.includes("\\begin{tabular}{lrrr}"), tex);
  assert.ok(tex.includes("Run & acc & f1 & loss \\\\"), tex);
  assert.ok(tex.includes("big\\textbar{}lr"), tex);
  assert.ok(tex.includes("\\caption{Results \\& more}"), tex);
});

test("resolve rebuilds tables from current runs, in ref order, on their own lines", () => {
  const body = `Before ${serialiseResultsTableRef(["b", "a"], "R")} after.`;
  const md = resolveResultsTables(body, [A, B], "markdown");
  assert.ok(md.startsWith("Before \n\n**R**"), md);
  assert.ok(md.indexOf("big\\|lr") < md.indexOf("baseline"), md);
  assert.ok(md.endsWith("\n\n after."), md);
  const updated = resolveResultsTables(body, [exp("a", "baseline", { acc: 0.5 }), B], "markdown");
  assert.notEqual(updated, md);
});

test("resolve: unknown ids are skipped; none found is a warning, not a table", () => {
  const partial = resolveResultsTables(serialiseResultsTableRef(["a", "gone"], "R"), [A], "markdown");
  assert.ok(partial.includes("baseline") && partial.includes("1 run not found"), partial);
  const none = resolveResultsTables(serialiseResultsTableRef(["gone"], "R"), [A], "latex");
  assert.ok(!none.includes("tabular") && none.includes("not found"), none);
});

test("resolve leaves a body without table refs untouched", () => {
  const body = "plain ![x](expartifact:a/b.png)";
  assert.equal(resolveResultsTables(body, [A], "latex"), body);
});
