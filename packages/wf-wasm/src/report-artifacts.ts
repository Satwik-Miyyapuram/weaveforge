/**
 * Experiment artifact references in report markdown (Rust `report::artifact_refs` and
 * `report::artifact_markdown`), re-exported from index.ts. Each function keeps the signature of
 * the TS function it replaces in apps/web/src/features/report/application.
 */
import {
  resolveArtifactRefsMarkdown as rawResolveArtifactRefsMarkdown,
  safeArtifactCaption as rawSafeArtifactCaption,
  safeImageDestination as rawSafeImageDestination,
} from "../pkg/wf_wasm.js";
import type {
  ReportExperiment,
} from "./bindings.js";

export {
  artifactBasename,
  parseArtifactRefs,
  serialiseArtifactRef,
} from "../pkg/wf_wasm.js";

/** Replaces each reference with its figure, or a warning line. `nowMs` drives the stale check. */
export function resolveArtifactRefsMarkdown(
  body: string,
  experiments: readonly ReportExperiment[],
  nowMs: number = Date.now(),
): string {
  return rawResolveArtifactRefsMarkdown(body, experiments, nowMs);
}

/** Alt text made safe for a caption; `artifact` when nothing is left. */
export function safeArtifactCaption(alt?: string | null): string {
  return rawSafeArtifactCaption(alt ?? undefined);
}

/** An image URL safe to put in a destination, or null when the scheme or characters are not allowed. */
export function safeImageDestination(url: string): string | null {
  return rawSafeImageDestination(url) ?? null;
}
