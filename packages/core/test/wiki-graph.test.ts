import assert from "node:assert/strict";
import test from "node:test";
import {
  MIN_SEED_DEGREE_FOR_PPR,
  buildWikiGraph,
  explainArm,
  findRelated,
  graphDegrees,
  graphDensity,
  personalizedPageRank,
  relatedByPpr,
  type WorkspaceSnapshot,
} from "../src/index.js";

function snapshot(over: Partial<WorkspaceSnapshot> = {}): WorkspaceSnapshot {
  return {
    papers: [], vaultPages: [], readingLists: [], readingListItems: [],
    reportSections: [], experiments: [], milestones: [], logEntries: [],
    relations: [], tags: [], collectedAt: "2026-08-05T00:00:00.000Z", ...over,
  };
}

const note = (id: string, title: string, body = "") =>
  ({ id, title, body, sortOrder: 0, createdAt: "", updatedAt: "" }) as never;

const paper = (id: string, title: string, summary = "", tags: string[] = []) =>
  ({ id, title, summary, authors: [], tags, createdAt: "", updatedAt: "" }) as never;

/** Deterministic PRNG so walk-based assertions are stable. */
function seededRng(seed = 42): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

// ------------------------------------------------------------------- graph

test("wikilinks become edges in both directions", () => {
  const graph = buildWikiGraph(
    snapshot({ vaultPages: [note("a", "Method", "See [[Baselines]]."), note("b", "Baselines")] }),
  );

  assert.deepEqual(graph.edges.get("note:a"), ["note:b"]);
  assert.deepEqual(graph.edges.get("note:b"), ["note:a"], "relatedness is symmetric");
});

test("link targets resolve note before paper before section", () => {
  const graph = buildWikiGraph(
    snapshot({
      vaultPages: [note("a", "Source", "[[Attention]]"), note("n", "Attention")],
      papers: [paper("p", "Attention")],
    }),
  );

  assert.deepEqual(graph.edges.get("note:a"), ["note:n"], "the note wins the title");
});

test("an unresolvable link is dropped, not turned into a phantom node", () => {
  const graph = buildWikiGraph(snapshot({ vaultPages: [note("a", "A", "[[Nothing here]]")] }));

  assert.deepEqual(graph.edges.get("note:a"), []);
  assert.deepEqual(graph.nodes, ["note:a"]);
});

test("a self-link does not create a loop", () => {
  const graph = buildWikiGraph(snapshot({ vaultPages: [note("a", "Method", "[[Method]]")] }));

  assert.deepEqual(graph.edges.get("note:a"), []);
});

test("stated paper relations are first-class edges", () => {
  const graph = buildWikiGraph(
    snapshot({
      papers: [paper("p1", "One"), paper("p2", "Two")],
      relations: [{ id: "r", fromPaper: "p1", toPaper: "p2", relation: "extends", source: "manual" } as never],
    }),
  );

  assert.deepEqual(graph.edges.get("paper:p1"), ["paper:p2"]);
});

test("shared tags connect documents nobody linked by hand", () => {
  const graph = buildWikiGraph(
    snapshot({
      vaultPages: [note("a", "A", "#vae"), note("b", "B", "#vae")],
    }),
  );

  assert.deepEqual(graph.edges.get("note:a"), ["note:b"]);
});

test("a tag on too many documents is skipped rather than drowning real links", () => {
  // 20 notes sharing one tag would contribute ~380 edges; the cap keeps the
  // graph's signal from being swamped by a single label.
  const many = Array.from({ length: 20 }, (_, i) => note(`n${i}`, `N${i}`, "#everything"));
  const graph = buildWikiGraph(snapshot({ vaultPages: many }));

  assert.deepEqual(graph.edges.get("note:n0"), []);
});

test("degrees count links per node", () => {
  const graph = buildWikiGraph(
    snapshot({
      vaultPages: [note("hub", "Hub", "[[A]] [[B]]"), note("a", "A"), note("b", "B")],
    }),
  );

  const degrees = graphDegrees(graph);
  assert.equal(degrees.get("note:hub"), 2);
  assert.equal(degrees.get("note:a"), 1);
});

test("density reports what it measures, including the empty case", () => {
  const empty = graphDensity(buildWikiGraph(snapshot()));
  assert.deepEqual(empty, { nodes: 0, edges: 0, meanDegree: 0, largestComponentRatio: 0 });

  const linked = graphDensity(
    buildWikiGraph(snapshot({ vaultPages: [note("a", "A", "[[B]]"), note("b", "B")] })),
  );
  assert.equal(linked.nodes, 2);
  assert.equal(linked.edges, 1);
  assert.equal(linked.largestComponentRatio, 1);
});

