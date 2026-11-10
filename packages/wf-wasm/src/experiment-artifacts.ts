/**
 * Experiment artifact names and view URLs (Rust `experiment_artifacts`), re-exported from index.ts.
 * Each function keeps the signature of apps/web/src/features/experiments/infrastructure/experiment-artifact-store.ts.
 */
import {
  artifactKind as rawArtifactKind,
  isAbsoluteEntry as rawIsAbsoluteEntry,
  isAbsoluteUrl as rawIsAbsoluteUrl,
  safeName as rawSafeName,
  viewableArtifactUrl as rawViewableArtifactUrl,
} from "../pkg/wf_wasm.js";

/** Whether a stored entry is an `app://artifacts/` entry or an `http`/`https` URL. */
export function isAbsoluteUrl(value: string): boolean {
  return rawIsAbsoluteUrl(value);
}

/**
 * Whether a listed artifact entry is absolute: `app://artifacts/`, a `data:` URI, or text
 * starting with `http://` or `https://` in any case. Nothing is parsed.
 */
export function isAbsoluteEntry(entry: string): boolean {
  return rawIsAbsoluteEntry(entry);
}

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

/** How a stored entry is shown: an image, a PDF, or a link. */
export type ArtifactKind = "image" | "pdf" | "link";

/** The kind of a stored entry, from its MIME type (`data:`) or the extension of its path. */
export function artifactKind(entry: string): ArtifactKind {
  return rawArtifactKind(entry) as ArtifactKind;
}
