import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_GRAPH_SETTINGS, type Paper, type PaperRelation } from "@weaveforge/core";
import { buildGraphData } from "../application/build-graph-data";
import { tagColor } from "../domain/graph-palette";

function paper(id: string, title: string, tags: string[] = []): Paper {
  return {
    id,
    title,
    authors: [],
    status: "to_read",
    tags,
    metadata: {},
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function relation(id: string, from: string, to: string): PaperRelation {
  return {
    id,
    fromPaper: from,
    toPaper: to,
    relation: "cites",
    source: "manual",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("tagColor", () => {
  it("is stable for the same tag", () => {
    assert.equal(tagColor("ml"), tagColor("ml"));
  });

  it("differs for different tags", () => {
    assert.notEqual(tagColor("ml"), tagColor("nlp"));
  });
});

describe("buildGraphData", () => {
  it("builds citation edges in cites mode", () => {
    const papers = [paper("p1", "One"), paper("p2", "Two")];
    const relations = [relation("r1", "p1", "p2")];
    const { data, neighbors } = buildGraphData(
      papers,
      relations,
      { ...DEFAULT_GRAPH_SETTINGS, edgeMode: "cites", hideOrphans: false },
    );
    assert.equal(data.nodes.length, 2);
    assert.equal(data.links.length, 1);
    assert.equal(data.links[0]!.kind, "rel");
    assert.ok(neighbors.get("p1")?.has("p2"));
  });

  it("hides orphan papers when hideOrphans is true", () => {
    const papers = [paper("p1", "Lonely"), paper("p2", "Also alone")];
    const { data } = buildGraphData(
      papers,
      [],
      { ...DEFAULT_GRAPH_SETTINGS, edgeMode: "cites", hideOrphans: true },
    );
    assert.equal(data.nodes.length, 0);
  });

  it("adds tag nodes and paper-tag links in tags mode", () => {
    const papers = [
      paper("p1", "A", ["ml"]),
      paper("p2", "B", ["ml", "nlp"]),
    ];
    const { data } = buildGraphData(papers, [], {
      ...DEFAULT_GRAPH_SETTINGS,
      edgeMode: "tags",
      showConcepts: true,
      minConceptDegree: 1,
      hideOrphans: false,
    });
    const tagNodes = data.nodes.filter((n) => n.kind === "tag");
    assert.ok(tagNodes.some((n) => n.tagName === "ml"));
    assert.ok(data.links.some((l) => l.kind === "tag"));
  });

  it("filters rare tags by minConceptDegree", () => {
    const papers = [
      paper("p1", "A", ["common"]),
      paper("p2", "B", ["common"]),
      paper("p3", "C", ["rare"]),
    ];
    const { data } = buildGraphData(papers, [], {
      ...DEFAULT_GRAPH_SETTINGS,
      edgeMode: "tags",
      showConcepts: true,
      minConceptDegree: 2,
      hideOrphans: false,
    });
    const tagNames = data.nodes.filter((n) => n.kind === "tag").map((n) => n.tagName);
    assert.ok(tagNames.includes("common"));
    assert.ok(!tagNames.includes("rare"));
  });

  it("builds tagToPapers index", () => {
    const papers = [paper("p1", "A", ["x"]), paper("p2", "B", ["x", "y"])];
    const { tagToPapers } = buildGraphData(papers, [], {
      ...DEFAULT_GRAPH_SETTINGS,
      edgeMode: "tags",
      hideOrphans: false,
    });
    assert.deepEqual(tagToPapers.get("x")?.sort(), ["p1", "p2"]);
    assert.deepEqual(tagToPapers.get("y"), ["p2"]);
  });

  it("adds note nodes linked to hashtags in body", () => {
    const notes = [
      {
        id: "n1",
        title: "Ideas",
        body: "Working on #ml and #nlp topics.",
        sortOrder: 0,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    const { data, tagToNotes } = buildGraphData([], [], {
      ...DEFAULT_GRAPH_SETTINGS,
      edgeMode: "tags",
      showConcepts: true,
      minConceptDegree: 1,
      hideOrphans: false,
    }, new Map(), [], notes);
    assert.ok(data.nodes.some((n) => n.kind === "note" && n.id === "n1"));
    assert.ok(data.links.some((l) => l.kind === "tag" && l.source === "n1"));
    assert.deepEqual(tagToNotes.get("ml"), ["n1"]);
  });
});

describe("buildGraphData wikilinks", () => {
  const note = (id: string, title: string, body: string) => ({
    id, title, body, sortOrder: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });

  it("adds note→note and note→paper edges from [[wikilinks]]", () => {
    const papers = [paper("p1", "One")];
    const notes = [
      note("n1", "Alpha", "see [[Beta]] and [[One]]"),
      note("n2", "Beta", "back to [[alpha]]"),
    ];
    const { data } = buildGraphData(papers, [], DEFAULT_GRAPH_SETTINGS, new Map(), [], notes);
    const wl = data.links.filter((l) => l.kind === "wikilink");
    assert.ok(wl.some((l) => l.source === "n1" && l.target === "n2"), "note→note");
    assert.ok(wl.some((l) => l.source === "n1" && l.target === "p1"), "note→paper");
    assert.ok(wl.some((l) => l.source === "n2" && l.target === "n1"), "case-insensitive back-link");
    // linked paper stays visible even with no tags/relations
    assert.ok(data.nodes.some((n) => n.id === "p1"));
  });

  it("adds report nodes and wikilinks from paper/section writing surfaces", () => {
    const papers = [paper("p1", "One")];
    papers[0]!.summary = "Mentions [[Intro]]";
    const sections = [
      {
        id: "s1",
        title: "Intro",
        status: "drafting" as const,
        wordCount: 10,
        notes: "See [[One]]",
        sortOrder: 0,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    const { data } = buildGraphData(
      papers,
      [],
      { ...DEFAULT_GRAPH_SETTINGS, hideOrphans: true },
      new Map(),
      [],
      [],
      sections,
    );
    assert.ok(data.nodes.some((n) => n.kind === "report" && n.id === "s1"));
    const wl = data.links.filter((l) => l.kind === "wikilink");
    assert.ok(wl.some((l) => l.source === "p1" && l.target === "s1"), "paper→section");
    assert.ok(wl.some((l) => l.source === "s1" && l.target === "p1"), "section→paper");
  });
});

describe("timeline layout inputs", () => {
  it("carries a publication year onto paper nodes, and omits one that is missing", () => {
    const dated: Paper = { ...paper("p1", "Dated"), year: 2017 };
    const undated = paper("p2", "Undated");
    const { data } = buildGraphData(
      [dated, undated],
      [relation("r1", "p1", "p2")],
      DEFAULT_GRAPH_SETTINGS,
    );

    const byId = new Map(data.nodes.map((n) => [n.id, n]));
    assert.equal(byId.get("p1")?.year, 2017);
    // Not zero, and not a guessed default: the timeline force skips a node
    // with no year rather than planting it on a date nobody recorded.
    assert.equal(byId.get("p2")?.year, undefined);
  });

  it("ignores a year that is not a finite number", () => {
    const broken = { ...paper("p1", "Broken"), year: Number.NaN } as Paper;
    const { data } = buildGraphData([broken], [], DEFAULT_GRAPH_SETTINGS);
    assert.equal(data.nodes.find((n) => n.id === "p1")?.year, undefined);
  });
});

/**
 * Experiments on the citation graph.
 *
 * A run is drawn hanging off the paper it tests, which is the only link the
 * entity carries. The interesting cases are the two ways that link can be
 * missing, because both produce a node nothing connects to — and an edge to
 * nowhere is what the final link filter would silently drop while leaving the
 * node behind.
 */
describe("experiment nodes", () => {
  const run = (id: string, name: string, relatedPaper?: string) => ({
    id,
    name,
    status: "planned",
    ...(relatedPaper ? { relatedPaper } : {}),
  });

  it("draws a run attached to the paper it tests", () => {
    const { data } = buildGraphData(
      [paper("p1", "One")],
      [],
      { ...DEFAULT_GRAPH_SETTINGS, hideOrphans: false },
      new Map(),
      [],
      [],
      [],
      [run("e1", "Ablation", "p1")],
    );

    const node = data.nodes.find((n) => n.id === "e1");
    assert.equal(node?.kind, "experiment");
    assert.equal(node?.label, "Ablation");
    assert.equal(node?.experimentId, "e1");
    const link = data.links.find((l) => l.kind === "experiment");
    assert.equal(link?.source, "p1");
    assert.equal(link?.target, "e1");
  });

  it("leaves a run with no paper off the graph, rather than as a floating node", () => {
    const { data } = buildGraphData(
      [paper("p1", "One")],
      [],
      { ...DEFAULT_GRAPH_SETTINGS, hideOrphans: false },
      new Map(),
      [],
      [],
      [],
      [run("e1", "Unlinked")],
    );
    assert.equal(data.nodes.some((n) => n.id === "e1"), false);
  });

  it("leaves a run whose paper is not in the graph off it too", () => {
    // The paper exists in the project but is not among the papers handed to the
    // builder — filtered out by a tag or list selection upstream. Keeping the
    // node would leave one edge the link filter then drops, so the canvas would
    // show a run connected to nothing.
    const { data } = buildGraphData(
      [paper("p1", "One")],
      [],
      { ...DEFAULT_GRAPH_SETTINGS, hideOrphans: false },
      new Map(),
      [],
      [],
      [],
      [run("e1", "Orphaned run", "p-missing")],
    );
    assert.equal(data.nodes.some((n) => n.id === "e1"), false);
    assert.equal(data.links.some((l) => l.kind === "experiment"), false);
  });

  it("makes the run a neighbour of its paper, so hovering one lights the other", () => {
    // `neighbors` is built from the links and is what the canvas reads to dim
    // everything not connected to the hovered node. A run whose edge existed but
    // whose adjacency did not would hover as an isolated dot beside the paper it
    // belongs to.
    //
    // This replaced a test asserting the paper's *node* grows when a run is
    // attached. That was wrong about the code: a paper's `val` is computed where
    // the paper node is created, which is before this loop runs, so the degree
    // the loop used to bump on the paper changed nothing the canvas reads. The
    // bump was removed and the claim replaced with one the data model actually
    // makes.
    const { neighbors } = buildGraphData(
      [paper("p1", "One")],
      [],
      { ...DEFAULT_GRAPH_SETTINGS, hideOrphans: false },
      new Map(),
      [],
      [],
      [],
      [run("e1", "Ablation", "p1")],
    );
    assert.equal(neighbors.get("p1")?.has("e1"), true);
    assert.equal(neighbors.get("e1")?.has("p1"), true);
  });
});
