/**
 * Ink note tests: storage, and the parts of the plan that are numbers.
 *
 * The dense-page generator is the one `local-dev/ink-gold-standard.mjs` used to
 * produce the plan's §11.3.5 table — the same LCG at the same seed, the same
 * page, the same 5 000 strokes × 60 points — so the sizes measured here are
 * comparable with the sizes the plan quotes rather than a second, unrelated
 * measurement. The compressor is `node:zlib` brotli pinned to **quality 5**,
 * which is the setting §4.3 settles on (Node's default is 11 and takes 3.3
 * seconds on this input).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { brotliCompressSync, brotliDecompressSync, constants } from "node:zlib";

import {
  INK_CHUNK_FLAG_COMPRESSED,
  INK_CHUNK_HEADER_BYTES,
  INK_CHUNK_MAGIC,
  INK_CHUNK_RAW_THRESHOLD,
  InkChunkError,
  decodeInkChunk,
  decodeInkChunkBody,
  encodeInkChunk,
  encodeInkChunkBody,
  fitsInkNoteBudget,
  identityInkChunkCodec,
  inkChunkBodySize,
  readInkChunkHeader,
  type InkChunkCodec,
} from "../../src/ink/ink-binary.js";
import {
  chunkAbsolutePoints,
  chunkLine,
  chunkLineText,
  chunkStroke,
  chunkStrokePoints,
  pageFromChunk,
} from "../../src/ink/ink-chunk-read.js";
import { INK_PAPERS, makeInkStroke, packInkStroke, type InkPage } from "../../src/ink/ink-note.js";

/** Brotli at quality 5, the knee §4.3 pins. */
const brotliQ5: InkChunkCodec = {
  id: "brotli-q5",
  compress: (bytes) =>
    Promise.resolve(
      new Uint8Array(
        brotliCompressSync(bytes, {
          params: {
            [constants.BROTLI_PARAM_QUALITY]: 5,
            [constants.BROTLI_PARAM_SIZE_HINT]: bytes.length,
          },
        }),
      ),
    ),
  decompress: (bytes) => Promise.resolve(new Uint8Array(brotliDecompressSync(bytes))),
};

const PAGE_W = 2100; // 0.1 mm units, A4
const PAGE_H = 2970;

/**
 * How the dense page's per-point pressure is generated.
 *
 * `random` is what the plan's harness used — an LCG draw per point — and it is a
 * *worst case*: 300 000 near-uniform values worth about 31 kB on their own, which
 * no compressor can shrink. `smooth` is what a real pen reports: the same draws
 * run through a one-pole low pass, which is what a digitiser's pressure channel
 * looks like after the hardware filtering every one of them applies.
 */
type PressureModel = "none" | "random" | "smooth";

/**
 * The dense page from the plan's harness: 5 000 strokes of 60 points each,
 * laid out in 125 lines, each stroke a bounded random walk along its line.
 *
 * Pressure is always drawn from the stream, so the three models differ in
 * pressure alone and the size difference between them is pressure's cost.
 */
function densePage(pressure: PressureModel): InkPage {
  let seed = 7;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const count = 5_000;
  const points = 60;
  const lines = Math.ceil(count / 40);
  const strokes = [];
  for (let s = 0; s < count; s++) {
    const yCentre = ((s % lines + 0.5) / lines) * PAGE_H * 0.9 + PAGE_H * 0.05;
    let x = Math.floor(rnd() * PAGE_W);
    let y = Math.floor(yCentre + (rnd() - 0.5) * 120);
    let smoothed = 128;
    const coords = [x, y];
    const pressures = [128];
    for (let i = 1; i < points; i++) {
      x += Math.floor((rnd() - 0.5) * 60);
      y += Math.floor((rnd() - 0.5) * 60);
      coords.push(x, y);
      const draw = 64 + Math.floor(rnd() * 128);
      smoothed += (draw - smoothed) * 0.15;
      if (pressure === "random") pressures.push(draw);
      else if (pressure === "smooth") pressures.push(Math.round(smoothed));
      else pressures.push(0);
    }
    strokes.push(
      makeInkStroke({
        points: coords,
        pressures,
        width: 6,
        t0: s * 120,
      }),
    );
  }
  return { width: PAGE_W, height: PAGE_H, paper: "dotted", background: 0, strokes, lines: [] };
}

