/**
 * Paper titles on experiment cards are read in one request (35-15).
 *
 * Each card asks for its run's paper. Asked in the same tick, the facade
 * gathers them into one batch read; a lone request still goes through the
 * single read, which the read memo serves.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { ExperimentsFacade } from "../facades/experiments";

function papers(held: string[], batch = true) {
  const calls = { getById: [] as string[], listByIds: [] as string[][] };
  const p: Record<string, unknown> = {
    getById: async (id: string) => {
      calls.getById.push(id);
      return held.includes(id) ? { id, title: `T ${id}` } : null;
    },
  };
  if (batch) {
    p.listByIds = async (ids: readonly string[]) => {
      calls.listByIds.push([...ids]);
      // Ordered by id, not by request, as the PostgREST repository answers.
      return [...ids]
        .sort()
        .filter((id) => held.includes(id))
        .map((id) => ({ id, title: `T ${id}` }));
    };
  }
  return { papers: p as never, calls };
}

function facade(p: never) {
  return new ExperimentsFacade({
    load: {} as never,
    experiments: {} as never,
    papers: p,
    metrics: {} as never,
    manageExperiment: {} as never,
    artifacts: {} as never,
  });
}

test("N cards: 1 papers request", async () => {
  const p = papers(["a", "b", "c"]);
  const f = facade(p.papers);
  const titles = await Promise.all(["c", "a", "b", "a"].map((id) => f.getPaper(id)));
  assert.deepEqual(p.calls.listByIds, [["c", "a", "b"]]);
  assert.deepEqual(p.calls.getById, []);
  assert.deepEqual(titles.map((t) => t?.title), ["T c", "T a", "T b", "T a"]);
});

test("a paper that is not found resolves to null, the others still resolve", async () => {
  const p = papers(["a"]);
  const f = facade(p.papers);
  const [a, gone] = await Promise.all([f.getPaper("a"), f.getPaper("gone")]);
  assert.equal(a?.title, "T a");
  assert.equal(gone, null);
});

test("a lone request uses the single (memoised) read", async () => {
  const p = papers(["a"]);
  const f = facade(p.papers);
  assert.equal((await f.getPaper("a"))?.title, "T a");
  assert.deepEqual(p.calls.getById, ["a"]);
  assert.equal(p.calls.listByIds.length, 0);
});

test("the same id asked twice in one tick is a lone request", async () => {
  const p = papers(["a"]);
  const f = facade(p.papers);
  await Promise.all([f.getPaper("a"), f.getPaper("a")]);
  assert.deepEqual(p.calls.getById, ["a"]);
  assert.equal(p.calls.listByIds.length, 0);
});

test("requests in later ticks are separate batches", async () => {
  const p = papers(["a", "b", "c", "d"]);
  const f = facade(p.papers);
  await Promise.all([f.getPaper("a"), f.getPaper("b")]);
  await Promise.all([f.getPaper("c"), f.getPaper("d")]);
  assert.deepEqual(p.calls.listByIds, [["a", "b"], ["c", "d"]]);
});

test("a failed batch rejects every request in it, and the next batch still runs", async () => {
  let fail = true;
  const f = facade({
    getById: async () => null,
    listByIds: async (ids: readonly string[]) => {
      if (fail) throw new Error("offline");
      return ids.map((id) => ({ id, title: id }));
    },
  } as never);
  const results = await Promise.allSettled([f.getPaper("a"), f.getPaper("b")]);
  assert.deepEqual(results.map((r) => r.status), ["rejected", "rejected"]);
  fail = false;
  const again = await Promise.all([f.getPaper("a"), f.getPaper("b")]);
  assert.deepEqual(again.map((p) => p?.id), ["a", "b"]);
});

test("without a batch read, each paper is read on its own", async () => {
  const p = papers(["a", "b"], false);
  const f = facade(p.papers);
  await Promise.all([f.getPaper("a"), f.getPaper("b")]);
  assert.deepEqual(p.calls.getById.sort(), ["a", "b"]);
});
