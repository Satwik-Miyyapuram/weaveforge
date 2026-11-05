/**
 * Milestone domain rules (Rust `milestone`), re-exported from index.ts.
 * Each function keeps the signature of packages/core/src/features/plan/domain/milestone.ts.
 */
import {
  createMilestoneWith as rawCreateMilestoneWith,
  isIsoDay as rawIsIsoDay,
  milestoneInputError as rawMilestoneInputError,
  validateComputeError as rawValidateComputeError,
  validateDependenciesError as rawValidateDependenciesError,
} from "../pkg/wf_wasm.js";
import type {
  ComputeNeed,
  DependencyKind,
  Milestone,
  MilestoneDependency,
  MilestoneStatus,
  NewMilestoneInput,
} from "./bindings.js";

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

/** True for a `yyyy-mm-dd` day that is on the calendar. */
export function isIsoDay(value: string): boolean {
  return rawIsIsoDay(value);
}

/** The validation message for a dependency list, if it is invalid. */
export function validateDependenciesError(deps: MilestoneDependency[]): string | undefined {
  return rawValidateDependenciesError(deps);
}

/** The validation message for compute needs, if they are invalid. */
export function validateComputeError(compute: ComputeNeed[]): string | undefined {
  return rawValidateComputeError(compute);
}

/** The validation message for milestone input, if it is invalid. */
export function milestoneInputError(input: NewMilestoneInput): string | undefined {
  return rawMilestoneInputError(input);
}

/** A new milestone from valid input, with the id and timestamp given. */
export function createMilestoneWith(input: NewMilestoneInput, id: string, createdAt: string): Milestone {
  return rawCreateMilestoneWith(input, id, createdAt) as Milestone;
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
