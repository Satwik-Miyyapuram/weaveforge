import assert from "node:assert/strict";
import test from "node:test";
import type { AiWriteProposal, Paper, PaperFieldDef, PaperFieldValue } from "@weaveforge/core";
import { encodeRollupOptions } from "@weaveforge/core";
import {
  buildProposeFillPrompt,
  emptyCellPaperIds,
  extractionCsv,
  extractionMarkdown,
  flattenPaperRows,
  pendingFieldFills,
  pendingKey,
} from "../application/extraction-table";

function paper(id: string, title: string): Paper {
  return {
    id,
    title,
    authors: [],
    status: "to_read",
    tags: [],
    metadata: {},
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

const defs: PaperFieldDef[] = [
  { id: "f1", name: "Method", kind: "text", options: [], sortOrder: 0 },
];

const values: PaperFieldValue[] = [
  { id: "v1", paperId: "p1", fieldId: "f1", value: "RL" },
];

test("flattenPaperRows keeps list order and skips duplicates", () => {
  const rows = flattenPaperRows(
    [paper("p2", "B"), paper("p1", "A")],
    ["p1", "p2", "p1", "missing"],
    values,
  );
  assert.deepEqual(
    rows.map((r) => r.paper.id),
    ["p1", "p2"],
  );
  assert.equal(rows[0]!.values.get("f1"), "RL");
});

test("extractionMarkdown and CSV include selected columns", () => {
  const rows = flattenPaperRows([paper("p1", "A")], ["p1"], values);
  const columns = ["title", "field:f1"] as const;
  assert.match(extractionMarkdown(rows, defs, columns), /\| Title \| Method \|/);
  assert.match(extractionMarkdown(rows, defs, columns), /\| A \| RL \|/);
  assert.equal(extractionCsv(rows, defs, columns), "Title,Method\nA,RL");
});

test("pendingFieldFills joins paper_field_value proposals (Option B test path)", () => {
  const proposals: AiWriteProposal[] = [
    {
      id: "prop-1",
      kind: "paper_field_value",
      resourceId: "p2",
      content: "Set Method",
      createdAt: "2026-07-27T00:00:00.000Z",
      status: "pending",
      sourceLinks: [],
      payload: { paperId: "p2", fieldId: "f1", value: "VAE" },
    },
    {
      id: "prop-2",
      kind: "append_paper_note",
      resourceId: "p1",
      content: "note",
      createdAt: "2026-07-27T00:00:00.000Z",
      status: "pending",
      sourceLinks: [],
      payload: { addition: "x" },
    },
    {
      id: "prop-3",
      kind: "paper_field_value",
      resourceId: "p1",
      content: "other field",
      createdAt: "2026-07-27T00:00:00.000Z",
      status: "pending",
      sourceLinks: [],
      payload: { paperId: "p1", fieldId: "f2", value: 3 },
    },
  ];
  assert.deepEqual(pendingFieldFills(proposals, "f1"), [
    { proposalId: "prop-1", paperId: "p2", fieldId: "f1", preview: "VAE" },
  ]);
  assert.equal(pendingKey("p2", "f1"), "p2::f1");
});

test("emptyCellPaperIds and buildProposeFillPrompt target empty cells", () => {
  const rows = flattenPaperRows(
    [paper("p1", "A"), paper("p2", "B")],
    ["p1", "p2"],
    values,
  );
  assert.deepEqual(emptyCellPaperIds(rows, "f1"), ["p2"]);
  assert.deepEqual(
    emptyCellPaperIds(rows, "f1", new Set([pendingKey("p2", "f1")])),
    [],
  );
  const prompt = buildProposeFillPrompt({
    listId: "list-1",
    fieldId: "f1",
    fieldName: "Method",
    papers: [{ id: "p2", title: "B" }],
  });
  assert.match(prompt, /propose_paper_field_value/);
  assert.match(prompt, /quoteExact/);
  assert.match(prompt, /p2 — B/);
  assert.match(prompt, /list-1/);
});

/**
 * A budget rather than a stopwatch, following `paste-stress.test.ts`: the point
 * is to fail loudly if the table goes quadratic again, not to measure a machine.
 */
const TABLE_BUDGET_MS = 1500;

test("a large extraction table is built in time proportional to its size", () => {
  // This was quadratic twice over: every row scanned *every* project value to
  // find its own, and every rollup cell rebuilt the whole value index. At these
  // numbers that is 400 × 20 000 scans plus 1 200 index builds — tens of
  // millions of operations, seconds of blocking the main thread — against
  // something that should be a few milliseconds.
  const papers = 400;
  const valuesPerPaper = 50;

  const allPapers = Array.from({ length: papers }, (_, index) => paper(`p${index}`, `Paper ${index}`));
  const allValues: PaperFieldValue[] = allPapers.flatMap((row, index) =>
    Array.from({ length: valuesPerPaper }, (_, field) => ({
      id: `v${index}-${field}`,
      paperId: row.id,
      fieldId: `f${field}`,
      value: field,
    })),
  );
  const defs: PaperFieldDef[] = [
    { id: "rel", name: "Related", kind: "relation", options: [], sortOrder: 0 },
    { id: "src", name: "Score", kind: "number", options: [], sortOrder: 1 },
    ...Array.from({ length: 3 }, (_, index) => ({
      id: `rollup${index}`,
      name: `Rollup ${index}`,
      kind: "rollup" as const,
      options: encodeRollupOptions({ relationFieldId: "rel", sourceFieldId: "src", agg: "sum" }),
      sortOrder: 2 + index,
    })),
  ];

  const startedAt = Date.now();
  const rows = flattenPaperRows(
    allPapers,
    allPapers.map((row) => row.id),
    allValues,
    defs,
  );
  const elapsed = Date.now() - startedAt;

  assert.equal(rows.length, papers);
  assert.ok(
    elapsed < TABLE_BUDGET_MS,
    `building ${papers} rows took ${elapsed}ms, over the ${TABLE_BUDGET_MS}ms budget — suspect a complexity change`,
  );
});
