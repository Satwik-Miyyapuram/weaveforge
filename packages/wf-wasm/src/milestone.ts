/**
 * Milestone domain rules (Rust `milestone`), re-exported from index.ts.
 * Each function keeps the signature of packages/core/src/features/plan/domain/milestone.ts.
 */
import {
  createMilestoneWith,
  milestoneInputError,
  validateComputeError,
  validateDependenciesError,
} from "../pkg/wf_wasm.js";
import type {
  ComputeNeed,
  DependencyKind,
  Milestone,
  MilestoneDependency,
  MilestoneStatus,
  NewMilestoneInput,
} from "./bindings.js";

export {
  createMilestoneWith,
  isIsoDay,
  isoDayFromParts,
  milestoneInputError,
  validateComputeError,
  validateDependenciesError,
} from "../pkg/wf_wasm.js";

/** Every milestone status. */
export const MILESTONE_STATUSES: readonly MilestoneStatus[] = ["planned", "in_progress", "done", "blocked"];

/** Every dependency kind. */
export const DEPENDENCY_KINDS: readonly DependencyKind[] = ["milestone", "experiment", "paper", "external"];

/** Throws `MilestoneValidationError` with the Rust validation message, if there is one. */
function throwIfInvalid(message: string | undefined): void {
  if (message == null) return;
  const error = new Error(message);
  error.name = "MilestoneValidationError";
  throw error;
}

/** Validate a dependency list; throws on structurally invalid entries. */
export function validateDependencies(deps: MilestoneDependency[]): void {
  throwIfInvalid(validateDependenciesError(deps));
}

/** Validate compute needs; throws on invalid entries. */
export function validateCompute(compute: ComputeNeed[]): void {
  throwIfInvalid(validateComputeError(compute));
}

/** A new milestone from caller input. Throws `MilestoneValidationError` before drawing an id. */
export function createMilestone(
  input: NewMilestoneInput,
  deps: { clock: { nowIso(): string }; ids: { newId(): string } },
): Milestone {
  throwIfInvalid(milestoneInputError(input));
  const id = deps.ids.newId();
  const now = deps.clock.nowIso();
  return createMilestoneWith(input, id, now);
}
