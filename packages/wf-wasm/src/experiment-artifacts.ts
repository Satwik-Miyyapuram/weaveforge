/**
 * Experiment artifact names and view URLs (Rust `experiment_artifacts`), re-exported from index.ts.
 * Each function keeps the signature of apps/web/src/features/experiments/infrastructure/experiment-artifact-store.ts.
 */
export {
  artifactKind,
  isAbsoluteEntry,
  isAbsoluteUrl,
  safeName,
  viewableArtifactUrl,
} from "../pkg/wf_wasm.js";

/** How a stored entry is shown: an image, a PDF, or a link. */
export type ArtifactKind = "image" | "pdf" | "link";

