/**
 * Library tidy-up (Rust `papers::library_tidy`). Re-exported from index.ts. The types are
 * generated from Rust into bindings.ts.
 */
import type {
  DuplicateGroup,
  TidyPaper,
  TitleFix,
} from "./bindings.js";

export {
  findDuplicateGroups,
  pickKeeper,
  titleFixes,
} from "../pkg/wf_wasm.js";

export {
  isConferenceCopy,
} from "../pkg/wf_wasm.js";

export type {
  DuplicateGroup,
  DuplicateReason,
  TidyPaper,
  TitleFix,
  TitleLookup,
} from "./bindings.js";

