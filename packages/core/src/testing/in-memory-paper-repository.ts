/**
 * In-memory implementation of IPaperRepository.
 *
 * Used by unit tests for the domain/application layers, and as the reference
 * against which the Supabase implementation is checked for Liskov
 * substitutability via the shared contract test suite.
 */

import { normalizeDoi, type Paper, type PaperFilter } from "../features/papers/domain/paper.js";
import type { IPaperRepository } from "../features/papers/domain/paper-repository.js";

export class InMemoryPaperRepository implements IPaperRepository {
  private readonly store = new Map<string, Paper>();

  async getById(id: string): Promise<Paper | null> {
    return this.store.get(id) ?? null;
  }

  async list(filter?: PaperFilter): Promise<Paper[]> {
    let items = [...this.store.values()];
    if (filter?.status) {
      items = items.filter((p) => p.status === filter.status);
    }
    if (filter?.titleContains) {
      const needle = filter.titleContains.toLowerCase();
      items = items.filter((p) => p.title.toLowerCase().includes(needle));
    }
    if (filter?.arxivId) {
      items = items.filter((p) => p.arxivId === filter.arxivId);
    }
    if (filter?.doi) {
      const d = normalizeDoi(filter.doi);
      items = items.filter((p) => p.doi === d);
    }
    return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async save(entity: Paper): Promise<void> {
    this.store.set(entity.id, { ...entity });
  }

  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }

  async findByArxivId(arxivId: string): Promise<Paper | null> {
    for (const p of this.store.values()) {
      if (p.arxivId === arxivId) return p;
    }
    return null;
  }

  async findByDoi(doi: string): Promise<Paper | null> {
    const target = normalizeDoi(doi);
    for (const p of this.store.values()) {
      if (p.doi === target) return p;
    }
    return null;
  }
}
