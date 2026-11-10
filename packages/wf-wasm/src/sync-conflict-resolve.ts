/**
 * Settling a conflict the reader chose on (Rust `sync::conflict_resolve`). The outbox and
 * `sync_*` SQL stay in TypeScript; these decide the row or the action to run.
 */
import {
  deletionAction as rawDeletionAction,
  resolveWithRow as rawResolveWithRow,
} from "../pkg/wf_wasm.js";
import type { ConflictDeletionAction } from "./bindings.js";

export type { ConflictDeletionAction } from "./bindings.js";

/** The row a field-by-field resolution writes: the merge, picks applied, overrides last. */
export function resolveWithRow(
  base: Record<string, unknown>,
  local: Record<string, unknown>,
  remote: Record<string, unknown>,
  picks: Record<string, "local" | "remote">,
  overrides?: Record<string, unknown>,
): Record<string, unknown> {
  return rawResolveWithRow(base, local, remote, picks, overrides ?? null) as Record<string, unknown>;
}

/** The action for a delete conflict settled with `choice`. `remote` is the server row or `null`. */
export function deletionAction(
  kind: "deleted_remote" | "deleted_local",
  choice: "keep" | "delete",
  local: Record<string, unknown>,
  rowId: string,
  remote: Record<string, unknown> | null,
): ConflictDeletionAction {
  return rawDeletionAction(kind, choice, local, rowId, remote) as ConflictDeletionAction;
}
