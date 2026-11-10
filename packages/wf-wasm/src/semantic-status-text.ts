/**
 * The meaning-search status line (Rust `semantic_status_text`), re-exported from index.ts.
 * The input is tagged by `phase`, as the Rust `SemanticStatus` is. The shape comes from
 * bindings.ts, generated from the Rust type.
 */
import { semanticStatusText as rawSemanticStatusText } from "../pkg/wf_wasm.js";
import type { SemanticStatus } from "./bindings.js";

export type { SemanticStatus } from "./bindings.js";

/** The status line shown for a meaning-search state. */
export function semanticStatusText(status: SemanticStatus): string {
  return rawSemanticStatusText(status);
}
