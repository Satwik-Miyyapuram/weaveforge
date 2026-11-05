import { before, test } from "node:test";
import assert from "node:assert/strict";
import * as ts from "@weaveforge/core";
import type { RustCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";

// Proves the Rust Monte Carlo PPR (personalizedPageRank, relatedByPpr) returns exactly what the TS
// originals in packages/core/src/search/personalized-pagerank.ts return, given the same rng.

let rs: RustCore;
before(async () => {
  rs = await loadTestCore();
});

/** Mulberry32, so a failure reproduces from the seed. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rand: () => number, items: readonly T[]): T {
  return items[Math.floor(rand() * items.length)]!;
}

type Graph = Parameters<typeof ts.personalizedPageRank>[0];
type Options = { numWalks?: number; maxSteps?: number; damping?: number };

// Case, accent and decomposed-accent ids: byte order and localeCompare disagree on these.
const IDS = ["a", "B", "é", "Z", "ǆ", "Ö", "n-1", "", "é"];
const DAMPING = [0, 0.15, 0.5, 1];

/** Undirected graph with isolated nodes, several components and dead ends. */
function randomGraph(rand: () => number): Graph {
  const nodes = IDS.filter(() => rand() < 0.7);
  const edges = new Map<string, string[]>(nodes.map((node): [string, string[]] => [node, []]));
  const link = (from: string, to: string) => {
    const list = edges.get(from);
    if (list && !list.includes(to)) list.push(to);
  };
  const pairs = Math.floor(rand() * 10);
  for (let i = 0; i < pairs && nodes.length > 1; i += 1) {
    const a = pick(rand, nodes);
    const b = pick(rand, nodes);
    if (a === b) continue;
    link(a, b);
    link(b, a);
  }
  return { nodes, edges };
}

function randomOptions(rand: () => number): Options {
  return {
    numWalks: 50 + Math.floor(rand() * 150),
    maxSteps: 1 + Math.floor(rand() * 30),
    damping: pick(rand, DAMPING),
  };
}

/** Same nodes in the same order (first-visit order), scores within 1e-12. */
function assertSameScores(got: Map<string, number>, want: Map<string, number>, label: string): void {
  assert.deepEqual([...got.keys()], [...want.keys()], `${label} nodes`);
  for (const [node, score] of got) {
    assert.ok(Math.abs(score - (want.get(node) ?? NaN)) <= 1e-12, `${label} score ${node}`);
  }
}

function assertSameRelated(
  got: { id: string; score: number | null }[],
  want: { id: string; score: number }[],
  label: string,
): void {
  assert.deepEqual(
    got.map((row) => row.id),
    want.map((row) => row.id),
    `${label} ids`,
  );
  got.forEach((row, i) => {
    assert.ok(Math.abs((row.score ?? NaN) - (want[i]?.score ?? NaN)) <= 1e-12, `${label} score ${row.id}`);
  });
}

/** Both sides, each with a fresh rng from the same seed. */
function assertSameBoth(graph: Graph, node: string, options: Options, label: string): void {
  assertSameScores(
    rs.personalizedPageRank(graph, node, { ...options, rng: random(7) }),
    ts.personalizedPageRank(graph, node, { ...options, rng: random(7) }),
    `${label} ppr`,
  );
  assertSameRelated(
    rs.relatedByPpr(graph, node, 10, { ...options, rng: random(7) }),
    ts.relatedByPpr(graph, node, 10, { ...options, rng: random(7) }),
    `${label} related`,
  );
}

/** Teleport draws never teleport; index draws cycle, so each seed neighbour is picked once per 8 steps. */
function cyclicRng(): () => number {
  const picks = [0.125, 0.5, 0.375, 0.5, 0.625, 0.5, 0.875, 0.5];
  let call = 0;
  return () => {
    const draw = call;
    call += 1;
    return draw % 2 === 0 ? 0.5 : (picks[((draw - 1) / 2) % picks.length] ?? 0.5);
  };
}

test("personalizedPageRank matches TS on 300 seeded graphs, seeds and options", () => {
  for (let seed = 1; seed <= 300; seed += 1) {
    const graphRand = random(seed);
    const graph = randomGraph(graphRand);
    const node = pick(graphRand, [...graph.nodes, "ghost"]);
    const options = randomOptions(graphRand);
    const want = ts.personalizedPageRank(graph, node, { ...options, rng: random(seed) });
    const got = rs.personalizedPageRank(graph, node, { ...options, rng: random(seed) });
    assertSameScores(got, want, `seed ${seed}`);
  }
});

test("relatedByPpr matches TS on 300 seeded graphs, including limit 0 and past the result count", () => {
  for (let seed = 1; seed <= 300; seed += 1) {
    const graphRand = random(seed);
    const graph = randomGraph(graphRand);
    const node = pick(graphRand, [...graph.nodes, "ghost"]);
    const options = randomOptions(graphRand);
    const limit = Math.floor(graphRand() * 11);
    const want = ts.relatedByPpr(graph, node, limit, { ...options, rng: random(seed) });
    const got = rs.relatedByPpr(graph, node, limit, { ...options, rng: random(seed) });
    assertSameRelated(got, want, `seed ${seed}`);
  }
});

test("tied scores sort by id as localeCompare does (a, B, é, Z), not by byte order", () => {
  const graph: Graph = {
    nodes: ["s", "a", "B", "é", "Z"],
    edges: new Map([
      ["s", ["a", "B", "é", "Z"]],
      ["a", ["s"]],
      ["B", ["s"]],
      ["é", ["s"]],
      ["Z", ["s"]],
    ]),
  };
  const options = { numWalks: 1, maxSteps: 8 };
  const want = ts.relatedByPpr(graph, "s", 10, { ...options, rng: cyclicRng() });
  const got = rs.relatedByPpr(graph, "s", 10, { ...options, rng: cyclicRng() });
  assert.deepEqual(want.map((row) => row.id), ["a", "B", "é", "Z"]);
  assertSameRelated(got, want, "ties");
});

test("unknown seed, empty graph and empty-string seed id", () => {
  const empty: Graph = { nodes: [], edges: new Map<string, string[]>() };
  const emptyId: Graph = { nodes: [""], edges: new Map<string, string[]>([["", []]]) };
  const cases: [Graph, string][] = [[empty, "a"], [emptyId, ""], [emptyId, "ghost"]];
  for (const [graph, node] of cases) assertSameBoth(graph, node, { numWalks: 20, maxSteps: 5 }, node || "empty");
});

test("disconnected components are never reached; an isolated seed keeps all probability", () => {
  const graph: Graph = {
    nodes: ["a", "b", "x", "y", "lonely"],
    edges: new Map([
      ["a", ["b"]],
      ["b", ["a"]],
      ["x", ["y"]],
      ["y", ["x"]],
      ["lonely", []],
    ]),
  };
  for (const node of ["a", "lonely"]) assertSameBoth(graph, node, { numWalks: 200, maxSteps: 10 }, node);
});

test("graph from ts.buildWikiGraph: every node as seed, default walk options", () => {
  const graph = ts.buildWikiGraph(
    {
      papers: [
        { id: "a", title: "Alpha", summary: "[[Beta]]", tags: ["ml"] },
        { id: "B", title: "Beta", summary: "[[Alpha]] [[é]]", tags: ["ml"] },
        { id: "é", title: "é", summary: null, tags: ["ml"] },
        { id: "Z", title: "Zeta", summary: "[[Missing]]", tags: [] },
      ],
      vaultPages: [],
      reportSections: [],
      relations: [{ fromPaper: "Z", toPaper: "a" }],
      readingLists: [],
      readingListItems: [],
      experiments: [],
      milestones: [],
      logEntries: [],
      tags: [],
      readerAnnotations: [],
      collectedAt: "2026-11-05T00:00:00.000Z",
    } as unknown as Parameters<typeof ts.buildWikiGraph>[0],
  );
  for (const node of graph.nodes) assertSameBoth(graph, node, {}, `${node} default`);
});
