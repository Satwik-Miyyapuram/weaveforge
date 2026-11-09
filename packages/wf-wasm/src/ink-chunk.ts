/**
 * The ink chunk container (Rust `ink::chunk`), re-exported from index.ts:
 * layout, header, body checks and the body encoder. Core's ink-binary.ts keeps
 * the typed-array views and the async compression around these, and turns the
 * thrown errors into `InkChunkError`.
 */
import {
  checkInkChunkBody as rawCheckInkChunkBody,
  encodeInkChunkBody as rawEncodeInkChunkBody,
  fitsInkNoteBudget as rawFitsInkNoteBudget,
  inkChunkBodySize as rawInkChunkBodySize,
  inkChunkHeaderBytes as rawInkChunkHeaderBytes,
  pageFromChunkBody as rawPageFromChunkBody,
  readInkChunkHeader as rawReadInkChunkHeader,
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

/** Whether chunks of these on-disk sizes still fit a note's budget. */
export function fitsInkNoteBudget(sizes: readonly number[]): boolean {
  return rawFitsInkNoteBudget(Float64Array.from(sizes));
}
