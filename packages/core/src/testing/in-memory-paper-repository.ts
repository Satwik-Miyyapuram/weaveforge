/**
 * In-memory implementation of IPaperRepository.
 *
 * Used by unit tests for the domain/application layers, and as the reference
 * against which the Supabase implementation is checked for Liskov
 * substitutability via the shared contract test suite.
 */

import {
  normalizeDoi,
  type Paper,
  type PaperFilter,
  type PaperSummary,
} from "../features/papers/domain/paper.js";
import type { IPaperRepository } from "../features/papers/domain/paper-repository.js";
import type { PaperIdentity } from "../features/papers/domain/paper-identity.js";

export class InMemoryPaperRepository implements IPaperRepository {
  private readonly store = new Map<string, Paper>();

  async getById(id: string): Promise<Paper | null> {
    return this.store.get(id) ?? null;
  }

  /**
   * The card projection.
   *
   * This store holds whole papers and has no cheaper read, so it returns them —
   * which the type allows, because a `Paper` satisfies `PaperSummary`. What it
   * may not do is claim the caller can rely on the abstract: the return type
   * says otherwise, and that is the point of it being required rather than a
   * fallback each caller writes for itself.
   */
  async listSummaries(): Promise<PaperSummary[]> {
    return this.list();
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

  /**
   * The narrow lookup, derived from the rows this store already holds.
   *
   * A real adapter answers this with three columns; here the row *is* in memory,
   * so there is nothing to save — but the type still narrows, which is what keeps
   * a caller from quietly starting to read the abstract.
   */
  async findIdentityByArxivId(arxivId: string): Promise<PaperIdentity | null> {
    const paper = await this.findByArxivId(arxivId);
    return paper ? identityOf(paper) : null;
  }

  async findIdentityByDoi(doi: string): Promise<PaperIdentity | null> {
    const paper = await this.findByDoi(doi);
    return paper ? identityOf(paper) : null;
  }
}

function identityOf(paper: Paper): PaperIdentity {
  return { id: paper.id, title: paper.title, status: paper.status };
}
