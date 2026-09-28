import { test } from "node:test";
import assert from "node:assert/strict";
import type { ReportSection, ReportSectionTreeNode } from "@weaveforge/core";
import { outlineProgress, sectionProgress } from "../lib/section-progress";

function node(wordCount: number, targetWords: number | null, children: ReportSectionTreeNode[] = []): ReportSectionTreeNode {
  return { section: { wordCount, targetWords } as ReportSection, children };
}

test("a leaf measures its own words", () => {
  assert.deepEqual(sectionProgress(node(400, 800)), { words: 400, target: 800, pct: 50 });
  assert.deepEqual(sectionProgress(node(120, null)), { words: 120, target: null, pct: null });
});

test("a chapter counts its subsections' words against its own target", () => {
  const intro = node(10, 2500, [node(780, 900), node(400, 800), node(0, 300)]);
  assert.deepEqual(sectionProgress(intro), { words: 1190, target: 2500, pct: 48 });
});

test("a chapter with no target aims for its subsections' total, capped at 100", () => {
  const ch = node(0, null, [node(900, 900), node(300, 200)]);
  assert.deepEqual(sectionProgress(ch), { words: 1200, target: 1100, pct: 100 });
});

test("the outline adds up top-level sections only", () => {
  const roots = [node(10, 2500, [node(780, 900)]), node(0, 1000)];
  assert.deepEqual(outlineProgress(roots), { words: 790, target: 3500, pct: 23 });
});
