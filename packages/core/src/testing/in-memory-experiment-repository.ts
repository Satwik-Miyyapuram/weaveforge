import type {
  Experiment,
  ExperimentFilter,
} from "../features/experiments/domain/experiment.js";
import type { IExperimentRepository } from "../features/experiments/domain/experiment-repository.js";

export class InMemoryExperimentRepository implements IExperimentRepository {
  private readonly store = new Map<string, Experiment>();
  async getById(id: string): Promise<Experiment | null> {
    return this.store.get(id) ?? null;
  }
  async list(filter?: ExperimentFilter): Promise<Experiment[]> {
    let items = [...this.store.values()];
    if (filter?.status) items = items.filter((e) => e.status === filter.status);
    if (filter?.relatedPaper) items = items.filter((e) => e.relatedPaper === filter.relatedPaper);
    if (filter?.nameContains) {
      const n = filter.nameContains.toLowerCase();
      items = items.filter((e) => e.name.toLowerCase().includes(n));
    }
    return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async save(entity: Experiment): Promise<void> {
    this.store.set(entity.id, { ...entity });
  }
  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }
}
