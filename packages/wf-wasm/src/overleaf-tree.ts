/**
 * Overleaf project tree flattening (Rust `overleaf_tree`). The walk is Rust; the
 * sort by path stays in the web app, which orders by the locale it shows.
 */
import type {
  LiveDocEntry,
} from "./bindings.js";

export {
  flattenOverleafDocs,
  flattenOverleafFiles,
} from "../pkg/wf_wasm.js";

export type { LiveDocEntry } from "./bindings.js";

