import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_GRAPH_SETTINGS, type Paper, type PaperRelation } from "@weaveforge/core";
import { buildGraphData } from "../application/build-graph-data";
import {
  CLUSTER_PALETTE,
  UNCOLOURED,
  communities,
  degreeColours,
  groupColour,
  rampColour,
  yearColours,
} from "../application/node-colouring";
import { PAPER_COLOR, STATUS_COLORS } from "../domain/graph-palette";

function paper(id: string, extra: Partial<Paper> = {}): Paper {
  return {
    id,
    title: `Paper ${id}`,
    authors: [],
    status: "to_read",
    tags: [],
    metadata: {},
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...extra,
  };
}

function cites(from: string, to: string): PaperRelation {
  return { id: `${from}-${to}`, fromPaper: from, toPaper: to, relation: "cites", source: "manual", createdAt: "2026-01-01T00:00:00.000Z" };
}

describe("rampColour", () => {
  it("runs from the pale end to the deep end and clamps", () => {
    assert.equal(rampColour(0), "#e8d9b0");
    assert.equal(rampColour(1), "#2f4b6e");
    assert.equal(rampColour(-3), rampColour(0));
    assert.equal(rampColour(9), rampColour(1));
    assert.equal(rampColour(Number.NaN), rampColour(0));
  });
});

describe("yearColours", () => {
  it("spreads the years present across the ramp", () => {
    const c = yearColours(new Map([["a", 2000], ["b", 2010], ["c", 2020]]));
    assert.equal(c.get("a"), rampColour(0));
    assert.equal(c.get("b"), rampColour(0.5));
    assert.equal(c.get("c"), rampColour(1));
  });

  it("puts a single year mid-ramp", () => {
    assert.equal(yearColours(new Map([["a", 2019]])).get("a"), rampColour(0.5));
  });
});

describe("degreeColours", () => {
  it("scales by the square root, so hubs do not wash everyone else out", () => {
    const c = degreeColours(new Map([["hub", 16], ["mid", 4], ["none", 0]]));
    assert.equal(c.get("hub"), rampColour(1));
    assert.equal(c.get("mid"), rampColour(0.5));
    assert.equal(c.get("none"), rampColour(0));
  });
});

describe("communities", () => {
  it("finds two triangles joined by nothing, biggest first", () => {
    const index = communities(
      ["a", "b", "c", "d", "e", "f", "g", "lone"],
      [["a", "b"], ["b", "c"], ["c", "a"], ["a", "d"], ["d", "e"], ["e", "f"], ["f", "g"], ["g", "e"], ["f", "e"]],
    );
    assert.equal(index.get("a"), index.get("b"));
    assert.equal(index.get("b"), index.get("c"));
    assert.equal(index.get("e"), index.get("f"));
    assert.equal(index.get("f"), index.get("g"));
    assert.notEqual(index.get("a"), index.get("e"));
    assert.equal(index.has("lone"), false);
  });

  it("is deterministic", () => {
    const edges: Array<[string, string]> = [["x", "y"], ["y", "z"], ["p", "q"]];
    assert.deepEqual([...communities(["x", "y", "z", "p", "q"], edges)], [...communities(["q", "p", "z", "y", "x"], edges)]);
  });
});

describe("groupColour", () => {
  const subject = { title: "Attention is all you need", tags: ["ml", "NLP"], status: "to_read", lists: ["Thesis"] };

  it("matches tag, list, status and title words, first rule wins", () => {
    assert.equal(groupColour([{ query: "tag:#nlp", color: "#111111" }], subject), "#111111");
    assert.equal(groupColour([{ query: "list:thesis", color: "#222222" }], subject), "#222222");
    assert.equal(groupColour([{ query: "status:to read", color: "#333333" }], subject), "#333333");
    assert.equal(groupColour([{ query: "attention", color: "#444444" }, { query: "tag:ml", color: "#555555" }], subject), "#444444");
  });

  it("ignores empty rules and misses", () => {
    assert.equal(groupColour([{ query: " ", color: "#111111" }, { query: "tag:cv", color: "#222222" }], subject), undefined);
  });
});

describe("buildGraphData colour modes", () => {
  const papers = [paper("a", { year: 2001 }), paper("b", { year: 2021 }), paper("c")];
  const relations = [cites("a", "b"), cites("b", "c")];
  const colours = (colorBy: typeof DEFAULT_GRAPH_SETTINGS.colorBy, extra = {}) =>
    new Map(
      buildGraphData(papers, relations, { ...DEFAULT_GRAPH_SETTINGS, colorBy, ...extra }).data.nodes.map((n) => [n.id, n.color]),
    );

  it("keeps status colours by default", () => {
    assert.equal(colours("status").get("a"), STATUS_COLORS.to_read);
  });

  it("gives every paper one colour by type", () => {
    assert.equal(colours("type").get("a"), PAPER_COLOR);
  });

  it("ramps by year and greys papers without one", () => {
    const c = colours("year");
    assert.equal(c.get("a"), rampColour(0));
    assert.equal(c.get("b"), rampColour(1));
    assert.equal(c.get("c"), UNCOLOURED);
  });

  it("colours a linked chain as one cluster", () => {
    const c = colours("cluster");
    assert.equal(c.get("a"), CLUSTER_PALETTE[0]);
    assert.equal(c.get("c"), CLUSTER_PALETTE[0]);
  });

  it("applies custom groups and greys the rest", () => {
    const c = colours("groups", { colorGroups: [{ query: "paper b", color: "#123456" }] });
    assert.equal(c.get("b"), "#123456");
    assert.equal(c.get("a"), UNCOLOURED);
  });
});
