import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import type { ManageTagsUseCase, Paper } from "@weaveforge/core";

import { reconcileTagsFromBodyOrDefer, retryDeferredTagReconciles, stopDeferredTagReconcile } from "../note-tags";

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
  removeEventListener: (type: string, fn: () => void) => {
    const i = listeners.indexOf(fn);
    if (type === "online" && i >= 0) listeners.splice(i, 1);
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

describe("the online listener (xstate-05)", () => {
  beforeEach(() => store.clear());

  it("retries with the latest deps, not the ones it was first added with", async () => {
    const firstOpts = { offline: true, summaries: { p1: "#a" } as Record<string, string> };
    const first = fakePapers(firstOpts);
    await reconcileTagsFromBodyOrDefer(first.papers, "p1", "#a");
    const secondOpts = { offline: true, summaries: { p1: "#a", p2: "#b" } as Record<string, string> };
    const second = fakePapers(secondOpts);
    await reconcileTagsFromBodyOrDefer(second.papers, "p2", "#b");
    assert.equal(listeners.length, 1, "one listener, however many deferrals");

    // The first deps are stale (still offline); the latest ones are back online.
    secondOpts.offline = false;
    listeners[0]!();
    await retryDeferredTagReconciles(second.papers);
    assert.equal(first.reconciled.length, 0);
    assert.deepEqual(second.reconciled.map((r) => r.id).sort(), ["p1", "p2"]);
    assert.equal(store.size, 0);
  });

  it("sign-out removes the listener, and a later deferral adds it back", async () => {
    const f = fakePapers({ offline: true, summaries: { p1: "#a" } });
    await reconcileTagsFromBodyOrDefer(f.papers, "p1", "#a");
    assert.equal(listeners.length, 1);
    stopDeferredTagReconcile();
    assert.equal(listeners.length, 0);
    await reconcileTagsFromBodyOrDefer(f.papers, "p1", "#a");
    assert.equal(listeners.length, 1);
    stopDeferredTagReconcile();
  });
});
