/**
 * The background PDF run stops on sign-out and on a project switch (xstate-03).
 *
 * It kept reading the last project's papers into the next one's index, and
 * `startedFor` kept a new run from starting for a project already seen.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { Paper } from "@weaveforge/core";

import { autoIndexStatus, startAutoIndex, stopAutoIndex, type AutoIndexDeps } from "../application/auto-index-library";
import type { LibraryIndexResult } from "../application/index-library-pdfs";
import { clearSessionCaches } from "@/lib/cache/clear-session-caches";

const store = new Map<string, string>([["thesis.search.pdf-auto", "1"]]);
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};

const EMPTY: LibraryIndexResult = { indexed: 0, skipped: 0, failed: 0, failures: [], reasons: {}, unreadIds: [] };

/** A run that holds until aborted, or until `finish` is called. */
function blockingDeps(projectId: string) {
  const signals: AbortSignal[] = [];
  let finish: (() => void) | null = null;
  const deps: AutoIndexDeps = {
    projectId: () => projectId,
    papersNeedingIndex: async () => [{ id: "p1", title: "One" } as Paper],
    indexLibraryPdfs: (_papers, options) =>
      new Promise((resolve) => {
        signals.push(options!.signal!);
        options!.signal!.addEventListener("abort", () => resolve(EMPTY));
        finish = () => resolve({ ...EMPTY, indexed: 1 });
      }),
  };
  return { deps, signals, finish: () => finish?.() };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

test("stopping aborts the run in flight and clears its state", async () => {
  const run = blockingDeps("A");
  const done = startAutoIndex(0, run.deps);
  await tick();
  assert.equal(autoIndexStatus().running, true);
  stopAutoIndex();
  await done;
  assert.equal(run.signals[0]!.aborted, true);
  assert.equal(autoIndexStatus().running, false);
  assert.equal(autoIndexStatus().last, null, "an aborted run reports no result");
});

test("sign-out aborts the run", async () => {
  const run = blockingDeps("B");
  const done = startAutoIndex(0, run.deps);
  await tick();
  clearSessionCaches();
  await done;
  assert.equal(run.signals[0]!.aborted, true);
  assert.equal(autoIndexStatus().running, false);
});

test("after a stop the same project can run again, and the old run does not end the new one", async () => {
  const first = blockingDeps("C");
  const firstDone = startAutoIndex(0, first.deps);
  await tick();
  stopAutoIndex();

  const second = blockingDeps("C");
  const secondDone = startAutoIndex(0, second.deps);
  await firstDone;
  await tick();
  assert.equal(second.signals.length, 1, "the second run started");
  assert.equal(autoIndexStatus().running, true, "the first run's cleanup left the second one running");
  second.finish();
  await secondDone;
  assert.equal(autoIndexStatus().running, false);
  assert.equal(autoIndexStatus().last?.indexed, 1);
  stopAutoIndex();
});

test("stopping with nothing running is harmless", () => {
  assert.doesNotThrow(() => stopAutoIndex());
  assert.equal(autoIndexStatus().running, false);
});
