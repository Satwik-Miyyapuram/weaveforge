/**
 * Use-cases for plan milestones. Orchestration only (DIP): add, edit, change
 * status, and remove. Validation lives in the domain module.
 */

import {
  createMilestone,
  validateCompute,
  validateDependencies,
  MilestoneValidationError,
  type EditMilestoneInput,
  type Milestone,
  type MilestoneStatus,
  type NewMilestoneInput,
} from "../domain/milestone.js";
import type { IMilestoneRepository } from "../domain/milestone-repository.js";
import type { Clock, IdGenerator } from "../../../shared/clock.js";

export interface ManageMilestoneDeps {
  repository: IMilestoneRepository;
  clock: Clock;
  ids: IdGenerator;
}

export class ManageMilestoneUseCase {
  constructor(private readonly deps: ManageMilestoneDeps) {}

  async add(input: NewMilestoneInput): Promise<Milestone> {
    const milestone = createMilestone(input, {
      clock: this.deps.clock,
      ids: this.deps.ids,
    });
    await this.deps.repository.save(milestone);
    return milestone;
  }

  async setStatus(id: string, status: MilestoneStatus): Promise<Milestone> {
    return this.mutate(id, (m) => ({ ...m, status }));
  }

  async update(id: string, input: EditMilestoneInput): Promise<Milestone> {
    if (input.title != null && !input.title.trim()) {
      throw new MilestoneValidationError("Milestone title is required.");
    }
    if (input.targetDate != null && input.targetDate !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(input.targetDate)) {
      throw new MilestoneValidationError("Target date must be yyyy-mm-dd.");
    }
    if (input.dependencies) validateDependencies(input.dependencies);
    if (input.compute) validateCompute(input.compute);
    return this.mutate(id, (m) => ({
      ...m,
      title: input.title?.trim() || m.title,
      description: input.description ?? m.description,
      status: input.status ?? m.status,
      targetDate: input.targetDate === "" ? undefined : input.targetDate ?? m.targetDate,
      dependencies: input.dependencies ?? m.dependencies,
      compute: input.compute ?? m.compute,
    }));
  }

  async remove(id: string): Promise<void> {
    await this.deps.repository.delete(id);
  }

  private async mutate(id: string, change: (m: Milestone) => Milestone): Promise<Milestone> {
    const existing = await this.deps.repository.getById(id);
    if (!existing) throw new MilestoneValidationError(`No milestone with id "${id}".`);
    const updated = change(existing);
    await this.deps.repository.save(updated);
    return updated;
  }
}
