/**
 * Overleaf project tree flattening (Rust `overleaf_tree`). The walk is Rust; the
 * sort by path stays in the web app, which orders by the locale it shows.
 */
import {
  flattenOverleafDocs as rawFlattenOverleafDocs,
  flattenOverleafFiles as rawFlattenOverleafFiles,
} from "../pkg/wf_wasm.js";
import type { LiveDocEntry } from "./bindings.js";

export type { LiveDocEntry } from "./bindings.js";

/** The project's text files as paths, in walk order (not sorted). */
export function flattenOverleafDocs(rootFolder: unknown): LiveDocEntry[] {
  return rawFlattenOverleafDocs(rootFolder) as LiveDocEntry[];
}

/** The project's binary files as paths, in walk order (not sorted). */
export function flattenOverleafFiles(rootFolder: unknown): LiveDocEntry[] {
  return rawFlattenOverleafFiles(rootFolder) as LiveDocEntry[];
}
