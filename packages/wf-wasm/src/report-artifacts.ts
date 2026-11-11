/**
 * Experiment artifact references in report markdown (Rust `report::artifact_refs` and
 * `report::artifact_markdown`), re-exported from index.ts. Each function keeps the signature of
 * the TS function it replaces in apps/web/src/features/report/application.
 */
import {
  resolveArtifactRefsMarkdown as rawResolveArtifactRefsMarkdown,
} from "../pkg/wf_wasm.js";
import type {
  ReportExperiment,
} from "./bindings.js";

export {
  artifactBasename,
  parseArtifactRefs,
  safeArtifactCaption,
  safeImageDestination,
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
