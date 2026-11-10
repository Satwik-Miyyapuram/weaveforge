import { before, describe, it } from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_GRAPH_SETTINGS, type ColorGroup, type Paper, type PaperRelation } from "@weaveforge/core";
import { readyCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";

before(async () => {
  await loadTestCore();
});

const palette = () => readyCore().graphPalette();
const ramp = (t: number) => readyCore().rampColour(t);

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

/** The colour a single paper gets from the custom-group rules, or undefined when none match. */
function groupColour(groups: ColorGroup[], s: { title: string; tags: string[]; status: string; lists: string[] }): string | undefined {
  const node = { id: "p", label: s.title, color: "", paperId: "p" };
  readyCore().recolourNodes([node], [], "groups", groups, {
    papers: new Map([["p", { id: "p", title: s.title, status: s.status, tags: s.tags }]]),
    noteTags: new Map(),
    membership: new Map(s.lists.map((_, i) => [`L${i}`, new Set(["p"])])),
    lists: s.lists.map((name, i) => ({ id: `L${i}`, name })),
  });
  return node.color === palette().uncoloured ? undefined : node.color;
}

describe("rampColour", () => {
  it("runs from the pale end to the deep end and clamps", () => {
    assert.equal(ramp(0), "#e8d9b0");
    assert.equal(ramp(1), "#2f4b6e");
    assert.equal(ramp(-3), ramp(0));
    assert.equal(ramp(9), ramp(1));
    assert.equal(ramp(Number.NaN), ramp(0));
  });
});

describe("yearColours", () => {
  it("spreads the years present across the ramp", () => {
    const c = new Map(readyCore().yearColours([["a", 2000], ["b", 2010], ["c", 2020]]));
    assert.equal(c.get("a"), ramp(0));
    assert.equal(c.get("b"), ramp(0.5));
    assert.equal(c.get("c"), ramp(1));
  });

  it("puts a single year mid-ramp", () => {
    assert.equal(new Map(readyCore().yearColours([["a", 2019]])).get("a"), ramp(0.5));
  });
});

describe("degreeColours", () => {
  it("scales by the square root, so hubs do not wash everyone else out", () => {
    const c = new Map(readyCore().degreeColours([["hub", 16], ["mid", 4], ["none", 0]]));
    assert.equal(c.get("hub"), ramp(1));
    assert.equal(c.get("mid"), ramp(0.5));
    assert.equal(c.get("none"), ramp(0));
  });
});

describe("communities", () => {
  it("finds two triangles joined by nothing, biggest first", () => {
    const index = new Map(readyCore().communities(
      ["a", "b", "c", "d", "e", "f", "g", "lone"],
      [["a", "b"], ["b", "c"], ["c", "a"], ["a", "d"], ["d", "e"], ["e", "f"], ["f", "g"], ["g", "e"], ["f", "e"]],
    ));
    assert.equal(index.get("a"), index.get("b"));
    assert.equal(index.get("b"), index.get("c"));
    assert.equal(index.get("e"), index.get("f"));
    assert.equal(index.get("f"), index.get("g"));
    assert.notEqual(index.get("a"), index.get("e"));
    assert.equal(index.has("lone"), false);
  });

  it("is deterministic", () => {
    const edges: Array<[string, string]> = [["x", "y"], ["y", "z"], ["p", "q"]];
    const sorted = (m: Map<string, number>) => [...m].sort();
    assert.deepEqual(
      sorted(new Map(readyCore().communities(["x", "y", "z", "p", "q"], edges))),
      sorted(new Map(readyCore().communities(["q", "p", "z", "y", "x"], edges))),
    );
  });
});

describe("group rules", () => {
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
      readyCore().buildGraphData(papers, relations, { ...DEFAULT_GRAPH_SETTINGS, colorBy, ...extra }).data.nodes.map((n) => [n.id, n.color]),
    );

  it("keeps status colours by default", () => {
    assert.equal(colours("status").get("a"), palette().readingStatus.to_read);
  });

  it("gives every paper one colour by type", () => {
    assert.equal(colours("type").get("a"), palette().paper);
  });

  it("ramps by year and greys papers without one", () => {
    const c = colours("year");
    assert.equal(c.get("a"), ramp(0));
    assert.equal(c.get("b"), ramp(1));
    assert.equal(c.get("c"), palette().uncoloured);
  });

  it("colours a linked chain as one cluster", () => {
    const c = colours("cluster");
    assert.equal(c.get("a"), palette().cluster[0]);
    assert.equal(c.get("c"), palette().cluster[0]);
  });

  it("applies custom groups and greys the rest", () => {
    const c = colours("groups", { colorGroups: [{ query: "paper b", color: "#123456" }] });
    assert.equal(c.get("b"), "#123456");
    assert.equal(c.get("a"), palette().uncoloured);
  });
});
