import assert from "node:assert/strict";
import test from "node:test";
import type { Paper, PaperFieldDef, PaperFieldValue } from "@thesis/core";
import {
  extractionCsv,
  extractionMarkdown,
  flattenPaperRows,
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
