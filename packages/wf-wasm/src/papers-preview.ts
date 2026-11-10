/**
 * Paper preview frame: the reader link and the saved page's site (Rust
 * `papers::paper_preview`), re-exported from index.ts.
 */

import type {
  PaperPreview,
} from "./bindings.js";

export {
  previewReaderHref,
  siteOf,
} from "../pkg/wf_wasm.js";

export type { PaperPreview };

