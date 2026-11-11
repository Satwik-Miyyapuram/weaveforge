/** Types for milestone. Its logic is in Rust (crates/wf-core, exposed by wf-wasm). */
import type { Identifiable } from "../../../shared/repository.js";
import { ValidationError } from "../../../shared/errors.js";

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

export class MilestoneValidationError extends ValidationError {
  constructor(message: string) {
    super(message);
    this.name = "MilestoneValidationError";
  }
}

