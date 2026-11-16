/**
 * The button's PDF run can be stopped, and lives outside Settings (rubric 7, 11).
 *
 * A 2,000-paper run takes about 100 minutes; it had no Cancel and its progress
 * died with the Settings screen. It now shares the background run's status and
 * controller, so the nav chip shows it and either place can stop it.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { Paper } from "@weaveforge/core";

import {
  autoIndexStatus,
  cancelLibraryIndex,
  runLibraryIndex,
  startAutoIndex,
  stopAutoIndex,
  type AutoIndexDeps,
} from "../application/parts-1";
import type { LibraryIndexResult } from "../application/parts-1";

const store = new Map<string, string>([["thesis.search.pdf-auto", "1"]]);
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};

const EMPTY: LibraryIndexResult = { indexed: 0, skipped: 0, failed: 0, failures: [], reasons: {}, unreadIds: [] };

/** A run that reports one paper done, then holds until aborted (partial result) or finished. */
function blockingDeps(projectId: string) {
  const signals: AbortSignal[] = [];
  let finish: (() => void) | null = null;
  const deps: AutoIndexDeps = {
    projectId: () => projectId,
    papersNeedingIndex: async () => [{ id: "p1", title: "One" } as Paper, { id: "p2", title: "Two" } as Paper],
    indexLibraryPdfs: (_papers, options) =>
      new Promise((resolve) => {
        signals.push(options!.signal!);
        options!.onProgress?.({ done: 1, total: 2, current: "Two", indexed: 1, skipped: 0, failed: 0 });
        options!.signal!.addEventListener("abort", () => resolve({ ...EMPTY, indexed: 1 }));
        finish = () => resolve({ ...EMPTY, indexed: 2 });
      }),
  };
  return { deps, signals, finish: () => finish?.() };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

test("the button's run shows in the shared status and Cancel keeps its partial result", async () => {
  const run = blockingDeps("A");
  const done = runLibraryIndex(run.deps);
  await tick();
  assert.equal(autoIndexStatus().running, true);
  assert.equal(autoIndexStatus().source, "button");
  assert.equal(autoIndexStatus().progress?.done, 1);
  cancelLibraryIndex();
  const result = await done;
  assert.equal(run.signals[0]!.aborted, true);
  assert.equal(result?.indexed, 1);
  assert.equal(autoIndexStatus().running, false);
  assert.equal(autoIndexStatus().source, null);
  assert.equal(autoIndexStatus().stopped, true, "the status says it was stopped, not finished");
  assert.equal(autoIndexStatus().last?.indexed, 1);
  stopAutoIndex();
});

test("a finished button run is not marked stopped", async () => {
  const run = blockingDeps("B");
  const done = runLibraryIndex(run.deps);
  await tick();
  run.finish();
  assert.equal((await done)?.indexed, 2);
  assert.equal(autoIndexStatus().stopped, false);
  assert.equal(autoIndexStatus().last?.indexed, 2);
  stopAutoIndex();
});

test("the button does not start a second run over one already going", async () => {
  const background = blockingDeps("C");
  const first = startAutoIndex(0, background.deps);
  await tick();
  const button = blockingDeps("C");
  assert.equal(await runLibraryIndex(button.deps), null);
  assert.equal(button.signals.length, 0);
  cancelLibraryIndex();
  await first;
  assert.equal(autoIndexStatus().running, false);
  stopAutoIndex();
});

test("cancelling the background run does not restart it for the same project", async () => {
  const first = blockingDeps("D");
  const done = startAutoIndex(0, first.deps);
  await tick();
  cancelLibraryIndex();
  await done;
  const again = blockingDeps("D");
  await startAutoIndex(0, again.deps);
  assert.equal(again.signals.length, 0, "a stop the reader asked for holds for this session");
  stopAutoIndex();
});

test("a project switch mid-run drops the button's result", async () => {
  const run = blockingDeps("E");
  const done = runLibraryIndex(run.deps);
  await tick();
  stopAutoIndex();
  await done;
  assert.equal(autoIndexStatus().last, null);
  assert.equal(autoIndexStatus().running, false);
});

test("cancel with nothing running is harmless", () => {
  assert.doesNotThrow(() => cancelLibraryIndex());
  assert.equal(autoIndexStatus().running, false);
});
