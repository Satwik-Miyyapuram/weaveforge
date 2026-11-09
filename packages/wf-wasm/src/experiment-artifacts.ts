/**
 * Experiment artifact names and view URLs (Rust `experiment_artifacts`), re-exported from index.ts.
 * Each function keeps the signature of apps/web/src/features/experiments/infrastructure/experiment-artifact-store.ts.
 */
import {
  safeName as rawSafeName,
  viewableArtifactUrl as rawViewableArtifactUrl,
} from "../pkg/wf_wasm.js";

/** A filename that is safe as one storage key segment; `artifact` when nothing survives. */
export function safeName(name: string): string {
  return rawSafeName(name);
}

/**
 * The URL to render for a stored entry, or null when a desktop-local path is refused.
 * Outside the Tauri shell, or for entries that are not `app://artifacts/` ones, the entry is returned unchanged.
 */
export function viewableArtifactUrl(entry: string, inShell: boolean): string | null {
  return rawViewableArtifactUrl(entry, inShell) ?? null;
}
