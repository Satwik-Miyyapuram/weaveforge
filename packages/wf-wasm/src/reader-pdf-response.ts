/**
 * PDF response rules (Rust `reader_pdf_response`), re-exported from index.ts. Keeps the signatures of
 * apps/web/src/features/reader/application/pdf-response-rules.ts.
 */
import {
  hasPdfMagic as rawHasPdfMagic,
  hostOf as rawHostOf,
  isPdfContentType as rawIsPdfContentType,
  mediaTypeEssence as rawMediaTypeEssence,
  readFailureReason as rawReadFailureReason,
} from "../pkg/wf_wasm.js";

/** The media type without parameters, lowercased. */
export function mediaTypeEssence(value: string): string {
  return rawMediaTypeEssence(value);
}

/** Whether a `Content-Type` value names a PDF. */
export function isPdfContentType(value: string | null): boolean {
  return rawIsPdfContentType(value ?? undefined);
}

/** Whether the first bytes carry the `%PDF-` signature. */
export function hasPdfMagic(bytes: Uint8Array): boolean {
  return rawHasPdfMagic(bytes);
}

/** The host and port of a PDF address, or the address itself when it has no host. */
export function hostOf(url: string): string {
  return rawHostOf(url);
}

/** Why a read failed: the HTTP status when there was one, else the message, named when it is a fetch refusal. */
export function readFailureReason(message: string, status?: number): string {
  return rawReadFailureReason(message, status);
}
