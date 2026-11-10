/**
 * Paper HTML relay rules (Rust `reader_paper_html_rules`), re-exported from index.ts. Keeps the
 * signatures of apps/web/src/features/reader/application/paper-html-rules.ts. Byte decoding and the
 * relay Response stay in TS.
 */
import {
  declaredCharset as rawDeclaredCharset,
  isHtmlContentType as rawIsHtmlContentType,
} from "../pkg/wf_wasm.js";

/** Whether a response counts as a web page. */
export function isHtmlContentType(value: string | null): boolean {
  return rawIsHtmlContentType(value ?? undefined);
}

/** The charset a page declares (lowercased), else `utf-8`. */
export function declaredCharset(contentType: string | null, bytes: Uint8Array): string {
  return rawDeclaredCharset(contentType ?? undefined, bytes);
}