/**
 * A committed dense page: 5 000 strokes of *handwriting-shaped* geometry, run
 * through the real packer.
 *
 * This is the page the budget in §4.7 is actually about. Two things differ from
 * the harness page above, and both are what the plan says is stored: a stroke is
 * a smooth curve rather than a random walk, and it goes through
 * {@link packInkStroke}, so Ramer–Douglas–Peucker has already removed the points
 * the curve implies — §11.3.9's committed page is 8–16 points a stroke, not 60.
 */
function committedDensePage(keepPressure = true): {
  page: InkPage;
  rawPoints: number;
  packedPoints: number;
  jsonBytes: number;
} {
  let seed = 11;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const count = 5_000;
  const samples = 60;
  const lines = Math.ceil(count / 40);
  const strokes = [];
  let rawPoints = 0;
  let packedPoints = 0;
  let jsonBytes = 2;
  for (let s = 0; s < count; s++) {
    const yCentre = ((s % lines + 0.5) / lines) * PAGE_H * 0.9 + PAGE_H * 0.05;
    const x0 = 120 + rnd() * 300;
    const run = 240 + rnd() * 160;
    const amplitude = 14 + rnd() * 18;
    const coords: number[] = [];
    const pressures: number[] = [];
    for (let i = 0; i < samples; i += 1) {
      const t = i / (samples - 1);
      coords.push(
        Math.round(x0 + run * t),
        Math.round(yCentre + Math.sin(t * Math.PI * 2.4) * amplitude - t * 12),
      );
      // Pressure rises and falls with the stroke, as a hand does, plus a little
      // sensor noise — a smoothed signal, not white noise.
      pressures.push(Math.round(150 + Math.sin(t * Math.PI) * 60 + (rnd() - 0.5) * 6));
    }
    rawPoints += samples;
    const packed = packInkStroke(coords, pressures);
    packedPoints += packed.points.length / 2;
    // The JSON this page would have cost as revision 1's format: an object per
    // stroke, delta x,y and an absolute pressure per point.
    jsonBytes += 48 + packed.points.length * 5 + (keepPressure ? packed.pressures.length * 4 : 0);
    strokes.push(
      makeInkStroke({
        points: packed.points,
        pressures: keepPressure ? packed.pressures : [],
        width: 6,
        t0: s * 240,
      }),
    );
  }
  return {
    page: { width: PAGE_W, height: PAGE_H, paper: "dotted", background: 0, strokes, lines: [] },
    rawPoints,
    packedPoints,
    jsonBytes,
  };
}

/** A small page with every field populated, for the round-trip tests. */
function smallPage(): InkPage {
  return {
    width: PAGE_W,
    height: PAGE_H,
    paper: "ruled",
    background: 3,
    strokes: [
      makeInkStroke({
        points: [10, 20, 40, 25, 90, 60],
        pressures: [0, 128, 255],
        width: 6,
        tool: "pen",
        colour: "accent",
        t0: 1_500,
        lineIndex: 0,
      }),
      makeInkStroke({
        points: [100, 120, 160, 122],
        pressures: [200, 180],
        width: 60,
        tool: "highlighter",
        colour: "warn",
        t0: 2_000,
        shape: "none",
        lineIndex: -1,
      }),
      makeInkStroke({
        points: [200, 300, 260, 360, 200, 420],
        pressures: [10, 90, 250],
        width: 10,
        tool: "shape",
        colour: "danger",
        t0: 3_000,
        shape: "rect",
        lineIndex: -1,
      }),
    ],
    lines: [
      {
        strokeStart: 0,
        strokeCount: 1,
        yMin: 20,
        yMax: 60,
        text: "see [[Graph-prior module]]",
        confidence: 1,
      },
      {
        strokeStart: 1,
        strokeCount: 1,
        yMin: 120,
        yMax: 122,
        text: "β ≤ 16 → collapse",
        confidence: 0,
      },
    ],
  };
}

test("a page round-trips through the container byte for byte", () => {
  const page = smallPage();
  const body = encodeInkChunkBody(page);
  const again = encodeInkChunkBody(pageFromChunk(decodeInkChunkBody(body)));
  assert.deepEqual(
    Buffer.from(again),
    Buffer.from(body),
    "re-encoding a decoded page must produce identical bytes",
  );
});

