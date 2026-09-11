/**
 * Use-case for experiments. Orchestration only (DIP): add, change status
 * (stamping started/finished timestamps), and record metrics.
 */
import {
  createExperiment,
  ExperimentValidationError,
  statusPatchForExperiment,
  type Experiment,
  type ExperimentStatus,
  type NewExperimentInput,
} from "../domain/experiment.js";
import type { IExperimentRepository } from "../domain/experiment-repository.js";
import type { Clock, IdGenerator } from "../../../shared/clock.js";
import { NotFoundError } from "../../../shared/errors.js";

export interface ManageExperimentDeps {
  repository: IExperimentRepository;
  clock: Clock;
  ids: IdGenerator;
}

export class ManageExperimentUseCase {
  constructor(private readonly deps: ManageExperimentDeps) {}

  async add(input: NewExperimentInput): Promise<Experiment> {
    const exp = createExperiment(input, { clock: this.deps.clock, ids: this.deps.ids });
    await this.deps.repository.save(exp);
    return exp;
  }

  /**
   * Move a run to `status`.
   *
   * The timestamp rules live on {@link statusPatchForExperiment} so the
   * `finishedAt` invariant has one definition: set while terminal, cleared when
   * the run is reopened. Reopening used to leave the old end time in place.
   */
  async setStatus(id: string, status: ExperimentStatus): Promise<Experiment> {
    return this.mutate(id, (e) => ({
      ...e,
      ...statusPatchForExperiment(e, status, this.deps.clock.nowIso()),
    }));
  }

  async recordMetrics(id: string, metrics: Record<string, unknown>): Promise<Experiment> {
    return this.mutate(id, (e) => ({ ...e, metrics: { ...e.metrics, ...metrics } }));
  }

  /**
   * Attach artifacts to a run that has already finished.
   *
   * The SDK writes these while a run is going; a person writes them afterwards,
   * when the plot that explains the result was drawn by hand. Appended rather
   * than replaced, and existing entries are kept in their order: the figures of
   * a run read as a sequence, and a re-upload should not reshuffle them.
   */
  async addArtifacts(id: string, entries: readonly string[]): Promise<Experiment> {
    return this.mutate(id, (e) => {
      const known = new Set(e.artifacts);
      return { ...e, artifacts: [...e.artifacts, ...entries.filter((entry) => !known.has(entry))] };
    });
  }

  async remove(id: string): Promise<void> {
    await this.deps.repository.delete(id);
  }

  private async mutate(id: string, change: (e: Experiment) => Experiment): Promise<Experiment> {
    const existing = await this.deps.repository.getById(id);
    // NotFound, not Validation: see the vault use case for the reasoning.
    if (!existing) throw new NotFoundError(`No experiment with id "${id}".`);
    const updated = change(existing);
    await this.deps.repository.save(updated);
    return updated;
  }
}
