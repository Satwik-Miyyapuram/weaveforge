/**
 * Experiment artifact labels (Rust `figure_label`), re-exported from index.ts.
 * Keeps the signature of the former apps/web/src/features/experiments/ui/figure-label.ts.
 */
import { figureLabel as rawFigureLabel } from "../pkg/wf_wasm.js";

/** Human label for an artifact, from an absolute URL or a storage path. `index` is 0-based. */
export function figureLabel(url: string, index: number): string {
  return rawFigureLabel(url, index);
}