test("every paper, the newer grid and wide ones included, keeps its name across the wire", () => {
  for (const paper of INK_PAPERS) {
    const page = { ...smallPage(), paper };
    const back = pageFromChunk(decodeInkChunkBody(encodeInkChunkBody(page)));
    assert.equal(back.paper, paper);
  }
  // The papers are an enum by position, so the list only ever grows at the
  // end: an older reader meeting a newer index falls back to blank.
  assert.deepEqual(INK_PAPERS.slice(0, 3), ["blank", "dotted", "ruled"]);
});

test("every field survives the round trip, names and all", () => {
  const page = smallPage();
  const back = pageFromChunk(decodeInkChunkBody(encodeInkChunkBody(page)));
  assert.equal(back.width, page.width);
  assert.equal(back.height, page.height);
  assert.equal(back.paper, "ruled");
  assert.equal(back.background, 3);
  assert.equal(back.strokes.length, 3);
  assert.deepEqual(back.strokes[0]!.points, [10, 20, 40, 25, 90, 60]);
  assert.deepEqual(back.strokes[0]!.pressures, [0, 128, 255]);
  assert.equal(back.strokes[0]!.tool, "pen");
  assert.equal(back.strokes[0]!.colour, "accent");
  assert.equal(back.strokes[0]!.t0, 1_500);
  assert.equal(back.strokes[1]!.tool, "highlighter");
  assert.equal(back.strokes[1]!.width, 60, "a 6 mm highlighter keeps its width");
  assert.equal(back.strokes[2]!.shape, "rect");
  assert.equal(back.strokes[2]!.colour, "danger");
  assert.equal(back.lines[0]!.text, "see [[Graph-prior module]]");
  assert.equal(back.lines[0]!.confidence, 1);
  assert.equal(back.lines[1]!.text, "β ≤ 16 → collapse", "the text blob is UTF-8");
  assert.equal(back.lines[1]!.confidence, 0);
  assert.equal(back.lines[1]!.yMin, 120);
  assert.equal(back.lines[1]!.yMax, 122);
});

test("points are stored as deltas and read back as absolute positions", () => {
  const page = smallPage();
  const view = decodeInkChunkBody(encodeInkChunkBody(page));
  // x0, y0, p0 then dx, dy, p — the container's own layout, not a guess.
  assert.equal(view.points[0], 10);
  assert.equal(view.points[1], 20);
  assert.equal(view.points[2], 0);
  assert.equal(view.points[3], 30, "40 − 10");
  assert.equal(view.points[4], 5, "25 − 20");
  assert.equal(view.points[5], 128);

  assert.deepEqual(Array.from(chunkAbsolutePoints(view)), [
    10, 20, 0, 40, 25, 128, 90, 60, 255,
    // every stroke restarts its delta chain from its own first point
    100, 120, 200, 160, 122, 180,
    200, 300, 10, 260, 360, 90, 200, 420, 250,
  ]);

  const stroke = chunkStroke(view, 2);
  assert.deepEqual(stroke.points, [200, 300, 260, 360, 200, 420]);
  assert.deepEqual(Array.from(chunkStrokePoints(view, 2).pressures), [10, 90, 250]);
});

