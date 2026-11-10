/**
 * Overleaf root folder id from the join answer (Rust `overleaf::upload`), re-exported from index.ts.
 */
import { rootFolderIdOf as rawRootFolderIdOf } from "../pkg/wf_wasm.js";

/** The project's root folder id, or null when the project is read-only or the answer has none. */
export function rootFolderIdOf(join: readonly unknown[]): string | null {
  return rawRootFolderIdOf(join) ?? null;
}
