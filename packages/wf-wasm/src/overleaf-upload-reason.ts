/**
 * The upload error suffix (Rust `overleaf::upload_reason`), re-exported from index.ts.
 */
import { uploadErrorSuffix as rawUploadErrorSuffix } from "../pkg/wf_wasm.js";

/** `": <message>"` when the upload answer body is JSON whose `error` is a string, else "". */
export function uploadErrorSuffix(body: string): string {
  return rawUploadErrorSuffix(body);
}
