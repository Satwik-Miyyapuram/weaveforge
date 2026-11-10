/**
 * Which pages of a PDF the user meant: `all`, or a list like `1,3-5` (Rust
 * `ink::pdf_pages`), re-exported from index.ts.
 */

import type {
  PageSelection,
} from "./bindings.js";

export {
  isAllPages,
  pageListProblem,
  parsePageList,
  selectedPdfPages,
} from "../pkg/wf_wasm.js";

export type { PageSelection };

