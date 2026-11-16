import { test } from "node:test";
import assert from "node:assert/strict";

import { resolveCanvasFile } from "../application/canvas-files";

const DOCS = [
  { kind: "vault_page", id: "n1", title: "Plan", path: "notes/Plan.note.md" },
  { kind: "vault_page", id: "c1", title: "Plan", path: "notes/Plan.canvas" },
  { kind: "paper", id: "p1", title: "Attention Is All You Need", path: "papers/Attention Is All You Need.paper.md" },
  { kind: "paper_pdf", id: "p1", title: "Attention Is All You Need", path: "papers/Attention Is All You Need.pdf" },
];

test("an exact workspace path wins", () => {
  assert.equal(resolveCanvasFile(DOCS, "notes/Plan.canvas")?.id, "c1");
  assert.equal(resolveCanvasFile(DOCS, "papers/Attention Is All You Need.pdf")?.kind, "paper_pdf");
});

test("an Obsidian vault path matches by title, the extension choosing the kind", () => {
  assert.equal(resolveCanvasFile(DOCS, "Projects/Plan.md")?.id, "n1");
  assert.equal(resolveCanvasFile(DOCS, "Projects/plan.canvas")?.id, "c1");
  assert.equal(resolveCanvasFile(DOCS, "Plan")?.id, "n1");
  assert.equal(resolveCanvasFile(DOCS, "attention is all you need.pdf")?.kind, "paper_pdf");
  assert.equal(resolveCanvasFile(DOCS, "Attention Is All You Need.md")?.kind, "paper");
});

test("nothing matches an unknown or empty path", () => {
  assert.equal(resolveCanvasFile(DOCS, "Elsewhere.md"), undefined);
  assert.equal(resolveCanvasFile(DOCS, ""), undefined);
  assert.equal(resolveCanvasFile(DOCS, "img/photo.png"), undefined);
});
