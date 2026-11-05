import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { snapToText } from "../ui/pdf-reader/text-snap";

const box = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom });

// Two lines of text: a line at y 100-112 starting at x 50, and one at y 120-132.
const lines = [box(50, 100, 300, 112), box(310, 100, 400, 112), box(50, 120, 280, 132)];

describe("snapToText", () => {
  it("snaps a press in the left margin to the start of that line", () => {
    assert.deepEqual(snapToText(lines, 20, 106), { index: 0, x: 50.5, y: 106 });
  });

  it("snaps a press past the end of a line to its last character", () => {
    assert.deepEqual(snapToText(lines, 420, 106), { index: 1, x: 399.5, y: 106 });
  });

  it("picks the nearer run when the press falls in a gap between two runs", () => {
    assert.equal(snapToText(lines, 303, 106)?.index, 0);
    assert.equal(snapToText(lines, 308, 106)?.index, 1);
  });

  it("snaps a press between lines to the nearer line", () => {
    assert.equal(snapToText(lines, 60, 113)?.index, 0);
    assert.equal(snapToText(lines, 60, 119)?.index, 2);
    assert.equal(snapToText(lines, 60, 119)?.y, 126);
  });

  it("leaves a press far from any text alone", () => {
    assert.equal(snapToText(lines, 20, 400), null);
    assert.equal(snapToText(lines, 900, 106), null);
  });

  it("skips empty runs and answers null with no text", () => {
    assert.equal(snapToText([], 10, 10), null);
    assert.equal(snapToText([box(50, 100, 50, 100)], 50, 100), null);
  });
});
