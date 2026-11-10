/**
 * Open-access and WebDAV PDF ladder trim rules (Rust `reader::pdf_resolver_rules`),
 * re-exported from index.ts. Fetch and URL building stay in TS.
 */
import {
  openAccessSupports as rawOpenAccessSupports,
  trimmedOrNone as rawTrimmedOrNone,
} from "../pkg/wf_wasm.js";

export {
  webdavSupports,
} from "../pkg/wf_wasm.js";

/** True when the paper has a non-blank arXiv id, URL or DOI. */
export function openAccessSupports(arxivId: string | null | undefined, url: string | null | undefined, doi: string | null | undefined): boolean {
  return rawOpenAccessSupports(arxivId ?? undefined, url ?? undefined, doi ?? undefined);
}

/** Trimmed text, or null when it is absent or blank. */
export function trimmedOrNone(value: string | null | undefined): string | null {
  return rawTrimmedOrNone(value ?? undefined) ?? null;
}
