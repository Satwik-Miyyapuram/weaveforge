/**
 * Reader side data (23-03 to 23-08): a failed pin load and a failed in-thread
 * analysis are logged, the in-thread analysis runs once and yields both the
 * analysis and its index, and a pin moves the map and the backlinks together.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { act, create } from "react-test-renderer";
import type { PageTextItem } from "@weaveforge/core";

import { buildReferenceIndex, type ReferencePage } from "../application/reader-references";
import { analyzeInThread } from "../ui/pdf-reader/use-document-analyzer";
import { useAnnotationContext, type AnnotationContext } from "../ui/pdf-reader/use-annotation-context";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Log = { level: string; source: string; message: string; detail?: string };
const logs: Log[] = [];
(globalThis as { window?: unknown }).window = {
  localStorage: { getItem: () => null, setItem: () => {} },
  weaveforge: { fetchTitle: () => Promise.resolve({}), reportAppLog: (entry: Log) => void logs.push(entry) },
};

function run(str: string, y: number, size = 10): PageTextItem {
  return { str, transform: [size, 0, 0, size, 72, y], width: str.length * size * 0.5, height: size, hasEOL: true };
}
const prose = (y: number) => run("Body prose of the paper goes here and here.", y);
const pages: ReferencePage[] = [
  { pageNumber: 1, items: [
    run("Attention [1] works.", 700),
    run("See Fig. 2 for the layout.", 688),
    ...Array.from({ length: 8 }, (_, i) => prose(676 - i * 12)),
  ] },
  { pageNumber: 2, items: [run("Figure 2: The layout.", 640), ...Array.from({ length: 8 }, (_, i) => prose(600 - i * 12))] },
  { pageNumber: 3, items: [
    run("References", 700, 13),
    run("[1] Vaswani A. Attention is all you need. NeurIPS, 2017.", 686),
    run("[2] Devlin J. BERT. NAACL, 2019.", 672),
    run("[3] Smith J. A third entry. JMLR, 2018.", 658),
  ] },
];

test("the in-thread analysis yields the analysis and the same index as buildReferenceIndex (23-07)", () => {
  const result = analyzeInThread(pages, []);
  assert.ok(result);
  const expected = buildReferenceIndex(pages, []);
  assert.equal(result.index.fingerprint, expected.fingerprint);
  assert.ok(expected.references.length > 0);
  assert.equal(result.index.references.length, expected.references.length);
  assert.equal(result.analysis.fingerprint, result.index.fingerprint);
});

test("a failed in-thread analysis is logged, not swallowed (23-08)", () => {
  logs.length = 0;
  const broken = [{ pageNumber: 1, items: null }] as unknown as ReferencePage[];
  assert.equal(analyzeInThread(broken, []), null);
  assert.equal(logs.length, 1);
  assert.equal(logs[0]!.level, "warn");
  assert.equal(logs[0]!.source, "reader");
});

function mountContext(paperId: string | undefined) {
  let ctx: AnnotationContext | null = null;
  function Probe() {
    ctx = useAnnotationContext(paperId, []);
    return null;
  }
  act(() => {
    create(createElement(Probe));
  });
  return () => ctx!;
}

test("a failed pin load is logged (23-03)", async () => {
  logs.length = 0;
  // No container in a test: the load throws.
  const get = mountContext("paper-1");
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  assert.equal(get().pinsByKey.size, 0);
  assert.equal(logs.length, 1);
  assert.equal(logs[0]!.level, "warn");
  assert.match(logs[0]!.message, /pin/i);
});

test("a pin applied locally shows in the pin map, and unpinning removes it (23-04)", async () => {
  const get = mountContext("paper-1");
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  act(() => get().applyPin("k1", "s1", "paper-1"));
  assert.equal(get().pinsByKey.get("k1"), "s1");
  act(() => get().applyPin("k1", "s2", "paper-1"));
  assert.equal(get().pinsByKey.get("k1"), "s2");
  assert.equal(get().pinsByKey.size, 1);
  act(() => get().applyPin("k1", null, "paper-1"));
  assert.equal(get().pinsByKey.has("k1"), false);
});

test("no paper: nothing loads and nothing is logged", async () => {
  logs.length = 0;
  const get = mountContext(undefined);
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  assert.deepEqual(get().backlinkHits, []);
  assert.equal(logs.length, 0);
});