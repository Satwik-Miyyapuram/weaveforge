/**
 * PDF response rules (Rust `reader_pdf_response`), re-exported from index.ts. Keeps the signatures of the
 * removed TS pdf-response-rules.
 */
import { isPdfContentType as rawIsPdfContentType } from "../pkg/wf_wasm.js";

export {
  hasPdfMagic,
  hostOf,
  mediaTypeEssence,
  readFailureReason,
} from "../pkg/wf_wasm.js";

/** Whether a `Content-Type` value names a PDF. */
export function isPdfContentType(value: string | null): boolean {
  return rawIsPdfContentType(value ?? undefined);
}
