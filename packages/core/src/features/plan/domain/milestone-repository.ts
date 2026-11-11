/** Repository contract for plan milestones (DIP). */
import type {
  IReadableRepository,
  IWritableRepository,
} from "../../../shared/parts.js";
import type { Milestone, MilestoneFilter } from "./milestone.js";

export interface IMilestoneRepository
  extends IReadableRepository<Milestone, MilestoneFilter>,
    IWritableRepository<Milestone> {}
