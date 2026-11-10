/**
 * Paper preview frame: the reader link and the saved page's site (Rust
 * `papers::paper_preview`), re-exported from index.ts.
 */
import {
  previewReaderHref as rawPreviewReaderHref,
  siteOf as rawSiteOf,
} from "../pkg/wf_wasm.js";

import type { PaperPreview } from "./bindings.js";

export type { PaperPreview };

/** The reader link for the paper, or null when there is nothing it could open. */
export function previewReaderHref(
  remoteHref: string | null,
  preview: PaperPreview,
  localHref: string,
): string | null {
  return rawPreviewReaderHref(remoteHref, preview, localHref);
}

/** The host a saved page came from, without "www.", or the address as given. */
export function siteOf(url: string): string {
  return rawSiteOf(url);
}
