/**
 * ShareJS text ops, the format Overleaf's editor speaks (Rust `overleaf::text_ot`),
 * re-exported from index.ts. Errors are thrown as `Error`, as the TS port did.
 */
import {
  applyTextOp as rawApplyTextOp,
  transformTextOps as rawTransformTextOps,
} from "../pkg/wf_wasm.js";
import type { TextComponent } from "./bindings.js";

export type { TextComponent };

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/** `text` with `op` applied. Throws when a delete does not match the text it removes. */
export function applyTextOp(text: string, op: TextComponent[]): string {
  try {
    return rawApplyTextOp(text, op);
  } catch (error) {
    throw asError(error);
  }
}

/** Both ops rewritten so each applies after the other: `left` is ours, `right` the server's. */
export function transformTextOps(
  left: TextComponent[],
  right: TextComponent[],
): [TextComponent[], TextComponent[]] {
  try {
    return rawTransformTextOps(left, right) as [TextComponent[], TextComponent[]];
  } catch (error) {
    throw asError(error);
  }
}
