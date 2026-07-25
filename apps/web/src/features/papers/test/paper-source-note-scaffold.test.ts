import assert from "node:assert/strict";
import test from "node:test";
import { paperSourceNoteScaffold } from "../application/paper-source-note-scaffold";

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
