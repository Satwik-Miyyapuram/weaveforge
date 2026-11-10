/**
 * Plain-text helpers (Rust `text`), re-exported from index.ts.
 */
import { escapeHtml as rawEscapeHtml } from "../pkg/wf_wasm.js";

/** Text made safe inside HTML or XML markup: `&`, `<`, `>` and `"`. */
export function escapeHtml(value: string): string {
  return rawEscapeHtml(value);
}
