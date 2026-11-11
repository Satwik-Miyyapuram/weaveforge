/**
 * Zotero item <-> paper mapping (Rust `papers::zotero_mapping`). Re-exported from index.ts.
 * The types are generated from Rust into bindings.ts.
 */
import type {
  ZoteroExportItem,
  ZoteroItem,
  ZoteroPaperInput,
} from "./bindings.js";

export {
  toZoteroItem,
  zoteroArxivId,
  zoteroContentKeys,
  zoteroRemoteToInput,
  zoteroRemoteToMetadata,
} from "../pkg/wf_wasm.js";

export type {
  ZoteroCreator,
  ZoteroExportCreator,
  ZoteroExportItem,
  ZoteroItem,
  ZoteroPaperInput,
} from "./bindings.js";

