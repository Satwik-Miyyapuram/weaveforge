/**
 * The Overleaf card picture's storage key and size gate (Rust `overleaf::thumb`), re-exported from index.ts.
 */
import { thumbFits as rawThumbFits, thumbKey as rawThumbKey } from "../pkg/wf_wasm.js";

/** The local storage key for an Overleaf project's card picture. */
export function thumbKey(projectId: string): string {
  return rawThumbKey(projectId);
}

/** Whether a picture of `length` characters is kept (about 300 KB at most). */
export function thumbFits(length: number): boolean {
  return rawThumbFits(length);
}