test("a corrupt or truncated chunk is refused, not read past its end", () => {
  const page = smallPage();
  const chunk = encodeInkChunkBody(page);
  const framed = new Uint8Array(INK_CHUNK_HEADER_BYTES + chunk.length);
  framed.set(new TextEncoder().encode(INK_CHUNK_MAGIC), 0);
  new DataView(framed.buffer).setUint16(4, 1, true);
  new DataView(framed.buffer).setUint32(8, chunk.length, true);
  new DataView(framed.buffer).setUint32(12, chunk.length, true);
  framed.set(chunk, INK_CHUNK_HEADER_BYTES);
  assert.doesNotThrow(() => readInkChunkHeader(framed));

  assert.throws(
    () => readInkChunkHeader(framed.subarray(0, framed.length - 4)),
    InkChunkError,
    "a truncated chunk is short of the payload its header claims",
  );
  assert.throws(() => readInkChunkHeader(framed.subarray(0, 8)), InkChunkError, "shorter than its header");

  const wrongMagic = Uint8Array.from(framed);
  wrongMagic[0] = 0x58; // "XFIK"
  assert.throws(() => readInkChunkHeader(wrongMagic), /not an ink chunk/);

  const wrongVersion = Uint8Array.from(framed);
  new DataView(wrongVersion.buffer).setUint16(4, 99, true);
  assert.throws(() => readInkChunkHeader(wrongVersion), /chunk version 99/);

  const wrongFlags = Uint8Array.from(framed);
  new DataView(wrongFlags.buffer).setUint16(6, 0x0080, true);
  assert.throws(() => readInkChunkHeader(wrongFlags), /unknown chunk flags/);

  const body = encodeInkChunkBody(page);
  assert.throws(() => decodeInkChunkBody(body.subarray(0, body.length - 1)), /its tables say/);

  const zeroCount = Uint8Array.from(body);
  new DataView(zeroCount.buffer).setUint16(0, 9, true);
  assert.throws(() => decodeInkChunkBody(zeroCount), InkChunkError);

  // A line whose text runs past the blob. The column's offset is read from the
  // decoded view rather than hard-coded, so the test does not encode the layout.
  const ref = decodeInkChunkBody(body);
  const badText = Uint8Array.from(body);
  new DataView(badText.buffer).setUint32(ref.lineTextOffset.byteOffset, ref.texts.length, true);
  assert.throws(
    () => decodeInkChunkBody(badText),
    /text runs past the text blob/,
    "a text range outside the blob is refused",
  );
});

test("a small page is stored raw, and a large one only when compressing helped", async () => {
  const small = await encodeInkChunk(smallPage(), brotliQ5);
  const smallHeader = readInkChunkHeader(small);
  assert.equal(smallHeader.compressed, false, "below the threshold, inflating costs more than it saves");
  assert.equal(smallHeader.flags & INK_CHUNK_FLAG_COMPRESSED, 0);
  assert.ok(inkChunkBodySize(smallPage()) < INK_CHUNK_RAW_THRESHOLD);

  const dense = await encodeInkChunk(densePage(true), brotliQ5);
  const denseHeader = readInkChunkHeader(dense);
  assert.equal(denseHeader.compressed, true);
  assert.ok(dense.length < denseHeader.bodySize, "a compressed chunk is smaller than its body");

  // A codec that cannot help — identity — leaves the chunk raw rather than
  // paying framing bytes for nothing.
  const identity = await encodeInkChunk(densePage("random"), identityInkChunkCodec);
  assert.equal(readInkChunkHeader(identity).compressed, false);
  assert.equal(identity.length, INK_CHUNK_HEADER_BYTES + inkChunkBodySize(densePage("random")));

  const decoded = await decodeInkChunk(dense, brotliQ5);
  assert.equal(decoded.strokeCount, 5_000);
  assert.equal(decoded.pointCount, 300_000);
});

test("a committed dense page: measured against JSON, and inflating fast", async (t) => {
  const withPressure = committedDensePage(true);
  const withoutPressure = committedDensePage(false);
  const chunk = await encodeInkChunk(withPressure.page, brotliQ5);
  const bare = await encodeInkChunk(withoutPressure.page, brotliQ5);

  const compressStart = performance.now();
  await encodeInkChunk(withPressure.page, brotliQ5);
  const compressMs = performance.now() - compressStart;

  const inflateStart = performance.now();
  const view = await decodeInkChunk(chunk, brotliQ5);
  const readPoint = view.points[view.points.length - 2]!;
  const inflateMs = performance.now() - inflateStart;

  const kb = (bytes: number) => bytes / 1024;
  t.diagnostic(
    `committed dense page: ${withPressure.rawPoints} → ${withPressure.packedPoints} points ` +
      `(${(withPressure.packedPoints / 5_000).toFixed(1)}/stroke), ` +
      `body ${kb(inkChunkBodySize(withPressure.page)).toFixed(0)} kB, ` +
      `chunk ${kb(chunk.length).toFixed(1)} kB with pressure / ${kb(bare.length).toFixed(1)} kB without, ` +
      `JSON equivalent ${kb(withPressure.jsonBytes).toFixed(0)} kB ` +
      `(${(withPressure.jsonBytes / chunk.length).toFixed(0)}× ), ` +
      `compress+frame ${compressMs.toFixed(1)} ms, inflate+view ${inflateMs.toFixed(2)} ms ` +
      `(last point ${readPoint})`,
  );

  // Simplification is the size control *and* the overdraw control (§11.3.9): the
  // page stores a third of what the digitiser reported, which is what keeps a
  // dense page in the tens-to-hundreds of kilobytes rather than megabytes.
  assert.ok(
    withPressure.packedPoints < withPressure.rawPoints / 2,
    `packed to ${withPressure.packedPoints} of ${withPressure.rawPoints} points`,
  );
  assert.ok(
    chunk.length * 4 <= withPressure.jsonBytes,
    `binary ${chunk.length} bytes against ${withPressure.jsonBytes} of JSON is not 4× better`,
  );
  // The byte budget in §4.7 is 8 MB a note, and this is the *dense* page times
  // fifty. The absolute figure at q5 is the diagnostic above; this ceiling
  // catches a regression of roughly a third.
  assert.ok(chunk.length < 256 * 1024, `dense page packed to ${chunk.length} bytes`);
  // The inflate budget is < 5 ms on the target CPU. The number that matters is
  // the one in the diagnostic above; this ceiling only catches a regression of
  // an order of magnitude on a slower runner.
  assert.ok(inflateMs < 60, `inflate took ${inflateMs.toFixed(2)} ms`);
});

