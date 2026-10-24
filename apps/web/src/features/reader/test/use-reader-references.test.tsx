/**
 * Reference lookups (24-14 to 24-17): the dead link toggle is gone, a lookup
 * that lands after the document changed writes nothing, the prefetch queue
 * reads the current resolutions, and a failed prefetch is logged.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import type { PageTextItem, ParsedReference } from "@weaveforge/core";

import type { ResolvedReference } from "../application/reference-lookup";
import { useReaderReferences } from "../ui/pdf-reader/use-reader-references";

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
// The three-page document from reader-references.test.ts: three entries.
const pageItems = new Map<number, readonly PageTextItem[]>([
  [1, [
    run("Attention [1] works.", 700),
    run("See Fig. 2 for the layout.", 688),
    ...Array.from({ length: 8 }, (_, i) => prose(676 - i * 12)),
  ]],
  [2, [run("Figure 2: The layout.", 640), ...Array.from({ length: 8 }, (_, i) => prose(600 - i * 12))]],
  [3, [
    run("References", 700, 13),
    run("[1] Vaswani A. Attention is all you need. NeurIPS, 2017.", 686),
    run("[2] Devlin J. BERT. NAACL, 2019.", 672),
    run("[3] Smith J. A third entry. JMLR, 2018.", 658),
  ]],
]);
const noLinks = new Map();
const noOutline: never[] = [];

type Lookup = (key: string, entry: ParsedReference) => Promise<ResolvedReference>;
type Refs = ReturnType<typeof useReaderReferences>;

function mount(contentHash: string, lookup: Lookup, items = pageItems) {
  let refs: Refs | null = null;
  function Probe({ hash, pages }: { hash: string; pages: typeof pageItems }) {
    refs = useReaderReferences({
      pageItems: pages,
      pageLinks: noLinks,
      outline: noOutline,
      contentHash: hash,
      setPage: () => {},
      lookup,
    });
    return null;
  }
  let root: ReactTestRenderer | null = null;
  act(() => {
    root = create(createElement(Probe, { hash: contentHash, pages: items }));
  });
  return {
    get: () => refs!,
    rerender: (hash: string, pages = items) =>
      act(() => root!.update(createElement(Probe, { hash, pages }))),
    unmount: () => act(() => root!.unmount()),
  };
}

const found = (title: string): ResolvedReference =>
  ({ status: "resolved", metadata: { title }, sourceId: "test" }) as ResolvedReference;

test("the hook no longer offers a citation-link toggle (24-14)", () => {
  const h = mount("", async () => found("x"), new Map());
  assert.equal("toggle" in h.get(), false);
  assert.equal("enabled" in h.get(), false);
  h.unmount();
});

test("a lookup that lands after the document changed writes nothing (24-15)", async () => {
  let settle: (v: ResolvedReference) => void = () => {};
  const h = mount("", () => new Promise((r) => (settle = r)), new Map());
  const entry = { index: 7, raw: "x", title: "x", authors: [], page: 1, x: 0, y: 0 } as ParsedReference;
  act(() => h.get().ensureResolved(entry));
  assert.equal(h.get().resolutions.get(7)?.status, "pending");
  h.rerender("other-doc", new Map());
  assert.equal(h.get().resolutions.size, 0);
  await act(async () => {
    settle(found("late"));
    await new Promise((r) => setTimeout(r, 0));
  });
  assert.equal(h.get().resolutions.has(7), false);
  h.unmount();
});

test("the prefetch queue skips an entry resolved meanwhile (24-16)", async () => {
  const calls: number[] = [];
  const pending = new Map<number, (v: ResolvedReference) => void>();
  const h = mount("doc", (_key, entry) => {
    calls.push(entry.index);
    return new Promise((r) => pending.set(entry.index, r));
  });
  assert.equal(h.get().index.references.length, 3);
  act(() => h.get().startPrefetch());
  assert.deepEqual(calls, [1]);
  // The popover asks for entry 2 directly while the queue waits on entry 1.
  act(() => h.get().ensureResolved(h.get().index.byIndex.get(2)!));
  await act(async () => {
    pending.get(2)!(found("two"));
    await new Promise((r) => setTimeout(r, 0));
  });
  await act(async () => {
    pending.get(1)!(found("one"));
    await new Promise((r) => setTimeout(r, 1100));
  });
  // Entry 2 is not looked up a second time; the queue moves on to entry 3.
  assert.deepEqual(calls, [1, 2, 3]);
  h.get().stopPrefetch();
  h.unmount();
});

test("a failed prefetch is logged and marked unresolved (24-17)", async () => {
  logs.length = 0;
  const h = mount("doc", async () => {
    throw new Error("lookup down");
  });
  await act(async () => {
    h.get().startPrefetch();
    await new Promise((r) => setTimeout(r, 0));
  });
  h.get().stopPrefetch();
  assert.equal(h.get().resolutions.get(1)?.status, "unresolved");
  assert.equal(logs.length, 1);
  assert.equal(logs[0]!.source, "reader.references");
  assert.match(logs[0]!.detail ?? "", /lookup down/);
  h.unmount();
});