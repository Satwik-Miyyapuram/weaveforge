/**
 * Paper field value reader (Rust `papers::paper_field::parse_paper_field_value`).
 * Re-exported from index.ts. The type is generated from Rust into bindings.ts.
 */
import { parsePaperFieldValue as rawParsePaperFieldValue } from "../pkg/wf_wasm.js";
import type { PaperFieldValueData } from "./bindings.js";

export type { PaperFieldValueData } from "./bindings.js";

/**
 * Read a field value sent by an AI tool or a draft: a non-blank string, a finite number,
 * or a string list with blanks trimmed away. `name` starts the error message, e.g.
 * `value` or `Proposal value`. Anything else throws.
 */
export function parsePaperFieldValue(value: unknown, name: string): PaperFieldValueData {
  return rawParsePaperFieldValue(value, name) as PaperFieldValueData;
}
