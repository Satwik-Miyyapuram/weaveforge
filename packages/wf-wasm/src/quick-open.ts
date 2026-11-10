/**
 * Quick open ranking and palette groups (Rust `editor_workspace::quick_open`),
 * re-exported from index.ts. The Enter-to-pick check stays with the dialog,
 * since it reads keyboard composition state and is not part of the ranking.
 */

import type {
  QuickOpenGroup,
  QuickOpenResult,
} from "./bindings.js";

export {
  groupResults,
  paintedOrder,
  quickOpenResults,
} from "../pkg/wf_wasm.js";

export {
  stepCursor,
  titleOf,
} from "../pkg/wf_wasm.js";

export type { QuickOpenGroup, QuickOpenResult };

