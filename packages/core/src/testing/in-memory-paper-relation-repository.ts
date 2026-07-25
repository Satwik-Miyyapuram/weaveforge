/**
 * In-memory implementation of IPaperRelationRepository.
 *
 * Reference implementation for tests and the Liskov substitutability contract.
 */

import type {
  PaperRelation,
  PaperRelationFilter,
  RelationType,
} from "../features/relations/domain/paper-relation.js";
import type { IPaperRelationRepository } from "../features/relations/domain/paper-relation-repository.js";

export class InMemoryPaperRelationRepository
  implements IPaperRelationRepository
{
  private readonly store = new Map<string, PaperRelation>();

  async getById(id: string): Promise<PaperRelation | null> {
    return this.store.get(id) ?? null;
  }

  async list(filter?: PaperRelationFilter): Promise<PaperRelation[]> {
    let items = [...this.store.values()];
    if (filter?.relation) items = items.filter((r) => r.relation === filter.relation);
    if (filter?.fromPaper) items = items.filter((r) => r.fromPaper === filter.fromPaper);
    if (filter?.toPaper) items = items.filter((r) => r.toPaper === filter.toPaper);
    return items.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async getGraph(): Promise<PaperRelation[]> {
    return [...this.store.values()];
  }

  async relationsFor(paperId: string): Promise<PaperRelation[]> {
    return [...this.store.values()].filter(
      (r) => r.fromPaper === paperId || r.toPaper === paperId,
    );
  }

  async findEdge(
    fromPaper: string,
    toPaper: string,
    relation: RelationType,
  ): Promise<PaperRelation | null> {
    for (const r of this.store.values()) {
      if (r.fromPaper === fromPaper && r.toPaper === toPaper && r.relation === relation) {
        return r;
      }
    }
    return null;
  }

  async save(entity: PaperRelation): Promise<void> {
    this.store.set(entity.id, { ...entity });
  }

  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }
}
