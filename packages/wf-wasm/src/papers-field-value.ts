/**
 * Paper field value reader (Rust `papers::paper_field::parse_paper_field_value`).
 * Re-exported from index.ts. The type is generated from Rust into bindings.ts.
 */
import type {
  PaperFieldValueData,
} from "./bindings.js";

export {
  parsePaperFieldValue,
} from "../pkg/wf_wasm.js";

export type { PaperFieldValueData } from "./bindings.js";

