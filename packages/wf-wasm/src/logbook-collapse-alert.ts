/**
 * Citation-alert short form (Rust `logbook::collapse_alert`). Long citation alerts show their
 * first five papers, and the rest is hidden behind "Show n more".
 */
import { collapseAlert as rawCollapseAlert } from "../pkg/wf_wasm.js";
import type { CollapsedAlert } from "./bindings.js";

export type { CollapsedAlert } from "./bindings.js";

/** The short form of a citation alert, or null for any other entry or a short alert. */
export function collapseAlert(headline: string, rest: string): CollapsedAlert | null {
  return (rawCollapseAlert(headline, rest) as CollapsedAlert | undefined) ?? null;
}
