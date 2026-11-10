/**
 * A PDF tab in the background must keep its fit, and come back at it at once.
 *
 * Background editor tabs are display:none, so their reader measured a width of
 * 0, fitted the page to the smallest zoom, and on switching back waited out the
 * 160 ms resize debounce before refitting: every tab opened small and then
 * jumped to its real size. What is pinned: a hidden (0-wide) container is never
 * measured, coming back from hidden is measured at once, and an ordinary resize
 * still waits for the size to settle.
 */
import { before, test } from "node:test";
import assert from "node:assert/strict";

import { loadTestCore } from "@/lib/test/load-test-core";
import { containerResize } from "../ui/pdf-reader/container-resize";

before(loadTestCore);

test("a container that is hidden is not measured", () => {
  assert.equal(containerResize({ width: 800, height: 600 }, { width: 0, height: 0 }), "ignore");
  assert.equal(containerResize({ width: 800, height: 600 }, { width: 0, height: 600 }), "ignore");
});

test("a container shown again is measured at once", () => {
  assert.equal(containerResize({ width: 0, height: 0 }, { width: 762, height: 900 }), "now");
});

test("a resize of a visible container waits to settle", () => {
  assert.equal(containerResize({ width: 800, height: 600 }, { width: 762, height: 600 }), "settle");
  assert.equal(containerResize({ width: 800, height: 600 }, { width: 800, height: 500 }), "settle");
});

test("an unchanged size does nothing", () => {
  assert.equal(containerResize({ width: 800, height: 600 }, { width: 800, height: 600 }), "ignore");
  assert.equal(containerResize({ width: 0, height: 0 }, { width: 0, height: 0 }), "ignore");
});
