/**
 * PDF response rules (Rust `reader_pdf_response`), re-exported from index.ts. Keeps the signatures of the
 * removed TS pdf-response-rules.
 */
import {
  isPdfContentType as rawIsPdfContentType,
  readFailureReason as rawReadFailureReason,
} from "../pkg/wf_wasm.js";

export {
  hasPdfMagic,
  hostOf,
  mediaTypeEssence,
} from "../pkg/wf_wasm.js";

/** Whether a `Content-Type` value names a PDF. */
export function isPdfContentType(value: string | null): boolean {
  return rawIsPdfContentType(value ?? undefined);
}

/** Why a read failed: the HTTP status when there was one, else the message, named when it is a fetch refusal. */
export function readFailureReason(message: string, status?: number): string {
  return rawReadFailureReason(message, status);
}
