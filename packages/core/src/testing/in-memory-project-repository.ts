import type { Project } from "../features/projects/domain/project.js";
import type { IProjectRepository } from "../features/projects/domain/project-repository.js";

export class InMemoryProjectRepository implements IProjectRepository {
  private readonly store = new Map<string, Project>();
  async getById(id: string): Promise<Project | null> {
    return this.store.get(id) ?? null;
  }
  async list(): Promise<Project[]> {
    return [...this.store.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  async save(entity: Project): Promise<void> {
    this.store.set(entity.id, { ...entity });
  }
  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }
}
