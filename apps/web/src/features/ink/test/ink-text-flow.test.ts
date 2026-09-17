import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { flowTextPages, type TextFlowMetrics } from "../ui/ink-text-flow";

/** Ten characters to a row, four rows to a page. */
const metrics: TextFlowMetrics = {
  rowsPerPage: 4,
  contentWidth: 100,
  measure: (line) => line.length * 10,
};

describe("flowTextPages", () => {
  it("leaves a page that fits alone", () => {
    assert.deepEqual(flowTextPages(["a\nb\nc\nd"], metrics), ["a\nb\nc\nd"]);
  });

  it("carries what does not fit on to the next page", () => {
    assert.deepEqual(flowTextPages(["1\n2\n3\n4\n5\n6", ""], metrics), [
      "1\n2\n3\n4",
      "5\n6",
    ]);
  });

  it("puts the carried text before the next page's own, with a gap", () => {
    assert.deepEqual(flowTextPages(["1\n2\n3\n4\n5", "own"], metrics), [
      "1\n2\n3\n4",
      "5\n\nown",
    ]);
  });

  it("adds pages past the last when the text runs on", () => {
    assert.deepEqual(flowTextPages(["1\n2\n3\n4\n5\n6\n7\n8\n9"], metrics), [
      "1\n2\n3\n4",
      "5\n6\n7\n8",
      "9",
    ]);
  });

  it("counts a wrapped line as the rows it takes", () => {
    // 25 chars = 3 rows; with "a" that is 4, so "b" goes over.
    assert.deepEqual(flowTextPages(["a\n" + "x".repeat(25) + "\nb"], metrics), [
      "a\n" + "x".repeat(25),
      "b",
    ]);
  });

  it("drops the blank rows a carried block would start with", () => {
    assert.deepEqual(flowTextPages(["1\n2\n3\n4\n\n\n5"], metrics), [
      "1\n2\n3\n4",
      "5",
    ]);
  });

  it("never carries for ever on a line taller than a page", () => {
    const tall = "x".repeat(60);
    assert.deepEqual(flowTextPages([tall + "\ny"], metrics), [tall, "y"]);
  });
});
