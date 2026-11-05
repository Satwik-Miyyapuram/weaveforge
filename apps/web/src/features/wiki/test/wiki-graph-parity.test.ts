import { before, test } from "node:test";
import assert from "node:assert/strict";
import * as ts from "@weaveforge/core";
import type { RustCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";

// Proves the Rust wiki-link graph (buildWikiGraph, graphDegrees, graphDensity) returns exactly
// what the TS originals in packages/core/src/search/wiki-graph.ts return.

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

/** JSON round trip: TS leaves `undefined` keys that serde omits; both mean "absent". */
const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value)) as unknown;

type Snapshot = Parameters<typeof ts.buildWikiGraph>[0];
type Graph = ReturnType<typeof ts.buildWikiGraph>;

/** Edges as rows, so the comparison also checks insertion order, which the TS Map keeps. */
const rows = (graph: Graph) => ({ nodes: [...graph.nodes], edges: [...graph.edges] });

/** Only the lists the graph reads matter; the rest are empty, as a fresh workspace has them. */
function snapshot(
  papers: unknown[],
  vaultPages: unknown[],
  reportSections: unknown[] = [],
  relations: unknown[] = [],
): Snapshot {
  return {
    papers,
    vaultPages,
    reportSections,
    relations,
    readingLists: [],
    readingListItems: [],
    experiments: [],
    milestones: [],
    logEntries: [],
    tags: [],
    readerAnnotations: [],
    collectedAt: "2026-11-05T00:00:00.000Z",
  } as unknown as Snapshot;
}

const IDS = ["a", "B", "é", "Z", "ǆ", "n-1", "é"];
// Case, Unicode case folding, NBSP, ideographic space, BOM and an empty title.
const TITLES = [
  "Intro", "intro", "  INTRO  ", "Ölçü", "ölçü", "ǆ", "Ǆ", "Straße", "STRASSE",
  "emoji 🙂", "a b", "a b", "x y", "bom﻿", "Other", "",
];
const TARGETS = [...TITLES, "Nope", "Intro|alias"];
const TAGS = ["ml", "ML", "ölçü", "é"];

/** Up to three links (some missing, some self), a code-masked link, hashtags and prose. */
function body(rand: () => number): string {
  const parts: string[] = [];
  const count = Math.floor(rand() * 4);
  for (let i = 0; i < count; i += 1) {
    const roll = rand();
    parts.push(
      roll < 0.6 ? `[[${pick(rand, TARGETS)}]]`
        : roll < 0.7 ? "`[[Intro]]`"
        : roll < 0.85 ? `#${pick(rand, TAGS)}`
        : pick(rand, ["prose", "  "]),
    );
  }
  return parts.join(" ");
}

function randomSnapshot(rand: () => number): Snapshot {
  const size = (max: number) => Math.floor(rand() * max);
  const papers = Array.from({ length: size(5) }, () => ({
    id: pick(rand, IDS),
    title: pick(rand, TITLES),
    summary: rand() < 0.5 ? body(rand) : null,
    tags: Array.from({ length: size(3) }, () => pick(rand, TAGS)),
  }));
  const vaultPages = Array.from({ length: size(5) }, () => {
    const title = pick(rand, TITLES);
    // Some notes link to their own title.
    return { id: pick(rand, IDS), title, body: rand() < 0.2 ? `[[${title}]] ${body(rand)}` : body(rand) };
  });
  const reportSections = Array.from({ length: size(3) }, () => ({
    id: pick(rand, IDS),
    title: pick(rand, TITLES),
    notes: rand() < 0.5 ? body(rand) : null,
  }));
  const relationIds = [...IDS, "ghost"];
  const relations = Array.from({ length: size(3) }, () => ({
    fromPaper: pick(rand, relationIds),
    toPaper: pick(rand, relationIds),
  }));
  return snapshot(papers, vaultPages, reportSections, relations);
}

