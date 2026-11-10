/**
 * Milestone dependency chip target (Rust `plan::chip`), re-exported from index.ts.
 */
import { planChipTarget as rawPlanChipTarget } from "../pkg/wf_wasm.js";
import type { ChipMilestone, ChipTarget, MilestoneDependency } from "./bindings.js";

/**
 * Where a dependency chip goes when tapped. `known` is the ids still present;
 * `milestones` resolves a title-only milestone reference.
 */
export function planChipTarget(
  dep: MilestoneDependency,
  known: readonly string[],
  milestones: readonly ChipMilestone[],
  isOfflineBuild: boolean,
): ChipTarget {
  return rawPlanChipTarget(dep, [...known], milestones, isOfflineBuild) as ChipTarget;
}
