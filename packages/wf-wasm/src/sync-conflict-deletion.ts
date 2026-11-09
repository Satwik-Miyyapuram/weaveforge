/**
 * Delete-conflict choice (Rust `sync::conflict_deletion`), re-exported from index.ts.
 */
import { deletionFor as rawDeletionFor } from "../pkg/wf_wasm.js";

/** A bulk "mine"/"cloud" pick as a delete conflict's choice: mine keeps what this device did. */
export function deletionFor(
  kind: "deleted_remote" | "deleted_local",
  side: "local" | "remote",
): "keep" | "delete" {
  return rawDeletionFor(kind, side) as "keep" | "delete";
}
