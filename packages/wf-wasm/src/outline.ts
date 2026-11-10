/**
 * The Outline section's headings (Rust `editor_workspace::outline`),
 * re-exported from index.ts.
 */
import { outlineOf as rawOutlineOf } from "../pkg/wf_wasm.js";

import type { OutlineHeading } from "./bindings.js";

export type { OutlineHeading };

/** Headings in document order, up to `maxLevel`; fenced code is skipped. */
export function outlineOf(body: string, maxLevel = 3): OutlineHeading[] {
  return rawOutlineOf(body, maxLevel);
}
