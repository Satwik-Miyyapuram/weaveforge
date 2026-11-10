/**
 * bytea and base64 codecs (Rust `bytea`), re-exported from index.ts.
 * Replaces the former helpers in apps/web/src/lib/bytea.ts.
 */
import {
  decodeBase64 as rawDecodeBase64,
  decodeBytea as rawDecodeBytea,
  encodeBase64 as rawEncodeBase64,
  encodeBytea as rawEncodeBytea,
} from "../pkg/wf_wasm.js";

/**
 * Bytes from a PostgREST bytea value. PGlite hands a bytea column back as bytes
 * already, so those pass through; PostgREST sends hex text.
 */
export function decodeBytea(value: string | Uint8Array): Uint8Array {
  if (value instanceof Uint8Array) return value;
  return rawDecodeBytea(value);
}

/** PostgREST bytea string (`\x` + hex) for bytes. */
export function encodeBytea(bytes: Uint8Array): string {
  return rawEncodeBytea(bytes);
}

/** base64 → bytes; also the shape of `encode(bytea, 'base64')` payloads from JSON-RPC. Throws on invalid base64. */
export function decodeBase64(b64: string): Uint8Array<ArrayBuffer> {
  return rawDecodeBase64(b64) as Uint8Array<ArrayBuffer>;
}

/** Bytes → padded base64. Chunking happens in Rust, so large payloads do not overflow the call stack. */
export function encodeBase64(bytes: Uint8Array): string {
  return rawEncodeBase64(bytes);
}
