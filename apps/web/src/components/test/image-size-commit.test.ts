/**
 * What the image control writes on commit (12-01, 12-02).
 *
 * An invalid crop field used to read as "no crop" and strip the stored crop.
 * Committing Side or crop without moving the slider wrote the rendered width
 * (e.g. 38%) into a picture that had none.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { cropParts, resolveCommit } from "@/components/image-size-control";
import { setImagePlacement } from "@/lib/markdown-image-width";

const base = { percent: 38, widthMoved: false, cropEdges: ["", "", "", ""], storedCrop: undefined, storedAlign: undefined };

test("cropParts: empty/zero is no crop, out of range or junk is invalid", () => {
  assert.equal(cropParts(["", "", "", ""]), null);
  assert.equal(cropParts(["0", " ", "0", ""]), null);
  assert.deepEqual(cropParts(["10", "", "5", ""]), [10, 0, 5, 0]);
  assert.equal(cropParts(["150", "", "", ""]), undefined);
  assert.equal(cropParts(["-5", "", "", ""]), undefined);
  assert.equal(cropParts(["abc", "", "", ""]), undefined);
  assert.equal(cropParts(["100", "", "", ""]), undefined);
  assert.deepEqual(cropParts(["99", "", "", ""]), [99, 0, 0, 0]);
});

test("an invalid crop field keeps the stored crop (12-01)", () => {
  const stored = [10, 10, 10, 10] as [number, number, number, number];
  const out = resolveCommit({}, { ...base, cropEdges: ["150", "", "", ""], storedCrop: stored });
  assert.deepEqual(out.crop, stored);
  const none = resolveCommit({}, { ...base, cropEdges: ["-5", "", "", ""] });
  assert.equal(none.crop, null);
});

test("clearing every crop field removes the crop", () => {
  const out = resolveCommit({}, { ...base, storedCrop: [5, 5, 5, 5] });
  assert.equal(out.crop, null);
});

test("Side without touching the slider keeps the stored width (12-02)", () => {
  const out = resolveCommit({ align: "left" }, base);
  assert.equal(out.width, undefined);
  assert.equal(out.align, "left");
  // And end to end: no width appears in a source that had none.
  assert.equal(setImagePlacement("![Fig](a.png)", "Fig", 0, out), setImagePlacement("![Fig](a.png)", "Fig", 0, { align: "left" }));
  assert.doesNotMatch(setImagePlacement("![Fig](a.png)", "Fig", 0, out), /38%/);
});

test("a moved slider writes its width; 100% or more clears it", () => {
  assert.equal(resolveCommit({}, { ...base, widthMoved: true, percent: 40 }).width, "40%");
  assert.equal(resolveCommit({}, { ...base, widthMoved: true, percent: 100 }).width, null);
  assert.equal(resolveCommit({ width: null }, base).width, null);
  assert.equal(resolveCommit({ width: 55 }, base).width, "55%");
});

test("align defaults to the stored side", () => {
  assert.equal(resolveCommit({}, { ...base, storedAlign: "right" }).align, "right");
  assert.equal(resolveCommit({}, base).align, null);
});
