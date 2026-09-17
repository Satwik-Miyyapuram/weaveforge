/**
 * The ink chunk: one page, columnar binary, compressed (§4.3).
 *
 * The container is the reason a dense page costs tens of kilobytes instead of
 * the **2.11–3.18 MB** the same strokes take as JSON, and the reason opening one
 * is `O(1)` rather than a parse: every field is a typed array *view* over the
 * decoded buffer, so nothing is walked to read it. What is left to pay is the
 * inflate, which is why the plan makes it a step-1 measurement.
 *
 * Layout, all integers little-endian, every section aligned to its own element
 * size so a view over it is legal:
 *
 * ```
 * CHUNK
 *   magic   u8[4]  "WFIK"
 *   version u16
 *   flags   u16    bit 0 = body is compressed
 *   bodySize      u32      uncompressed length of the body
 *   payloadSize   u32      bytes that follow the 16-byte header
 *   payload  u8[payloadSize]
 *
 * BODY
 *   pointCount  u32   strokeCount u32   lineCount u32   textBytes u32
 *   width u16   height u16   paper u8   background u8   reserved u16
 *   strokePointOffset u32[strokeCount]
 *   strokePointCount  u16[strokeCount]
 *   strokeWidth       u8 [strokeCount]
 *   strokeTool        u8 [strokeCount]
 *   strokeColour      u8 [strokeCount]
 *   strokeShape       u8 [strokeCount]
 *   strokeLine        i16[strokeCount]
 *   strokeT0          u32[strokeCount]
 *   points            i16[pointCount * 3]   // x0,y0,p0, then dx,dy,p per point
 *   lineStrokeStart   u16[lineCount]
 *   lineStrokeCount   u16[lineCount]
 *   lineYMin          i16[lineCount]
 *   lineYMax          i16[lineCount]
 *   lineTextOffset    u32[lineCount]
 *   lineTextLength    u16[lineCount]
 *   lineConfidence    u8 [lineCount]
 *   texts             u8 [textBytes]
 * ```
 *
 * Coordinates are delta-encoded within each stroke, exactly as revision 1's JSON
 * was: the encoding was never the problem, the container was. The first point of
 * **every stroke** is absolute — that is where a delta chain restarts, and it is
 * what makes a stroke's geometry readable without the strokes before it. Pressure
 * rides in the third `Int16` slot of each point, as §4.3 sketches, because a
 * byte of `0x00` between every pair of coordinate deltas is *cheaper* than the
 * separate plane it looks like it should be: measured on the plan's dense page,
 * interleaved is 51.3 kB at brotli q11 against 56.2 kB for three separate
 * planes, and 71.6 kB against 85.3 kB at q5.
 *
 * **Two numbers in §4.3's table are worth correcting, because the budget in §4.7
 * rests on them.** Measured here on the plan's own generator:
 *
 * | Dense page, brotli | q5 | q11 |
 * | --- | --- | --- |
 * | `Int16` x,y,p interleaved, no pressure | 48.8 kB | 37.6 kB |
 * | the same, with the harness's pressure | **71.6 kB** | **51.3 kB** |
 *
 * The plan's "q5, with pressure = 52.5 kB" is the **q11** figure: 52 487 bytes is
 * what `brotliCompressSync` produced at its default quality of 11 in
 * `ink-gold-standard.mjs`, and its 39.0 kB companion is a no-pressure run of a
 * slightly different generator (`ink-compression-levels.mjs`). At quality 5 the
 * same page with pressure is 71.6 kB, over the 60 kB the step-1 "done when" asks
 * for. That is the *synthetic* worst case, though: the harness draws pressure
 * from an LCG whose multiplication overflows a double, so successive "random"
 * draws are far more predictable than noise and its coordinates are cheaper to
 * code than any real stroke. Measured against the page the format actually
 * stores — 5 000 handwriting-shaped strokes run through {@link packInkStroke}, so
 * 12.8 points a stroke rather than 60 sampled ones — the same container gives
 * **188 kB at q5 with per-point pressure and 142 kB without**, against **1 108 kB**
 * of the equivalent JSON: **~6×**, not 55×. Any format needs about that much,
 * because that page carries roughly 150 kB of real entropy; what the plan's
 * table measures is a property of its generator. The budget in §4.7 survives
 * it — 8 MB is still some forty dense pages, and 50 pages a note still fits —
 * but a page is hundreds of kilobytes, not tens. Both measurements are in the
 * tests as diagnostics, and neither is asserted down to a number that would make
 * the harness look right.
 *
 * Decode is deliberately strict. A chunk is untrusted input — it came from a
 * folder a collaborator may have written, or from a sync engine that truncated it
 * mid-flight — so every count, offset and length is checked against the buffer
 * before a view is taken, and a chunk that does not add up is refused rather than
 * read past its end.
 */

