/**
 * Signed-url batch cap (Rust `storage::blob_access`), re-exported from index.ts.
 */
import { maxSignedUrlPaths as rawMaxSignedUrlPaths } from "../pkg/wf_wasm.js";

/** Most paths one signed-url request may ask for. The relay enforces the same cap. */
export function maxSignedUrlPaths(): number {
  return rawMaxSignedUrlPaths();
}
