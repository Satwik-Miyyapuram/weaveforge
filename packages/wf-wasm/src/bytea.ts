/**
 * bytea and base64 codecs (Rust `bytea`), re-exported from index.ts.
 * Replaces the former helpers in apps/web/src/lib/bytea.ts.
 */
import { decodeBytea as rawDecodeBytea } from "../pkg/wf_wasm.js";

export { decodeBase64, encodeBase64, encodeBytea } from "../pkg/wf_wasm.js";

/**
 * Bytes from a PostgREST bytea value. PGlite hands a bytea column back as bytes
 * already, so those pass through; PostgREST sends hex text.
 */
export function decodeBytea(value: string | Uint8Array): Uint8Array {
  if (value instanceof Uint8Array) return value;
  return rawDecodeBytea(value);
}
