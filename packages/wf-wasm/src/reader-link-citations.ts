/**
 * Internal `/Link` citation mentions (Rust `reader::link_citations`), re-exported from index.ts. Each
 * function's signature is LinkCitationsFns in packages/core/src/shared/core-contract.ts.
 * Object shapes come from ./bindings.ts.
 */
import type {
  AnalysisPdfLink,
} from "./bindings.js";

export {
  coveredTextSpans,
  linkCitationMentions,
  referenceForDestination,
} from "../pkg/wf_wasm.js";

export type { AnalysisPdfLink as PdfLink } from "./bindings.js";

