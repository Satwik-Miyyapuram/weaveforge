import type {
  Milestone,
  MilestoneFilter,
} from "../features/plan/domain/milestone.js";
import type { IMilestoneRepository } from "../features/plan/domain/milestone-repository.js";

export class InMemoryMilestoneRepository implements IMilestoneRepository {
  private readonly store = new Map<string, Milestone>();
  async getById(id: string): Promise<Milestone | null> {
    return this.store.get(id) ?? null;
  }
  async list(filter?: MilestoneFilter): Promise<Milestone[]> {
    let items = [...this.store.values()];
    if (filter?.status) items = items.filter((m) => m.status === filter.status);
    if (filter?.titleContains) {
      const t = filter.titleContains.toLowerCase();
      items = items.filter((m) => m.title.toLowerCase().includes(t));
    }
    // Soonest target first; undated milestones sink to the end.
    return items.sort((a, b) =>
      (a.targetDate ?? "9999-99-99").localeCompare(b.targetDate ?? "9999-99-99"),
    );
  }
  async save(entity: Milestone): Promise<void> {
    this.store.set(entity.id, { ...entity });
  }
  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }
}
