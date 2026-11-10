/**
 * Metric downsampling (Rust `experiments`) and Overleaf link rules (Rust `overleaf`),
 * re-exported from index.ts. Signatures match the removed TS in
 * packages/core experiments/domain/downsample-metrics.ts and apps/web overleaf/domain/link-rules.ts.
 */
import {
  entryFileError as rawEntryFileError,
  parseOverleafProjectId as rawParseOverleafProjectId,
  planSeriesIngestIndices as rawPlanSeriesIngestIndices,
  sanitizeSectionTargets as rawSanitizeSectionTargets,
  stepsToPrune as rawStepsToPrune,
} from "../pkg/wf_wasm.js";

export {
  isOnSamplingGrid,
  isOverleafProjectId,
  overleafExternalUrl,
  overleafExternalUrl as externalUrl,
  overleafGitUrl,
  strideForStep,
} from "../pkg/wf_wasm.js";

/** What to store for one series: grid points plus the newest, and a superseded tip to delete. */
export function planSeriesIngest<T extends { step: number }>(
  points: readonly T[],
  previousMaxStep: number | null,
): { keep: T[]; supersededTipStep: number | null } {
  const plan = rawPlanSeriesIngestIndices(
    Float64Array.from(points, (p) => p.step),
    previousMaxStep ?? undefined,
  ) as { keep: number[]; supersededTipStep: number | null };
  return { keep: plan.keep.map((i) => points[i]!), supersededTipStep: plan.supersededTipStep ?? null };
}

/** Steps to delete from a stored series: off-grid steps, except the newest. */
export function stepsToPrune(storedSteps: readonly number[]): number[] {
  return Array.from(rawStepsToPrune(Float64Array.from(storedSteps)));
}

/** The message for an unsafe entry file path, or null. */
export function entryFileError(entryFile: string): string | null {
  return rawEntryFileError(entryFile) ?? null;
}

/** The project id from a pasted id, project page or git URL; null otherwise. */
export function parseOverleafProjectId(raw: string): string | null {
  return rawParseOverleafProjectId(raw) ?? null;
}

/** The { sectionKey -> targetWords } map with null targets dropped, or null when malformed. */
export function sanitizeSectionTargets(input: unknown): Record<string, number> | null {
  return (rawSanitizeSectionTargets(input) as Record<string, number> | null) ?? null;
}

/** Indices of the steps to keep and the superseded tip (Rust `plan_series_ingest`). */
export function planSeriesIngestIndices(
  steps: Float64Array,
  previousMaxStep?: number | null,
): { keep: number[]; supersededTipStep: number | null } {
  return rawPlanSeriesIngestIndices(steps, previousMaxStep) as { keep: number[]; supersededTipStep: number | null };
}
