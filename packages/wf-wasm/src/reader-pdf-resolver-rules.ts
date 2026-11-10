/**
 * Open-access and WebDAV PDF ladder trim rules (Rust `reader::pdf_resolver_rules`),
 * re-exported from index.ts. Fetch and URL building stay in TS.
 */
import {
  openAccessSupports as rawOpenAccessSupports,
  trimmedOrNone as rawTrimmedOrNone,
  webdavSupports as rawWebdavSupports,
} from "../pkg/wf_wasm.js";

/** True when the paper has a non-blank arXiv id, URL or DOI. */
export function openAccessSupports(arxivId: string | null | undefined, url: string | null | undefined, doi: string | null | undefined): boolean {
  return rawOpenAccessSupports(arxivId ?? undefined, url ?? undefined, doi ?? undefined);
}

/** True when the WebDAV path is a non-blank string (pass undefined for a non-string). */
export function webdavSupports(webdavPath: string | undefined): boolean {
  return rawWebdavSupports(webdavPath);
}

/** Trimmed text, or null when it is absent or blank. */
export function trimmedOrNone(value: string | null | undefined): string | null {
  return rawTrimmedOrNone(value ?? undefined) ?? null;
}
