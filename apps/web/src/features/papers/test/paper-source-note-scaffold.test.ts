import assert from "node:assert/strict";
import test from "node:test";
import type { Paper } from "@weaveforge/core";
import { paperSourceNoteScaffold, scaffoldNewPaperNote } from "../application/paper-source-note-scaffold";
import { EMPTY_PAPER_SUMMARY, isEmptyPaperSummary } from "@/lib/paper-summary";

test("paperSourceNoteScaffold includes metadata headings and fields", () => {
  const body = paperSourceNoteScaffold({
    title: "Attention",
    authors: ["Vaswani"],
    year: 2017,
    doi: "10.1/attn",
    citeKey: "vaswani2017",
  });
  assert.match(body, /^## Summary/m);
  assert.match(body, /^## Key points/m);
  assert.match(body, /DOI: 10\.1\/attn/);
  assert.match(body, /Cite key: vaswani2017/);
});

const newPaper = (over: Partial<Paper> = {}) =>
  ({ id: "0123456789abcdef", title: "Attention", authors: [], ...over }) as Paper;

function summaryStore() {
  const writes: string[] = [];
  return {
    writes,
    setSummary: async (id: string, summary: string) => {
      writes.push(summary);
      return { ...newPaper(), id, summary } as Paper;
    },
  };
}

test("isEmptyPaperSummary: none, blank and the placeholder are empty (25-23)", () => {
  assert.equal(EMPTY_PAPER_SUMMARY, "No summary yet.");
  assert.equal(isEmptyPaperSummary(undefined), true);
  assert.equal(isEmptyPaperSummary(""), true);
  assert.equal(isEmptyPaperSummary("  \n"), true);
  assert.equal(isEmptyPaperSummary("No summary yet."), true);
  assert.equal(isEmptyPaperSummary(" No summary yet.\n"), true);
  assert.equal(isEmptyPaperSummary("No summary yet. But a thought."), false);
  assert.equal(isEmptyPaperSummary("A summary"), false);
});

test("a new paper's note is scaffolded and the scaffolded paper is returned (25-02)", async () => {
  const store = summaryStore();
  const out = await scaffoldNewPaperNote(newPaper({ summary: EMPTY_PAPER_SUMMARY }), store);
  assert.equal(store.writes.length, 1);
  assert.equal(out.summary, store.writes[0]);
  assert.match(out.summary ?? "", /^## Summary/m);
});

test("the scaffold's cite key follows resolveCiteKey (25-21)", async () => {
  const store = summaryStore();
  await scaffoldNewPaperNote(newPaper({ bibtex: "@article{vaswani2017attn,\n title={A}}" }), store);
  assert.match(store.writes[0]!, /Cite key: vaswani2017attn/);
  await scaffoldNewPaperNote(newPaper({ doi: "10.1/x" }), store);
  assert.match(store.writes[1]!, /Cite key: doi_10_1_x/);
});

test("a paper that already has a summary is left alone", async () => {
  const store = summaryStore();
  const p = newPaper({ summary: "Mine." });
  assert.equal(await scaffoldNewPaperNote(p, store), p);
  assert.deepEqual(store.writes, []);
});
