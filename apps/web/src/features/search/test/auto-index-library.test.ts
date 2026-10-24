/**
 * The background PDF indexer (B64).
 *
 * - 27-09: turning it off and on again starts a new run.
 * - 27-10: turning it off during the start delay ends the run at once.
 * - 27-11: two papers with the same title keep separate failure records.
 */
import assert from "node:assert/strict";
import test from "node:test";

import type { Paper } from "@weaveforge/core";
import {
  autoIndexStatus,
  setAutoIndexDeps,
  setAutoIndexEnabled,
  startAutoIndex,
  type AutoIndexDeps,
} from "../application/auto-index-library";
import type { LibraryIndexResult } from "../application/index-library-pdfs";

const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};

const paper = (id: string, title: string) => ({ id, title }) as Paper;

function result(over: Partial<LibraryIndexResult> = {}): LibraryIndexResult {
  return { indexed: 0, skipped: 0, failed: 0, failures: [], reasons: {}, unreadIds: [], ...over };
}

function deps(projectId: string, over: Partial<AutoIndexDeps> = {}) {
  const runs: string[][] = [];
  const d: AutoIndexDeps = {
    projectId: () => projectId,
    papersNeedingIndex: async () => [paper("a", "Same"), paper("b", "Same")],
    indexLibraryPdfs: async (papers) => {
      runs.push(papers.map((p) => p.id));
      return result({ indexed: papers.length });
    },
    ...over,
  };
  setAutoIndexDeps(d);
  return runs;
}

test("off then on starts a new run for the same project (27-09)", async () => {
  store.clear();
  store.set("thesis.search.pdf-auto", "1");
  const runs = deps("p-toggle");
  await startAutoIndex(0);
  assert.equal(runs.length, 1);
  setAutoIndexEnabled(false);
  setAutoIndexEnabled(true);
  for (let i = 0; i < 20 && autoIndexStatus().running; i += 1) await new Promise((r) => setTimeout(r, 5));
  assert.equal(runs.length, 2);
});

test("a second start in the same session for the same project is a no-op", async () => {
  store.clear();
  store.set("thesis.search.pdf-auto", "1");
  const runs = deps("p-once");
  await startAutoIndex(0);
  await startAutoIndex(0);
  assert.equal(runs.length, 1);
});

test("turning it off during the start delay ends the run at once (27-10)", async () => {
  store.clear();
  store.set("thesis.search.pdf-auto", "1");
  const runs = deps("p-delay");
  const run = startAutoIndex(60_000);
  assert.equal(autoIndexStatus().running, true);
  setAutoIndexEnabled(false);
  const settled = await Promise.race([run.then(() => "done"), new Promise((r) => setTimeout(() => r("stuck"), 200))]);
  assert.equal(settled, "done");
  assert.equal(autoIndexStatus().running, false);
  assert.equal(runs.length, 0);
});

test("papers with the same title keep separate failure records (27-11)", async () => {
  store.clear();
  store.set("thesis.search.pdf-auto", "1");
  deps("p-same-title", {
    indexLibraryPdfs: async () =>
      result({ failed: 2, failures: ["Same", "Same"], reasons: { Same: "x" }, unreadIds: ["a", "b"] }),
  });
  await startAutoIndex(0);
  const failed = JSON.parse(store.get("thesis.search.pdf-auto-failed") ?? "{}") as Record<string, number>;
  assert.deepEqual(Object.keys(failed).sort(), ["a", "b"]);
});

test("recorded failures are not retried on the next project's run", async () => {
  store.clear();
  store.set("thesis.search.pdf-auto", "1");
  store.set("thesis.search.pdf-auto-failed", JSON.stringify({ a: Date.now() }));
  const runs = deps("p-skip-failed");
  await startAutoIndex(0);
  assert.deepEqual(runs, [["b"]]);
});
