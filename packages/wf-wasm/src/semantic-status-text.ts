/**
 * The meaning-search status line (Rust `semantic_status_text`), re-exported from index.ts.
 * The input is tagged by `phase`, as the Rust `SemanticStatus` is. The shape comes from
 * bindings.ts, generated from the Rust type.
 */
import type {
  SemanticStatus,
} from "./bindings.js";

export {
  semanticStatusText,
} from "../pkg/wf_wasm.js";

export type { SemanticStatus } from "./bindings.js";

