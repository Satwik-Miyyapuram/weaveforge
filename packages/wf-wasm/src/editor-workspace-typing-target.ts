/**
 * Whether a key press belongs to a text field (Rust `editor_workspace::typing_target`), re-exported from index.ts.
 */
import { isTypingTarget as rawIsTypingTarget } from "../pkg/wf_wasm.js";

/** True for an input, textarea or select; a contenteditable element is not a typing target. */
export function isTypingTarget(tagName: string | null, isContentEditable: boolean): boolean {
  return rawIsTypingTarget(tagName ?? undefined, isContentEditable);
}
