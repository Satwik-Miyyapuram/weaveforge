/**
 * Sides a conflict opens on, from the ops still owed for a row (Rust `sync::outbox_sides`).
 * The SQL reads of `sync_outbox` stay in TypeScript; these only pick the sides.
 */
import {
  deletedLocalBase as rawDeletedLocalBase,
  deletedRemoteSides as rawDeletedRemoteSides,
  editSides as rawEditSides,
} from "../pkg/wf_wasm.js";

import type { OwedOp, Sides } from "./bindings.js";

/** Sides for an edit conflict, or `null` when no non-delete op is owed. */
export function editSides(ops: readonly OwedOp[]): Sides | null {
  return rawEditSides(ops) as Sides | null;
}

/** Sides for a row deleted on the server. `stored` is this device's row, or `null`. */
export function deletedRemoteSides(ops: readonly OwedOp[], stored: Record<string, unknown> | null): Sides | null {
  return rawDeletedRemoteSides(ops, stored) as Sides | null;
}

/** The base for a row deleted here. Empty when no op is owed. */
export function deletedLocalBase(ops: readonly OwedOp[]): Record<string, unknown> {
  return rawDeletedLocalBase(ops) as Record<string, unknown>;
}
