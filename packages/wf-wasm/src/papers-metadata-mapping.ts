/**
 * Metadata-source response mapping (Rust `papers::metadata_mapping`). Re-exported from index.ts.
 * The types are generated from Rust into bindings.ts.
 */
import type {
  CrossrefMessage,
  OpenAlexWork,
  SemanticScholarPaper,
  UrlMetaResponse,
} from "./bindings.js";

export {
  arxivEntryToMetadata,
  crossrefToMetadata,
  openAlexToMetadata,
  semanticScholarToMetadata,
  urlMetaToMetadata,
} from "../pkg/wf_wasm.js";

export type {
  CrossrefMessage,
  OpenAlexWork,
  SemanticScholarPaper,
  UrlMetaResponse,
} from "./bindings.js";