/** Builds from the snapshot, then checks the derived measures on the TS graph (same input to both). */
function assertSameGraph(snap: Snapshot, label: string): void {
  const want = ts.buildWikiGraph(snap);
  assert.deepEqual(rows(rs.buildWikiGraph(snap)), rows(want), `${label} build`);
  assert.deepEqual([...rs.graphDegrees(want)], [...ts.graphDegrees(want)], `${label} degrees`);
  assert.deepEqual(plain(rs.graphDensity(want)), plain(ts.graphDensity(want)), `${label} density`);
}

test("buildWikiGraph, graphDegrees and graphDensity match TS on 300 seeded snapshots", () => {
  for (let seed = 1; seed <= 300; seed += 1) {
    assertSameGraph(randomSnapshot(random(seed)), `seed ${seed}`);
  }
});

test("empty snapshot and one-node graph: density has no division by zero on either side", () => {
  assertSameGraph(snapshot([], []), "empty");
  assertSameGraph(snapshot([], [{ id: "a", title: "Intro", body: "no links" }]), "one node");
  const none = { nodes: [], edges: new Map<string, string[]>() };
  const lone = { nodes: ["note:a"], edges: new Map([["note:a", []]]) };
  for (const graph of [none, lone]) {
    assert.deepEqual([...rs.graphDegrees(graph)], [...ts.graphDegrees(graph)]);
    assert.deepEqual(plain(rs.graphDensity(graph)), plain(ts.graphDensity(graph)));
  }
});

test("hand-built graphs: node without an edges entry, edge to an unlisted node, repeated neighbour", () => {
  const hand = [
    { nodes: ["x"], edges: new Map<string, string[]>() },
    { nodes: ["a"], edges: new Map([["a", ["ghost"]]]) },
    { nodes: ["a", "b"], edges: new Map([["a", ["b", "b"]], ["b", ["a"]]]) },
  ];
  for (const graph of hand) {
    assert.deepEqual([...rs.graphDegrees(graph)], [...ts.graphDegrees(graph)]);
    assert.deepEqual(plain(rs.graphDensity(graph)), plain(ts.graphDensity(graph)));
  }
});

test("links to missing pages, self links and duplicate links add no extra edges", () => {
  const snap = snapshot(
    [{ id: "p1", title: "Paper", summary: "[[Missing]] [[Paper]] [[Note]] [[Note]]", tags: [] }],
    [{ id: "n1", title: "Note", body: "[[Note]] [[Paper]] [[Paper]] [[Nope]]" }],
  );
  assertSameGraph(snap, "missing/self/duplicate");
});

test("title keys: case, Unicode folding, NBSP, ideographic space and BOM resolve as TS does", () => {
  const snap = snapshot(
    [
      { id: "p1", title: "ǆ", summary: "[[Ǆ]] [[a b]] [[bom]]", tags: [] },
      { id: "p2", title: "a b", summary: "[[A B]]", tags: ["ml"] },
      { id: "p3", title: "x y", summary: "[[X Y]] [[ Ölçü ]]", tags: [] },
    ],
    [
      { id: "n1", title: "bom﻿", body: "[[BOM]] [[﻿bom]] [[STRASSE]] [[straße]] [[ÖLÇÜ]]" },
      { id: "n2", title: "Straße", body: "[[ölçü]] #ML #ml" },
      { id: "n3", title: "Ölçü", body: "[[emoji 🙂]] [[Emoji 🙂]]" },
      { id: "n4", title: "emoji 🙂", body: "" },
    ],
  );
  assertSameGraph(snap, "unicode keys");
});

test("shared-tag fan-out: 12 documents on one tag connect, 13 do not", () => {
  for (const count of [2, 12, 13]) {
    const notes = Array.from({ length: count }, (_, i) => ({ id: `n${i}`, title: `T${i}`, body: "#shared" }));
    assertSameGraph(snapshot([], notes), `fan-out ${count}`);
  }
});
