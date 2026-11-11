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

import type { InkPage, InkPaper } from "./ink-note.js";
import { rust } from "../shared/rust.js";

/** Four bytes at the head of every chunk, so a foreign file is refused at once. */
export const INK_CHUNK_MAGIC = "WFIK";

/** Bumped when the layout changes; a version this code does not know is refused. */
export const INK_CHUNK_VERSION = 1;

/** Bit 0 of `flags`: the body is compressed and must be inflated first. */
export const INK_CHUNK_FLAG_COMPRESSED = 0x1;

/** The 16-byte chunk header. */
export const INK_CHUNK_HEADER_BYTES = 16;

/*
 * The raw-threshold rule (`inkChunkRawThreshold`, `inkChunkShouldTryCompress`,
 * `inkChunkStoresCompressed`) lives in Rust: below the threshold a body is stored
 * raw, so tooling can read it without a codec. Read through `rust()` at call time.
 */

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
 * Rust calls
 * ---------------------------------------------------------------------- */

/** Run a Rust chunk call, raising its refusal as an `InkChunkError`. */
function chunkCall<T>(call: () => T): T {
  try {
    return call();
  } catch (error) {
    if (error instanceof InkChunkError) throw error;
    throw new InkChunkError(error instanceof Error ? error.message : String(error));
  }
}

/* -------------------------------------------------------------------------
 * Encoding
 * ---------------------------------------------------------------------- */

/**
 * Pack a page into an uncompressed body (Rust `encode_ink_chunk_body`).
 *
 * Throws rather than truncates when a page exceeds what the format can hold: a
 * silently clipped stroke is a lost stroke, and the ink bar's job is to refuse
 * the stroke at the point it is drawn.
 */
export function encodeInkChunkBody(page: InkPage): Uint8Array {
  return chunkCall(() => rust().encodeInkChunkBody(page));
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
  const core = rust();
  const body = encodeInkChunkBody(page);
  let payload = body;
  let compressed = false;
  if (core.inkChunkShouldTryCompress(body.length)) {
    const packed = await codec.compress(body);
    if (core.inkChunkStoresCompressed(body.length, packed.length)) {
      payload = packed;
      compressed = true;
    }
  }

  const chunk = new Uint8Array(INK_CHUNK_HEADER_BYTES + payload.length);
  chunk.set(core.inkChunkHeaderBytes(body.length, payload.length, compressed), 0);
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
  /** The checked body every view above aliases. */
  readonly body: Uint8Array;
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

/** Where a checked body's sections start (Rust `InkChunkLayout`). */
interface InkChunkLayout {
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

/** A body that passed every check (Rust `InkChunkBodyInfo`). */
export interface InkChunkBodyInfo {
  layout: InkChunkLayout;
  width: number;
  height: number;
  paper: InkPaper;
  background: number;
}

/**
 * Read the 16-byte header (Rust `read_ink_chunk_header`).
 *
 * Separate from decoding because a caller may want the size and the compression
 * flag — a budget check, a file listing, `wf ink dump --header` — without paying
 * for the inflate.
 */
export function readInkChunkHeader(bytes: Uint8Array): InkChunkHeader {
  return chunkCall(() => rust().readInkChunkHeader(bytes));
}

/**
 * Decode an uncompressed body into views over it.
 *
 * Rust checks every count, offset and length against the bytes first; only a
 * body that adds up gets views, so none can read past its end.
 */
export function decodeInkChunkBody(body: Uint8Array): InkChunkView {
  // Every field is read as a typed-array view, and a view needs its offset to be
  // a multiple of its element size *in the buffer*, so a body that starts at an
  // odd byte offset is copied once rather than read unaligned.
  const aligned = body.byteOffset % 8 === 0 ? body : new Uint8Array(body);
  const info = chunkCall(() => rust().checkInkChunkBody(aligned));
  const { layout } = info;
  const { buffer } = aligned;
  const base = aligned.byteOffset;
  const strokes = layout.strokeCount;
  const lines = layout.lineCount;
  return {
    version: INK_CHUNK_VERSION,
    flags: 0,
    width: info.width,
    height: info.height,
    paper: info.paper,
    background: info.background,
    pointCount: layout.pointCount,
    strokeCount: strokes,
    lineCount: lines,
    strokePointOffset: new Uint32Array(buffer, base + layout.strokePointOffset, strokes),
    strokePointCount: new Uint16Array(buffer, base + layout.strokePointCount, strokes),
    strokeWidth: new Uint8Array(buffer, base + layout.strokeWidth, strokes),
    strokeTool: new Uint8Array(buffer, base + layout.strokeTool, strokes),
    strokeColour: new Uint8Array(buffer, base + layout.strokeColour, strokes),
    strokeShape: new Uint8Array(buffer, base + layout.strokeShape, strokes),
    strokeLine: new Int16Array(buffer, base + layout.strokeLine, strokes),
    strokeT0: new Uint32Array(buffer, base + layout.strokeT0, strokes),
    points: new Int16Array(buffer, base + layout.points, layout.pointCount * 3),
    lineStrokeStart: new Uint16Array(buffer, base + layout.lineStrokeStart, lines),
    lineStrokeCount: new Uint16Array(buffer, base + layout.lineStrokeCount, lines),
    lineYMin: new Int16Array(buffer, base + layout.lineYMin, lines),
    lineYMax: new Int16Array(buffer, base + layout.lineYMax, lines),
    lineTextOffset: new Uint32Array(buffer, base + layout.lineTextOffset, lines),
    lineTextLength: new Uint16Array(buffer, base + layout.lineTextLength, lines),
    lineConfidence: new Uint8Array(buffer, base + layout.lineConfidence, lines),
    texts: new Uint8Array(buffer, base + layout.texts, layout.textBytes),
    body: aligned,
  };
}

/** Read header and decompress payload, checking body size against header. */
export async function inflateInkChunk(
  bytes: Uint8Array,
  codec: InkChunkCodec = identityInkChunkCodec,
): Promise<{ flags: number; body: Uint8Array }> {
  const header = readInkChunkHeader(bytes);
  const payload = bytes.subarray(INK_CHUNK_HEADER_BYTES);
  const body = header.compressed ? await codec.decompress(payload) : payload;
  if (body.length !== header.bodySize) {
    throw new InkChunkError(
      `ink: inflate produced ${body.length} bytes, the header says ${header.bodySize}`,
    );
  }
  return { flags: header.flags, body };
}

/** Decode a whole chunk, inflating first when its flag says so. */
export async function decodeInkChunk(
  bytes: Uint8Array,
  codec: InkChunkCodec = identityInkChunkCodec,
): Promise<InkChunkView> {
  const { flags, body } = await inflateInkChunk(bytes, codec);
  const view = decodeInkChunkBody(body);
  return { ...view, flags };
}

/**
 * How many bytes a page's body would take (Rust `ink_chunk_body_size`): the
 * same layout arithmetic the encoder uses, so the two cannot disagree.
 */
export function inkChunkBodySize(page: InkPage): number {
  return chunkCall(() => rust().inkChunkBodySize(page));
}

