/**
 * Use-case for experiments. Orchestration only (DIP): add, change status
 * (stamping started/finished timestamps), and record metrics.
 */
import {
  createExperiment,
  ExperimentValidationError,
  type Experiment,
  type ExperimentStatus,
  type NewExperimentInput,
} from "../domain/experiment.js";
import type { IExperimentRepository } from "../domain/experiment-repository.js";
import type { Clock, IdGenerator } from "../../../shared/clock.js";

const TERMINAL: ExperimentStatus[] = ["done", "failed", "abandoned"];

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

  async setStatus(id: string, status: ExperimentStatus): Promise<Experiment> {
    return this.mutate(id, (e) => {
      const now = this.deps.clock.nowIso();
      return {
        ...e,
        status,
        startedAt: status === "running" && !e.startedAt ? now : e.startedAt,
        finishedAt: TERMINAL.includes(status) ? now : e.finishedAt,
      };
    });
  }

  async recordMetrics(id: string, metrics: Record<string, unknown>): Promise<Experiment> {
    return this.mutate(id, (e) => ({ ...e, metrics: { ...e.metrics, ...metrics } }));
  }

  async remove(id: string): Promise<void> {
    await this.deps.repository.delete(id);
  }

  private async mutate(id: string, change: (e: Experiment) => Experiment): Promise<Experiment> {
    const existing = await this.deps.repository.getById(id);
    if (!existing) throw new ExperimentValidationError(`No experiment with id "${id}".`);
    const updated = change(existing);
    await this.deps.repository.save(updated);
    return updated;
  }
}
