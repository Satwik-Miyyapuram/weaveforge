/**
 * Title acronym helpers (Rust `search::acronyms`), re-exported from index.ts.
 * Keeps the signature of packages/core/src/search/search-acronyms.ts.
 */
import { acronymsForTitle as rawAcronymsForTitle } from "../pkg/wf_wasm.js";

/** Acronyms worth indexing for a title. Usually one; empty for titles that are already short or that would produce something meaningless. */
export function acronymsForTitle(title: string): string[] {
  return rawAcronymsForTitle(title) as string[];
}
