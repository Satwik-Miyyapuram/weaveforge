/**
 * Plan domain model — pure, no I/O. A Milestone is a forward-looking unit of
 * the thesis plan: what must be done, by when, what it depends on, and what
 * compute it needs. One reason to change: the rules of what a milestone *is*.
 */

import type { Identifiable } from "../../../shared/repository.js";
import type { Clock, IdGenerator } from "../../../shared/clock.js";

export type MilestoneStatus = "planned" | "in_progress" | "done" | "blocked";

export const MILESTONE_STATUSES: readonly MilestoneStatus[] = [
  "planned",
  "in_progress",
  "done",
  "blocked",
];

/** What a dependency points at. Internal kinds reference entities by id. */
export type DependencyKind = "milestone" | "experiment" | "paper" | "external";

export const DEPENDENCY_KINDS: readonly DependencyKind[] = [
  "milestone",
  "experiment",
  "paper",
  "external",
];

/**
 * A structured dependency. Internal kinds (`milestone`/`experiment`/`paper`)
 * carry the referenced entity's id; `external` is free-form (dataset access,
 * supervisor sign-off, cluster account, …) and carries only a label.
 */
export interface MilestoneDependency {
  kind: DependencyKind;
  /** Referenced entity id (internal kinds). */
  refId?: string;
  /** Human label. Required for `external`; optional display cache otherwise. */
  label?: string;
}

/** A compute requirement, e.g. { resource: "A100", count: 4, hours: 200 }. */
export interface ComputeNeed {
  /** Resource name: GPU model, cluster partition, "CPU", "storage", … */
  resource: string;
  /** Number of units (GPUs, nodes). */
  count?: number;
  /** Estimated hours of use. */
  hours?: number;
  notes?: string;
}

export interface Milestone extends Identifiable {
  id: string;
  title: string;
  description?: string;
  status: MilestoneStatus;
  /** Target date (yyyy-mm-dd). */
  targetDate?: string;
  dependencies: MilestoneDependency[];
  compute: ComputeNeed[];
  createdAt: string;
}

export interface NewMilestoneInput {
  title: string;
  description?: string;
  status?: MilestoneStatus;
  targetDate?: string;
  dependencies?: MilestoneDependency[];
  compute?: ComputeNeed[];
}

/** Editable fields of an existing milestone (id/createdAt preserved). */
export interface EditMilestoneInput {
  title?: string;
  description?: string;
  status?: MilestoneStatus;
  targetDate?: string;
  dependencies?: MilestoneDependency[];
  compute?: ComputeNeed[];
}

export interface MilestoneFilter {
  status?: MilestoneStatus;
  /** Case-insensitive substring match against title. */
  titleContains?: string;
}

export class MilestoneValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MilestoneValidationError";
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Validate a dependency list; throws on structurally invalid entries. */
export function validateDependencies(deps: MilestoneDependency[]): void {
  for (const d of deps) {
    if (!DEPENDENCY_KINDS.includes(d.kind)) {
      throw new MilestoneValidationError(`Unknown dependency kind "${d.kind}".`);
    }
    if (d.kind === "external") {
      if (!d.label?.trim()) {
        throw new MilestoneValidationError("External dependencies need a label.");
      }
    } else if (!d.refId?.trim()) {
      throw new MilestoneValidationError(`A ${d.kind} dependency needs a refId.`);
    }
  }
}

/** Validate compute needs; throws on invalid entries. */
export function validateCompute(compute: ComputeNeed[]): void {
  for (const c of compute) {
    if (!c.resource?.trim()) {
      throw new MilestoneValidationError("Compute needs a resource name.");
    }
    if (c.count != null && (!Number.isFinite(c.count) || c.count <= 0)) {
      throw new MilestoneValidationError("Compute count must be a positive number.");
    }
    if (c.hours != null && (!Number.isFinite(c.hours) || c.hours < 0)) {
      throw new MilestoneValidationError("Compute hours cannot be negative.");
    }
  }
}

export function createMilestone(
  input: NewMilestoneInput,
  deps: { clock: Clock; ids: IdGenerator },
): Milestone {
  const title = input.title?.trim();
  if (!title) throw new MilestoneValidationError("Milestone title is required.");
  if (input.targetDate && !DATE_RE.test(input.targetDate)) {
    throw new MilestoneValidationError("Target date must be yyyy-mm-dd.");
  }
  const dependencies = input.dependencies ?? [];
  const compute = input.compute ?? [];
  validateDependencies(dependencies);
  validateCompute(compute);
  return {
    id: deps.ids.newId(),
    title,
    description: input.description,
    status: input.status ?? "planned",
    targetDate: input.targetDate,
    dependencies,
    compute,
    createdAt: deps.clock.nowIso(),
  };
}
