/**
 * Experiment artifact references in report markdown (Rust `report::artifact_refs` and
 * `report::artifact_markdown`), re-exported from index.ts. Each function keeps the signature of
 * the TS function it replaces in apps/web/src/features/report/application.
 */
import {
  artifactBasename as rawArtifactBasename,
  parseArtifactRefs as rawParseArtifactRefs,
  resolveArtifactRefsMarkdown as rawResolveArtifactRefsMarkdown,
  safeArtifactCaption as rawSafeArtifactCaption,
  safeImageDestination as rawSafeImageDestination,
  serialiseArtifactRef as rawSerialiseArtifactRef,
} from "../pkg/wf_wasm.js";
import type { ArtifactRef, ParsedArtifactRef, ReportExperiment } from "./bindings.js";

/** Every `expartifact:` reference in the markdown, with UTF-16 start and end offsets. */
export function parseArtifactRefs(markdown: string): ParsedArtifactRef[] {
  return rawParseArtifactRefs(markdown) as ParsedArtifactRef[];
}

/** The canonical markdown for a reference. */
export function serialiseArtifactRef(artifactRef: ArtifactRef): string {
  return rawSerialiseArtifactRef(artifactRef);
}

/** The last path segment of an artifact URL or name, so a signed URL matches its plain name. */
export function artifactBasename(name: string): string {
  return rawArtifactBasename(name);
}

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