test("the plan's unsimplified harness page is measured and recorded, not asserted down", async (t) => {
  // This page is 5 000 strokes × 60 *sampled* points with the harness's own
  // pressure, i.e. the live-stroke density §11.3.9 measures overdraw at, not the
  // simplified page that is actually stored. Its size is recorded so a change in
  // the container shows up as a number rather than as a silence.
  const noPressure = await encodeInkChunk(densePage("none"), brotliQ5);
  const random = await encodeInkChunk(densePage("random"), brotliQ5);
  const kb = (bytes: number) => bytes / 1024;
  t.diagnostic(
    `unsimplified 300 000-point page at q5: ${kb(noPressure.length).toFixed(1)} kB without pressure, ` +
      `${kb(random.length).toFixed(1)} kB with the harness's generator pressure`,
  );
  assert.ok(random.length > noPressure.length, "pressure is information, so it costs bytes");
  // A ceiling, not a budget: §4.3's 52.5 kB for this page is a brotli *quality 11*
  // figure, and at the q5 the same section pins the same page is larger.
  assert.ok(random.length < 256 * 1024, `unsimplified page packed to ${random.length} bytes`);
});

test("a note's chunks are budgeted against the 8 MB a sidecar may take", () => {
  assert.equal(fitsInkNoteBudget([52_000, 40_000, 39_000]), true);
  assert.equal(fitsInkNoteBudget([4 * 1024 * 1024, 4 * 1024 * 1024]), true);
  assert.equal(fitsInkNoteBudget([4 * 1024 * 1024, 4 * 1024 * 1024 + 1]), false);
});

test("an empty page is a valid chunk: a note with no strokes still opens", () => {
  const empty: InkPage = {
    width: PAGE_W,
    height: PAGE_H,
    paper: "blank",
    background: 0,
    strokes: [],
    lines: [],
  };
  const view = decodeInkChunkBody(encodeInkChunkBody(empty));
  assert.equal(view.strokeCount, 0);
  assert.equal(view.pointCount, 0);
  assert.equal(view.lineCount, 0);
  assert.deepEqual(pageFromChunk(view).strokes, []);
});

test("a line's text is read on demand and keeps its own length", () => {
  const view = decodeInkChunkBody(encodeInkChunkBody(smallPage()));
  assert.equal(chunkLineText(view, 0), "see [[Graph-prior module]]");
  assert.equal(chunkLineText(view, 1), "β ≤ 16 → collapse");
  assert.deepEqual(chunkLine(view, 1), {
    strokeStart: 1,
    strokeCount: 1,
    yMin: 120,
    yMax: 122,
    text: "β ≤ 16 → collapse",
    confidence: 0,
  });
});

test("a stroke whose points exceed the format's u16 length is refused, not clipped", () => {
  const page: InkPage = {
    ...smallPage(),
    strokes: [
      makeInkStroke({
        points: Array.from({ length: 70_000 * 2 }, (_unused, index) => index % 100),
      }),
    ],
    lines: [],
  };
  assert.throws(() => encodeInkChunkBody(page), /over the u16 length/);
});
