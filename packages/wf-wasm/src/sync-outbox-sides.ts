/**
 * Sides a conflict opens on, from the ops still owed for a row (Rust `sync::outbox_sides`).
 * The SQL reads of `sync_outbox` stay in TypeScript; these only pick the sides.
 */

import type {
  Sides,
} from "./bindings.js";

export {
  deletedLocalBase,
  deletedRemoteSides,
  editSides,
} from "../pkg/wf_wasm.js";

