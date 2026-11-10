/**
 * Mark popover decisions (Rust `reader_mark_actions`), re-exported from index.ts. Keeps the signatures of the removed
 * application/mark-actions.ts.
 */
import type {
  MarkTarget,
} from "./bindings.js";
import {
  markActions as rawMarkActions,
  markPopoverShown as rawMarkPopoverShown,
} from "../pkg/wf_wasm.js";

export {
  picturePath,
} from "../pkg/wf_wasm.js";

/** What the popover on a tapped mark offers; null when it shows none. */
export interface MarkActions {
  /** The label over the popover: what the mark is. */
  kind: string;
  colour: boolean;
  /** The comment button's label, or null when the mark takes no comment. */
  comment: "Comment" | "Edit comment" | null;
  /** The composer's starting text: the comment already there. */
  prefill: string;
}

export type { MarkTarget } from "./bindings.js";

/** What the popover offers for a mark, or null when it offers nothing. */
export function markActions(ann: MarkTarget): MarkActions | null {
  return rawMarkActions(ann) as MarkActions | null;
}

/** A text box's popover shows under Select or Text; other marks under any tool. */
export function markPopoverShown(ann: Pick<MarkTarget, "type">, tool: string): boolean {
  return rawMarkPopoverShown(ann.type, tool);
}