import {
  INK_COLOURS,
  INK_PAPERS,
  INK_SHAPES,
  INK_TOOLS,
  clampInkPageSize,
  inkEnumIndex,
  inkEnumValue,
  pressureByte,
  type InkPage,
  type InkPaper,
} from "./ink-note.js";
import { clampInkNoteWidth, INK_PEN_WIDTH } from "./width.js";

/** Four bytes at the head of every chunk, so a foreign file is refused at once. */
export const INK_CHUNK_MAGIC = "WFIK";

/** Bumped when the layout changes; a version this code does not know is refused. */
export const INK_CHUNK_VERSION = 1;

/** Bit 0 of `flags`: the body is compressed and must be inflated first. */
export const INK_CHUNK_FLAG_COMPRESSED = 0x1;

/** The 16-byte chunk header. */
export const INK_CHUNK_HEADER_BYTES = 16;

/**
 * Below this, a body is stored raw.
 *
 * Inflating a 4 kB page costs more than it saves, and a raw chunk is readable by
 * tooling — `strings`, a hex dump, `wf ink dump` — without a codec.
 */
export const INK_CHUNK_RAW_THRESHOLD = 64 * 1024;

/** Sidecar budget per note, hard (§4.7). At ~50 kB/page, ~150 dense pages. */
export const INK_NOTE_MAX_BYTES = 8 * 1024 * 1024;

/** Points one chunk may hold: 5 000 strokes at the 400-point cap, exactly. */
export const INK_CHUNK_MAX_POINTS = 2_000_000;

/** Strokes one chunk may hold. `u16` line ranges and the soft budget both sit under it. */
export const INK_CHUNK_MAX_STROKES = 65_535;

/** Raised for anything a chunk claims that its own bytes do not support. */
export class InkChunkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InkChunkError";
  }
}

/* -------------------------------------------------------------------------
 * Codecs
 * ---------------------------------------------------------------------- */

/**
 * How a chunk's body is compressed.
 *
 * Injected rather than imported because the answer differs by runtime and the
 * plan refuses to pay for it twice (§4.3): desktop has `node:zlib` brotli at
 * quality 5 — tens of kilobytes in single-digit milliseconds — while the web
 * build has no brotli at all and uses `CompressionStream("deflate-raw")` or
 * `fflate`, at roughly double the size for the same time. Node's default brotli
 * quality is 11, which took **3 272 ms** on this input in the plan's sweep;
 * **pin the quality to 5 in whichever codec you inject.**
 */
export interface InkChunkCodec {
  readonly id: string;
  compress(bytes: Uint8Array): Promise<Uint8Array>;
  decompress(bytes: Uint8Array): Promise<Uint8Array>;
}

/** Stores everything raw. Correct, honest, and the codec tests run against it. */
export const identityInkChunkCodec: InkChunkCodec = {
  id: "identity",
  compress: (bytes) => Promise.resolve(bytes),
  decompress: (bytes) => Promise.resolve(bytes),
};

/* -------------------------------------------------------------------------
 * Layout
 * ---------------------------------------------------------------------- */

interface ChunkLayout {
  pointCount: number;
  strokeCount: number;
  lineCount: number;
  textBytes: number;
  strokePointOffset: number;
  strokePointCount: number;
  strokeWidth: number;
  strokeTool: number;
  strokeColour: number;
  strokeShape: number;
  strokeLine: number;
  strokeT0: number;
  points: number;
  lineStrokeStart: number;
  lineStrokeCount: number;
  lineYMin: number;
  lineYMax: number;
  lineTextOffset: number;
  lineTextLength: number;
  lineConfidence: number;
  texts: number;
  total: number;
}

