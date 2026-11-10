/**
 * The ink chunk container (Rust `ink::chunk`), re-exported from index.ts:
 * layout, header, body checks and the body encoder. Core's ink-binary.ts keeps
 * the typed-array views and the async compression around these, and turns the
 * thrown errors into `InkChunkError`.
 */
import {
  absolutePointTriples as rawAbsolutePointTriples,
  checkInkChunkBody as rawCheckInkChunkBody,
  encodeInkChunkBody as rawEncodeInkChunkBody,
  fitsInkNoteBudget as rawFitsInkNoteBudget,
  inkChunkBodySize as rawInkChunkBodySize,
  inkChunkHeaderBytes as rawInkChunkHeaderBytes,
  inkChunkRawThreshold as rawInkChunkRawThreshold,
  inkChunkShouldTryCompress as rawInkChunkShouldTryCompress,
  inkChunkStoresCompressed as rawInkChunkStoresCompressed,
  pageFromChunkBody as rawPageFromChunkBody,
  readInkChunkHeader as rawReadInkChunkHeader,
  strokePointTriples as rawStrokePointTriples,
} from "../pkg/wf_wasm.js";
import type { InkChunkBodyInfo, InkChunkHeader } from "./bindings.js";

/** A page packed into an uncompressed body; throws on a page the format cannot hold. */
export function encodeInkChunkBody(page: object): Uint8Array {
  return rawEncodeInkChunkBody(page);
}

/** The body length a page would take, without packing it. */
export function inkChunkBodySize(page: object): number {
  return rawInkChunkBodySize(page);
}

/** The 16-byte chunk header; throws on a header the format refuses. */
export function readInkChunkHeader(bytes: Uint8Array): InkChunkHeader {
  return rawReadInkChunkHeader(bytes) as InkChunkHeader;
}

/** The 16-byte header for a body of `bodySize` bytes stored as `payloadSize`. */
export function inkChunkHeaderBytes(bodySize: number, payloadSize: number, compressed: boolean): Uint8Array {
  return rawInkChunkHeaderBytes(bodySize, payloadSize, compressed);
}

/** The layout and page header of a body that passed every check; throws otherwise. */
export function checkInkChunkBody(body: Uint8Array): InkChunkBodyInfo {
  return rawCheckInkChunkBody(body) as InkChunkBodyInfo;
}

/** A checked body as the page model (an `InkPage`); throws on a corrupt body. */
export function pageFromChunkBody(body: Uint8Array): object {
  return rawPageFromChunkBody(body) as object;
}

/** One stroke's `x, y, pressure` triples, absolute and unwrapped; empty past the last stroke. */
export function strokePointTriples(body: Uint8Array, strokeIndex: number): Float64Array {
  return rawStrokePointTriples(body, strokeIndex);
}

/** Every point as `Int16` `x, y, pressure` triples, each coordinate wrapped as an `Int16Array` write wraps. */
export function absolutePointTriples(body: Uint8Array): Int16Array {
  return rawAbsolutePointTriples(body);
}

/** Whether chunks of these on-disk sizes still fit a note's budget. */
export function fitsInkNoteBudget(sizes: readonly number[]): boolean {
  return rawFitsInkNoteBudget(Float64Array.from(sizes));
}

/** The body size at or above which a chunk is worth trying to compress. */
export function inkChunkRawThreshold(): number {
  return rawInkChunkRawThreshold();
}

/** Whether a body of `bodyLength` bytes is worth trying to compress. */
export function inkChunkShouldTryCompress(bodyLength: number): boolean {
  return rawInkChunkShouldTryCompress(bodyLength);
}

/** Whether a body of `bodyLength` bytes is stored compressed, given its packed length. */
export function inkChunkStoresCompressed(bodyLength: number, packedLength: number): boolean {
  return rawInkChunkStoresCompressed(bodyLength, packedLength);
}
