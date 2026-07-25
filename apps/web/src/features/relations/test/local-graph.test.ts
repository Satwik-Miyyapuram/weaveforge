import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  cloneLinks,
  filterGraphByNodes,
  linkNodeId,
  localSubgraph,
} from "../application/local-graph";

describe("linkNodeId", () => {
  it("returns string sources unchanged", () => {
    assert.equal(linkNodeId("a"), "a");
  });

  it("reads id from object sources", () => {
    assert.equal(linkNodeId({ id: "b" }), "b");
  });
});

describe("localSubgraph", () => {
  const neighbors = new Map<string, Set<string>>([
    ["a", new Set(["b", "c"])],
    ["b", new Set(["a", "d"])],
    ["c", new Set(["a"])],
    ["d", new Set(["b"])],
  ]);

  it("returns null when seed or depth is invalid", () => {
    assert.equal(localSubgraph(null, 2, neighbors), null);
    assert.equal(localSubgraph("a", 0, neighbors), null);
  });

  it("expands to depth-limited neighborhood", () => {
    const depth1 = localSubgraph("a", 1, neighbors);
    assert.ok(depth1);
    assert.deepEqual([...depth1!].sort(), ["a", "b", "c"]);

    const depth2 = localSubgraph("a", 2, neighbors);
    assert.ok(depth2);
    assert.deepEqual([...depth2!].sort(), ["a", "b", "c", "d"]);
  });
});

describe("filterGraphByNodes", () => {
  const nodes = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const links = [
    { source: "a", target: "b" },
    { source: "b", target: "c" },
    { source: { id: "a" }, target: { id: "c" } },
  ];

  it("passes through when allowed is null", () => {
    const out = filterGraphByNodes(nodes, links, null);
    assert.equal(out.nodes.length, 3);
    assert.equal(out.links.length, 3);
  });

  it("keeps only links whose endpoints are allowed", () => {
    const out = filterGraphByNodes(nodes, links, new Set(["a", "b"]));
    assert.deepEqual(
      out.nodes.map((n) => n.id),
      ["a", "b"],
    );
    assert.equal(out.links.length, 1);
    assert.equal(linkNodeId(out.links[0]!.source), "a");
    assert.equal(linkNodeId(out.links[0]!.target), "b");
  });
});

describe("cloneLinks", () => {
  it("normalizes object endpoints to strings", () => {
    const cloned = cloneLinks([
      { source: { id: "x" }, target: "y", color: "#000" },
    ]);
    assert.equal(cloned[0]!.source, "x");
    assert.equal(cloned[0]!.target, "y");
    assert.equal(cloned[0]!.color, "#000");
  });
});