const align = (offset: number, to: number): number => Math.ceil(offset / to) * to;

/**
 * Where every section starts, as plain arithmetic.
 *
 * Encode and decode both call this, which is what makes a round trip
 * byte-identical: there is one layout, not a writer's idea of it and a reader's.
 */
function inkChunkLayout(
  pointCount: number,
  strokeCount: number,
  lineCount: number,
  textBytes: number,
): ChunkLayout {
  let cursor = 24; // four u32 counts, then the 6-byte page header padded to 24
  const take = (count: number, size: number): number => {
    cursor = align(cursor, size);
    const at = cursor;
    cursor += count * size;
    return at;
  };

  const strokePointOffset = take(strokeCount, 4);
  const strokePointCount = take(strokeCount, 2);
  const strokeWidth = take(strokeCount, 1);
  const strokeTool = take(strokeCount, 1);
  const strokeColour = take(strokeCount, 1);
  const strokeShape = take(strokeCount, 1);
  const strokeLine = take(strokeCount, 2);
  const strokeT0 = take(strokeCount, 4);
  const points = take(pointCount * 3, 2);
  const lineStrokeStart = take(lineCount, 2);
  const lineStrokeCount = take(lineCount, 2);
  const lineYMin = take(lineCount, 2);
  const lineYMax = take(lineCount, 2);
  const lineTextOffset = take(lineCount, 4);
  const lineTextLength = take(lineCount, 2);
  const lineConfidence = take(lineCount, 1);
  const texts = take(textBytes, 1);

  return {
    pointCount,
    strokeCount,
    lineCount,
    textBytes,
    strokePointOffset,
    strokePointCount,
    strokeWidth,
    strokeTool,
    strokeColour,
    strokeShape,
    strokeLine,
    strokeT0,
    points,
    lineStrokeStart,
    lineStrokeCount,
    lineYMin,
    lineYMax,
    lineTextOffset,
    lineTextLength,
    lineConfidence,
    texts,
    total: cursor,
  };
}

/* -------------------------------------------------------------------------
 * Encoding
 * ---------------------------------------------------------------------- */

/** One encoder for the module: it holds no state. */
const encoder = new TextEncoder();

const clampU16 = (value: number): number =>
  Number.isFinite(value) ? Math.max(0, Math.min(65_535, Math.round(value))) : 0;
const clampI16 = (value: number): number =>
  Number.isFinite(value) ? Math.max(-32_768, Math.min(32_767, Math.round(value))) : 0;

/**
 * Pack a page into an uncompressed body.
 *
 * Throws rather than truncates when a page exceeds what the format can hold: a
 * silently clipped stroke is a lost stroke, and the ink bar's job is to refuse
 * the stroke at the point it is drawn.
 */
