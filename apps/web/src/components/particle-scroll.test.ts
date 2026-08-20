import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { MAX_ZONES, packZones, rowInZones, zonesToUniform, type Zone } from "./particle-scroll";

/**
 * The opt-in mask, which is the whole of what `only` does.
 *
 * The effect rasterises its scroll container and takes it apart by cell — it
 * has no concept of an element — so restricting it to some elements means
 * turning their rectangles into the region that may dissolve and pinning
 * everything else assembled. The packing is the part a test can reach; the
 * rest is a shader.
 */

const z = (x0: number, y0: number, x1: number, y1: number): Zone => ({ x0, y0, x1, y1 });

describe("packZones", () => {
  it("merges a column of steps into one rectangle", () => {
    // This is the real case: a scene's steps, stacked, a small gap apart. They
    // must come out as one — a gap left between them is a few rows of pinned
    // solid text drawn across a dissolving paragraph.
    const steps = [z(800, 0, 1200, 300), z(800, 320, 1200, 620), z(800, 640, 1200, 940)];
    assert.deepEqual(packZones(steps), [z(800, 0, 1200, 940)]);
  });

  it("keeps a figure beside the steps out of it", () => {
    // The point of rectangles rather than rows. The stage shares its rows with
    // the steps, so a row mask dissolved both and changed nothing.
    const packed = packZones([z(800, 0, 1200, 300)]);
    assert.equal(packed.length, 1);
    assert.equal(packed[0]!.x0, 800);
  });

  it("keeps scenes that are far apart separate", () => {
    const packed = packZones([z(800, 0, 1200, 300), z(800, 5000, 1200, 5300)]);
    assert.equal(packed.length, 2);
  });

  it("does not merge columns that do not overlap horizontally", () => {
    const packed = packZones([z(0, 0, 400, 300), z(800, 0, 1200, 300)]);
    assert.equal(packed.length, 2);
  });

  it("drops zero-sized rectangles", () => {
    // A hidden element measures zero and would otherwise claim a sliver.
    assert.deepEqual(packZones([z(0, 100, 0, 400), z(0, 100, 400, 100)]), []);
  });

  it("merges the closest pairs down to the cap rather than dropping any", () => {
    // Over the cap, a too-generous rectangle dissolves slightly more than was
    // asked. Dropping one instead leaves a step that never dissolves at all,
    // which reads as a bug rather than as a margin.
    const many = Array.from({ length: 40 }, (_, i) => z(800, i * 1000, 1200, i * 1000 + 300));
    const packed = packZones(many);
    assert.equal(packed.length, MAX_ZONES);
    assert.equal(packed[0]!.y0, 0);
    assert.equal(packed[packed.length - 1]!.y1, 39_300);
  });

  it("is empty for no input", () => {
    assert.deepEqual(packZones([]), []);
  });
});

describe("rowInZones", () => {
  const zones = [z(800, 100, 1200, 200), z(800, 400, 1200, 500)];

  it("is true for rows a zone reaches", () => {
    for (const y of [100, 150, 200, 400, 500]) assert.equal(rowInZones(zones, y), true, String(y));
  });

  it("is false for rows no zone reaches", () => {
    for (const y of [0, 99, 201, 399, 501]) assert.equal(rowInZones(zones, y), false, String(y));
  });

  it("treats no zones as no restriction, not as nothing", () => {
    // No selector, or markup that has not arrived. Freezing the whole effect
    // is the wrong way to be wrong: unrestricted is what it did before.
    assert.equal(rowInZones([], 0), true);
    assert.equal(rowInZones([], 12_345), true);
  });
});

describe("zonesToUniform", () => {
  it("packs x0, y0, x1, y1 in the order the shader reads them", () => {
    const out = zonesToUniform([z(1, 2, 3, 4)]);
    assert.deepEqual([...out.slice(0, 4)], [1, 2, 3, 4]);
  });

  it("is always the full array length, so the upload size never changes", () => {
    assert.equal(zonesToUniform([]).length, MAX_ZONES * 4);
    assert.equal(zonesToUniform([z(1, 2, 3, 4)]).length, MAX_ZONES * 4);
  });

  it("never writes past the cap", () => {
    const many = Array.from({ length: 40 }, () => z(1, 2, 3, 4));
    assert.equal(zonesToUniform(many).length, MAX_ZONES * 4);
  });
});
