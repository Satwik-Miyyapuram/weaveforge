/**
 * Use-cases for plan milestones. Orchestration only (DIP): add, edit, change
 * status, and remove. Validation lives in the domain module.
 */

import { MilestoneValidationError, type EditMilestoneInput, type Milestone, type MilestoneStatus, type NewMilestoneInput } from "../domain/milestone.js";
import type { IMilestoneRepository } from "../domain/milestone-repository.js";
import type { Clock, IdGenerator } from "../../../shared/parts.js";
import { NotFoundError } from "../../../shared/errors.js";
import { rust } from "../../../shared/rust.js";

export interface ManageMilestoneDeps {
  repository: IMilestoneRepository;
  clock: Clock;
  ids: IdGenerator;
}

export class ManageMilestoneUseCase {
  constructor(private readonly deps: ManageMilestoneDeps) {}

  async add(input: NewMilestoneInput): Promise<Milestone> {
    const milestone = rust().createMilestone(input, {
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
    if (input.targetDate != null && input.targetDate !== "" && !rust().isIsoDay(input.targetDate)) {
      throw new MilestoneValidationError("Target date must be yyyy-mm-dd.");
    }
    if (input.dependencies) rust().validateDependencies(input.dependencies);
    if (input.compute) rust().validateCompute(input.compute);
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
    // NotFound, not Validation: see the vault use case for the reasoning.
    if (!existing) throw new NotFoundError(`No milestone with id "${id}".`);
    const updated = change(existing);
    await this.deps.repository.save(updated);
    return updated;
  }
}