export function encodeInkChunkBody(page: InkPage): Uint8Array {
  const strokes = page.strokes;
  const lines = page.lines;
  if (strokes.length > INK_CHUNK_MAX_STROKES) {
    throw new InkChunkError(
      `ink: ${strokes.length} strokes exceeds the ${INK_CHUNK_MAX_STROKES} a chunk holds`,
    );
  }

  const texts = lines.map((line) => encoder.encode(line.text ?? ""));
  const textBytes = texts.reduce((sum, bytes) => sum + bytes.length, 0);
  let pointCount = 0;
  const pointCounts = strokes.map((stroke) => {
    const count = Math.floor(stroke.points.length / 2);
    pointCount += count;
    return count;
  });
  if (pointCount > INK_CHUNK_MAX_POINTS) {
    throw new InkChunkError(
      `ink: ${pointCount} points exceeds the ${INK_CHUNK_MAX_POINTS} a chunk holds`,
    );
  }
  for (const [index, count] of pointCounts.entries()) {
    if (count > 65_535) {
      throw new InkChunkError(`ink: stroke ${index} has ${count} points, over the u16 length`);
    }
  }
  if (textBytes > 0xffff_ffff) throw new InkChunkError("ink: text layer is absurdly large");

  const layout = inkChunkLayout(pointCount, strokes.length, lines.length, textBytes);
  const body = new Uint8Array(layout.total);
  const view = new DataView(body.buffer);
  const size = clampInkPageSize(page.width, page.height);

  view.setUint32(0, pointCount, true);
  view.setUint32(4, strokes.length, true);
  view.setUint32(8, lines.length, true);
  view.setUint32(12, textBytes, true);
  view.setUint16(16, size.width, true);
  view.setUint16(18, size.height, true);
  body[20] = inkEnumIndex(INK_PAPERS, page.paper);
  body[21] = Math.max(0, Math.min(255, Math.round(page.background)));
  view.setUint16(22, 0, true);

  const strokePointOffset = new Uint32Array(body.buffer, layout.strokePointOffset, strokes.length);
  const strokePointCount = new Uint16Array(body.buffer, layout.strokePointCount, strokes.length);
  const strokeWidth = new Uint8Array(body.buffer, layout.strokeWidth, strokes.length);
  const strokeTool = new Uint8Array(body.buffer, layout.strokeTool, strokes.length);
  const strokeColour = new Uint8Array(body.buffer, layout.strokeColour, strokes.length);
  const strokeShape = new Uint8Array(body.buffer, layout.strokeShape, strokes.length);
  const strokeLine = new Int16Array(body.buffer, layout.strokeLine, strokes.length);
  const strokeT0 = new Uint32Array(body.buffer, layout.strokeT0, strokes.length);
  const points = new Int16Array(body.buffer, layout.points, pointCount * 3);

  let offset = 0;
  let cursor = 0;
  strokes.forEach((stroke, index) => {
    const count = pointCounts[index]!;
    strokePointOffset[index] = offset;
    strokePointCount[index] = count;
    // Width is clamped, never rejected: a width that arrived out of range is a
    // bug somewhere upstream, and refusing the stroke would lose the drawing.
    strokeWidth[index] = Math.min(255, clampInkNoteWidth(stroke.width ?? INK_PEN_WIDTH));
    strokeTool[index] = inkEnumIndex(INK_TOOLS, stroke.tool);
    strokeColour[index] = inkEnumIndex(INK_COLOURS, stroke.colour);
    strokeShape[index] = inkEnumIndex(INK_SHAPES, stroke.shape);
    strokeLine[index] = clampI16(stroke.lineIndex);
    strokeT0[index] = Math.max(0, Math.min(0xffff_ffff, Math.round(stroke.t0 ?? 0)));

    let previousX = 0;
    let previousY = 0;
    for (let i = 0; i < count; i += 1) {
      const x = clampI16(stroke.points[i * 2] ?? 0);
      const y = clampI16(stroke.points[i * 2 + 1] ?? 0);
      // Every stroke's first point is absolute, and a delta chain restarts
      // there, so one stroke's geometry is readable on its own.
      points[cursor] = i === 0 ? x : x - previousX;
      points[cursor + 1] = i === 0 ? y : y - previousY;
      points[cursor + 2] = pressureByte(stroke.pressures?.[i]);
      previousX = x;
      previousY = y;
      cursor += 3;
    }
    offset += count;
  });

  const lineStrokeStart = new Uint16Array(body.buffer, layout.lineStrokeStart, lines.length);
  const lineStrokeCount = new Uint16Array(body.buffer, layout.lineStrokeCount, lines.length);
  const lineYMin = new Int16Array(body.buffer, layout.lineYMin, lines.length);
  const lineYMax = new Int16Array(body.buffer, layout.lineYMax, lines.length);
  const lineTextOffset = new Uint32Array(body.buffer, layout.lineTextOffset, lines.length);
  const lineTextLength = new Uint16Array(body.buffer, layout.lineTextLength, lines.length);
  const lineConfidence = new Uint8Array(body.buffer, layout.lineConfidence, lines.length);

  let textCursor = 0;
  let writeAt = layout.texts;
  lines.forEach((line, index) => {
    lineStrokeStart[index] = clampU16(line.strokeStart);
    lineStrokeCount[index] = clampU16(line.strokeCount);
    lineYMin[index] = clampI16(line.yMin);
    lineYMax[index] = clampI16(line.yMax);
    lineTextOffset[index] = textCursor;
    // A text longer than `u16` is clipped, and the clip is what is written, so
    // the offsets and the blob agree whatever the caller handed in.
    const bytes = texts[index]!;
    const length = Math.min(0xffff, bytes.length);
    lineTextLength[index] = length;
    // Confidence is 0–1 in the model and 0–255 on disk, so `1` stays exactly 1
    // after a round trip — the manual-correction flag depends on it.
    lineConfidence[index] = Math.round(Math.max(0, Math.min(1, line.confidence ?? 0)) * 255);
    body.set(bytes.subarray(0, length), writeAt);
    textCursor += length;
    writeAt += length;
  });

  return body;
}

