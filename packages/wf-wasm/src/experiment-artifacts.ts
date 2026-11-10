/**
 * Experiment artifact names and view URLs (Rust `experiment_artifacts`), re-exported from index.ts.
 * Each function keeps the signature of apps/web/src/features/experiments/infrastructure/experiment-artifact-store.ts.
 */
import {
  viewableArtifactUrl as rawViewableArtifactUrl,
} from "../pkg/wf_wasm.js";

export {
  artifactKind,
  isAbsoluteEntry,
  isAbsoluteUrl,
  safeName,
} from "../pkg/wf_wasm.js";

/**
 * The URL to render for a stored entry, or null when a desktop-local path is refused.
 * Outside the Tauri shell, or for entries that are not `app://artifacts/` ones, the entry is returned unchanged.
 */
export function viewableArtifactUrl(entry: string, inShell: boolean): string | null {
  return rawViewableArtifactUrl(entry, inShell) ?? null;
}

/** How a stored entry is shown: an image, a PDF, or a link. */
export type ArtifactKind = "image" | "pdf" | "link";