test("density spots a disconnected workspace", () => {
  const graph = buildWikiGraph(
    snapshot({ vaultPages: [note("a", "A", "[[B]]"), note("b", "B"), note("c", "C")] }),
  );

  assert.ok(graphDensity(graph).largestComponentRatio < 1);
});

// --------------------------------------------------------------------- PPR

function hubGraph() {
  return buildWikiGraph(
    snapshot({
      vaultPages: [
        note("seed", "Seed", "[[Hub]]"),
        note("hub", "Hub", "[[Leaf1]] [[Leaf2]] [[Leaf3]]"),
        note("l1", "Leaf1"), note("l2", "Leaf2"), note("l3", "Leaf3"),
      ],
    }),
  );
}

test("PPR is deterministic under a fixed seed", () => {
  const graph = hubGraph();
  const first = personalizedPageRank(graph, "note:seed", { rng: seededRng(), numWalks: 200 });
  const second = personalizedPageRank(graph, "note:seed", { rng: seededRng(), numWalks: 200 });

  assert.deepEqual([...first.entries()], [...second.entries()]);
});

test("scores are a probability distribution", () => {
  const scores = personalizedPageRank(hubGraph(), "note:seed", { rng: seededRng(), numWalks: 300 });
  const total = [...scores.values()].reduce((sum, n) => sum + n, 0);

  assert.ok(Math.abs(total - 1) < 1e-9);
});

test("a directly linked hub outranks a node two hops away", () => {
  const scores = personalizedPageRank(hubGraph(), "note:seed", { rng: seededRng(), numWalks: 2_000 });

  assert.ok((scores.get("note:hub") ?? 0) > (scores.get("note:l1") ?? 0));
});

test("an isolated seed keeps its own probability rather than inventing neighbours", () => {
  const graph = buildWikiGraph(snapshot({ vaultPages: [note("lonely", "Lonely")] }));
  const scores = personalizedPageRank(graph, "note:lonely", { rng: seededRng(), numWalks: 50 });

  assert.deepEqual(relatedByPpr(graph, "note:lonely", 5, { rng: seededRng() }), []);
  assert.equal(scores.get("note:lonely"), 1);
});

test("an unknown seed returns nothing instead of throwing", () => {
  assert.equal(personalizedPageRank(hubGraph(), "note:missing").size, 0);
});

test("related excludes the seed and is ordered by score", () => {
  const related = relatedByPpr(hubGraph(), "note:seed", 3, { rng: seededRng(), numWalks: 2_000 });

  assert.ok(!related.some((hit) => hit.id === "note:seed"));
  assert.equal(related[0]!.id, "note:hub");
  for (let i = 1; i < related.length; i += 1) {
    assert.ok(related[i - 1]!.score >= related[i]!.score);
  }
});

// ----------------------------------------------------------------- cascade

test("a well-connected seed uses the graph arm", () => {
  const result = findRelated("note:hub", { graph: hubGraph() }, 5, { rng: seededRng(), numWalks: 500 });

  assert.ok(result.length > 0);
  assert.equal(result[0]!.arm, "graph");
});

test("a sparse seed falls back to lexical rather than returning nothing", () => {
  const graph = buildWikiGraph(snapshot({ vaultPages: [note("a", "A"), note("b", "B")] }));

  const result = findRelated("note:a", {
    graph,
    lexical: () => [{ id: "note:b", score: 0.4 }],
  });

  assert.equal(result[0]!.arm, "lexical");
  assert.equal(result[0]!.id, "note:b");
});

test("tags are the last resort before giving up", () => {
  const graph = buildWikiGraph(snapshot({ vaultPages: [note("a", "A")] }));

  const result = findRelated("note:a", {
    graph,
    lexical: () => [],
    tagged: () => [{ id: "note:z", score: 0.1 }],
  });

  assert.equal(result[0]!.arm, "tags");
});

test("an empty workspace returns nothing without throwing", () => {
  const graph = buildWikiGraph(snapshot());

  assert.deepEqual(findRelated("note:none", { graph }), []);
});

test("the PPR threshold is what decides the arm", () => {
  // Two links is below the bar; the walk has too little to say.
  const thin = buildWikiGraph(
    snapshot({
      vaultPages: [note("s", "S", "[[A]] [[B]]"), note("a", "A"), note("b", "B")],
    }),
  );
  assert.ok((graphDegrees(thin).get("note:s") ?? 0) < MIN_SEED_DEGREE_FOR_PPR);

  const result = findRelated("note:s", { graph: thin, lexical: () => [{ id: "note:a", score: 1 }] });
  assert.equal(result[0]!.arm, "lexical");
});

test("every arm has an explanation for the UI", () => {
  for (const arm of ["graph", "lexical", "tags", "none"] as const) {
    assert.ok(explainArm(arm).length > 0);
  }
});