/**
 * Pack a page into a chunk, compressing when that is worth doing.
 *
 * The two-flag outcome the plan asks for: a small body is stored raw, and a large
 * one is only stored compressed when the codec actually beat the raw bytes. A
 * codec that expands its input — identity, or deflate on an already dense buffer
 * — therefore costs nothing but the attempt.
 */
export async function encodeInkChunk(
  page: InkPage,
  codec: InkChunkCodec = identityInkChunkCodec,
): Promise<Uint8Array> {
  const body = encodeInkChunkBody(page);
  let payload = body;
  let flags = 0;
  if (body.length >= INK_CHUNK_RAW_THRESHOLD) {
    const compressed = await codec.compress(body);
    if (compressed.length < body.length) {
      payload = compressed;
      flags |= INK_CHUNK_FLAG_COMPRESSED;
    }
  }

  const chunk = new Uint8Array(INK_CHUNK_HEADER_BYTES + payload.length);
  chunk.set(encoder.encode(INK_CHUNK_MAGIC), 0);
  const view = new DataView(chunk.buffer);
  view.setUint16(4, INK_CHUNK_VERSION, true);
  view.setUint16(6, flags, true);
  view.setUint32(8, body.length, true);
  view.setUint32(12, payload.length, true);
  chunk.set(payload, INK_CHUNK_HEADER_BYTES);
  return chunk;
}

/* -------------------------------------------------------------------------
 * Decoding
 * ---------------------------------------------------------------------- */

/**
 * A decoded chunk, as views over the chunk's own buffer.
 *
 * Nothing here is a copy: reading a page's geometry is `new Int16Array(...)`,
 * which is the "O(1), no parse" property the format exists for. The model —
 * names, absolute coordinates — is built on demand by {@link pageFromChunk}.
 * Treat the views as read-only and the buffer as borrowed: they alias it, so a
 * caller that mutates the chunk changes what these see.
 */
export interface InkChunkView {
  readonly version: number;
  readonly flags: number;
  readonly width: number;
  readonly height: number;
  readonly paper: InkPaper;
  readonly background: number;
  readonly pointCount: number;
  readonly strokeCount: number;
  readonly lineCount: number;
  readonly strokePointOffset: Uint32Array;
  readonly strokePointCount: Uint16Array;
  readonly strokeWidth: Uint8Array;
  readonly strokeTool: Uint8Array;
  readonly strokeColour: Uint8Array;
  readonly strokeShape: Uint8Array;
  readonly strokeLine: Int16Array;
  readonly strokeT0: Uint32Array;
  /**
   * `[x, y, p]` triples: the x and y are absolute at each stroke's first point
   * and deltas within the stroke; the pressure is always absolute.
   */
  readonly points: Int16Array;
  readonly lineStrokeStart: Uint16Array;
  readonly lineStrokeCount: Uint16Array;
  readonly lineYMin: Int16Array;
  readonly lineYMax: Int16Array;
  readonly lineTextOffset: Uint32Array;
  readonly lineTextLength: Uint16Array;
  readonly lineConfidence: Uint8Array;
  readonly texts: Uint8Array;
}

/** The chunk header, readable without inflating anything. */
export interface InkChunkHeader {
  version: number;
  flags: number;
  bodySize: number;
  payloadSize: number;
  /** Total chunk length, so a caller can check a file before reading it all. */
  totalBytes: number;
  compressed: boolean;
}

/**
 * Read the 16-byte header.
 *
 * Separate from decoding because a caller may want the size and the compression
 * flag — a budget check, a file listing, `wf ink dump --header` — without paying
 * for the inflate.
 */
