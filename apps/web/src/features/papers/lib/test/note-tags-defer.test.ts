import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import type { ManageTagsUseCase, Paper } from "@weaveforge/core";

import { reconcileTagsFromBodyOrDefer, retryDeferredTagReconciles } from "../note-tags";

/** Just enough of `window` for the deferral: storage and the `online` event. */
const store = new Map<string, string>();
const listeners: (() => void)[] = [];
(globalThis as { window?: unknown }).window = {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
  addEventListener: (type: string, fn: () => void) => {
    if (type === "online") listeners.push(fn);
  },
};

const paper = (id: string, summary: string) => ({ id, summary, tags: [] }) as unknown as Paper;

function fakePapers(opts: { offline: boolean; summaries: Record<string, string> }) {
  const reconciled: { id: string; tags: string[] }[] = [];
  const manageTags = {
    reconcileSources: async (id: string, items: { name: string }[]) => {
      if (opts.offline) throw new TypeError("Failed to fetch (could not reach api.weaveforge.org)");
      reconciled.push({ id, tags: items.map((i) => i.name) });
      return paper(id, opts.summaries[id] ?? "");
    },
  } as unknown as ManageTagsUseCase;
  return {
    reconciled,
    papers: {
      manageTags,
      getPaper: async (id: string) => paper(id, opts.summaries[id] ?? ""),
    },
  };
}

describe("reconcileTagsFromBodyOrDefer", () => {
  beforeEach(() => store.clear());

  it("reconciles straight away when the server answers", async () => {
    const f = fakePapers({ offline: false, summaries: { p1: "#a" } });
    const out = await reconcileTagsFromBodyOrDefer(f.papers, "p1", "#a #b");
    assert.equal(out?.id, "p1");
    assert.deepEqual(f.reconciled, [{ id: "p1", tags: ["a", "b"] }]);
  });

  it("defers with no network, then reconciles from the current body once online", async () => {
    const opts = { offline: true, summaries: { p1: "#a" } };
    const f = fakePapers(opts);
    assert.equal(await reconcileTagsFromBodyOrDefer(f.papers, "p1", "#a"), null);
    assert.equal(f.reconciled.length, 0);

    // The note was edited again before the connection came back.
    opts.summaries.p1 = "#a #later";
    opts.offline = false;
    for (const fn of listeners) fn();
    await retryDeferredTagReconciles(f.papers);
    assert.deepEqual(f.reconciled, [{ id: "p1", tags: ["a", "later"] }]);
    assert.equal(store.size, 0);
  });

  it("still throws a refusal the server did send", async () => {
    const f = fakePapers({ offline: false, summaries: {} });
    f.papers.manageTags.reconcileSources = async () => {
      throw { message: "permission denied for table paper_tags", code: "42501" };
    };
    await assert.rejects(reconcileTagsFromBodyOrDefer(f.papers, "p1", "#a"));
    assert.equal(store.size, 0);
  });
});