export function readInkChunkHeader(bytes: Uint8Array): InkChunkHeader {
  if (bytes.length < INK_CHUNK_HEADER_BYTES) {
    throw new InkChunkError(`ink: chunk is ${bytes.length} bytes, shorter than its header`);
  }
  const magic = String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!);
  if (magic !== INK_CHUNK_MAGIC) {
    throw new InkChunkError(`ink: not an ink chunk (magic ${JSON.stringify(magic)})`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint16(4, true);
  if (version !== INK_CHUNK_VERSION) {
    throw new InkChunkError(`ink: chunk version ${version}, this build reads ${INK_CHUNK_VERSION}`);
  }
  const flags = view.getUint16(6, true);
  if ((flags & ~INK_CHUNK_FLAG_COMPRESSED) !== 0) {
    throw new InkChunkError(`ink: unknown chunk flags 0x${flags.toString(16)}`);
  }
  const bodySize = view.getUint32(8, true);
  const payloadSize = view.getUint32(12, true);
  if (INK_CHUNK_HEADER_BYTES + payloadSize !== bytes.length) {
    throw new InkChunkError(
      `ink: chunk claims ${payloadSize} payload bytes but carries ${bytes.length - INK_CHUNK_HEADER_BYTES}`,
    );
  }
  return {
    version,
    flags,
    bodySize,
    payloadSize,
    totalBytes: bytes.length,
    compressed: (flags & INK_CHUNK_FLAG_COMPRESSED) !== 0,
  };
}

/** Decode an uncompressed body into views, refusing anything that does not add up. */
export function decodeInkChunkBody(body: Uint8Array): InkChunkView {
  if (body.length < 24) throw new InkChunkError("ink: chunk body is shorter than its header");
  // Every field is read as a typed-array view, and a view needs its offset to be
  // a multiple of its element size *in the buffer*, so a body that starts at an
  // odd byte offset is copied once rather than read unaligned.
  const aligned = body.byteOffset % 8 === 0 ? body : new Uint8Array(body);
  const view = new DataView(aligned.buffer, aligned.byteOffset, aligned.byteLength);
  const pointCount = view.getUint32(0, true);
  const strokeCount = view.getUint32(4, true);
  const lineCount = view.getUint32(8, true);
  const textBytes = view.getUint32(12, true);

  if (strokeCount > INK_CHUNK_MAX_STROKES) {
    throw new InkChunkError(`ink: chunk claims ${strokeCount} strokes`);
  }
  if (pointCount > INK_CHUNK_MAX_POINTS) {
    throw new InkChunkError(`ink: chunk claims ${pointCount} points`);
  }
  if (lineCount > strokeCount && lineCount > 1) {
    throw new InkChunkError(`ink: ${lineCount} lines for ${strokeCount} strokes`);
  }

  const layout = inkChunkLayout(pointCount, strokeCount, lineCount, textBytes);
  if (layout.total !== aligned.length) {
    throw new InkChunkError(
      `ink: chunk body is ${aligned.length} bytes, its tables say ${layout.total}`,
    );
  }

  const base = aligned.byteOffset;
  const strokePointOffset = new Uint32Array(aligned.buffer, base + layout.strokePointOffset, strokeCount);
  const strokePointCount = new Uint16Array(aligned.buffer, base + layout.strokePointCount, strokeCount);
  const strokeWidth = new Uint8Array(aligned.buffer, base + layout.strokeWidth, strokeCount);
  const strokeTool = new Uint8Array(aligned.buffer, base + layout.strokeTool, strokeCount);
  const strokeColour = new Uint8Array(aligned.buffer, base + layout.strokeColour, strokeCount);
  const strokeShape = new Uint8Array(aligned.buffer, base + layout.strokeShape, strokeCount);
  const strokeLine = new Int16Array(aligned.buffer, base + layout.strokeLine, strokeCount);
  const strokeT0 = new Uint32Array(aligned.buffer, base + layout.strokeT0, strokeCount);
  const points = new Int16Array(aligned.buffer, base + layout.points, pointCount * 3);
  const lineStrokeStart = new Uint16Array(aligned.buffer, base + layout.lineStrokeStart, lineCount);
  const lineStrokeCount = new Uint16Array(aligned.buffer, base + layout.lineStrokeCount, lineCount);
  const lineYMin = new Int16Array(aligned.buffer, base + layout.lineYMin, lineCount);
  const lineYMax = new Int16Array(aligned.buffer, base + layout.lineYMax, lineCount);
  const lineTextOffset = new Uint32Array(aligned.buffer, base + layout.lineTextOffset, lineCount);
  const lineTextLength = new Uint16Array(aligned.buffer, base + layout.lineTextLength, lineCount);
  const lineConfidence = new Uint8Array(aligned.buffer, base + layout.lineConfidence, lineCount);
  const texts = new Uint8Array(aligned.buffer, base + layout.texts, textBytes);

  // The stroke table must describe the point array exactly: contiguous strokes,
  // in order, ending at the last point. A gap or an overlap is a corrupt file.
  let expected = 0;
  for (let i = 0; i < strokeCount; i += 1) {
    if (strokePointOffset[i] !== expected) {
      throw new InkChunkError(`ink: stroke ${i} starts at ${strokePointOffset[i]}, expected ${expected}`);
    }
    expected += strokePointCount[i]!;
  }
  if (expected !== pointCount) {
    throw new InkChunkError(`ink: strokes hold ${expected} points, the header says ${pointCount}`);
  }

  for (let i = 0; i < lineCount; i += 1) {
    if (lineStrokeStart[i]! + lineStrokeCount[i]! > strokeCount) {
      throw new InkChunkError(`ink: line ${i} runs past the last stroke`);
    }
    if (lineTextOffset[i]! + lineTextLength[i]! > textBytes) {
      throw new InkChunkError(`ink: line ${i}'s text runs past the text blob`);
    }
  }

  return {
    version: INK_CHUNK_VERSION,
    flags: 0,
    width: view.getUint16(16, true),
    height: view.getUint16(18, true),
    paper: inkEnumValue(INK_PAPERS, aligned[20]!),
    background: aligned[21]!,
    pointCount,
    strokeCount,
    lineCount,
    strokePointOffset,
    strokePointCount,
    strokeWidth,
    strokeTool,
    strokeColour,
    strokeShape,
    strokeLine,
    strokeT0,
    points,
    lineStrokeStart,
    lineStrokeCount,
    lineYMin,
    lineYMax,
    lineTextOffset,
    lineTextLength,
    lineConfidence,
    texts,
  };
}

/** Decode a whole chunk, inflating first when its flag says so. */
export async function decodeInkChunk(
  bytes: Uint8Array,
  codec: InkChunkCodec = identityInkChunkCodec,
): Promise<InkChunkView> {
  const header = readInkChunkHeader(bytes);
  const payload = bytes.subarray(INK_CHUNK_HEADER_BYTES);
  const body = header.compressed ? await codec.decompress(payload) : payload;
  if (body.length !== header.bodySize) {
    throw new InkChunkError(
      `ink: inflate produced ${body.length} bytes, the header says ${header.bodySize}`,
    );
  }
  const view = decodeInkChunkBody(body);
  return { ...view, flags: header.flags };
}

/**
 * How many bytes a page's body would take.
 *
 * Sizes the write path before it allocates, and lets the byte budget be checked
 * without packing the page twice. It is the same layout arithmetic the encoder
 * uses, so the two cannot disagree.
 */
export function inkChunkBodySize(page: InkPage): number {
  const pointCount = page.strokes.reduce(
    (sum, stroke) => sum + Math.floor(stroke.points.length / 2),
    0,
  );
  const textBytes = page.lines.reduce(
    (sum, line) => sum + encoder.encode(line.text ?? "").length,
    0,
  );
  return inkChunkLayout(pointCount, page.strokes.length, page.lines.length, textBytes).total;
}

/**
 * Whether a set of chunks still fits a note's budget.
 *
 * `sizes` are the bytes on disk, one per page, so the check is against what the
 * folder actually holds rather than against an estimate of it.
 */
export function fitsInkNoteBudget(sizes: readonly number[]): boolean {
  return sizes.reduce((sum, size) => sum + size, 0) <= INK_NOTE_MAX_BYTES;
}
