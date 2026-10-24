/**
 * In-memory implementation of IPaperRepository.
 *
 * Used by unit tests for the domain/application layers, and as the reference
 * against which the PostgREST implementation is checked for Liskov
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
import { titleKey } from "../features/papers/domain/paper-title.js";

export class InMemoryPaperRepository implements IPaperRepository {
  /**
   * Every paper goes in and comes out as a deep copy, as it would through a
   * database. Handing back the stored object let a caller change the library
   * without `save()`, and a test then passed for a reason the app does not share.
   */
  private readonly store = new Map<string, Paper>();

  async getById(id: string): Promise<Paper | null> {
    return copy(this.store.get(id));
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
    return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((p) => structuredClone(p));
  }

  async save(entity: Paper): Promise<void> {
    this.store.set(entity.id, structuredClone(entity));
  }

  async setTags(id: string, tags: string[], updatedAt: string): Promise<void> {
    const paper = this.store.get(id);
    if (paper) this.store.set(id, { ...paper, tags: [...tags], updatedAt });
  }

  async replaceSummary(
    id: string,
    expected: string | undefined,
    next: string,
    updatedAt: string,
  ): Promise<boolean> {
    const paper = this.store.get(id);
    // An empty summary is stored as none, the way the database column holds it.
    if (!paper || (paper.summary || undefined) !== (expected || undefined)) return false;
    this.store.set(id, { ...paper, summary: next || undefined, updatedAt });
    return true;
  }

  async findByTitleKey(key: string): Promise<Paper | null> {
    for (const p of this.store.values()) {
      if (titleKey(p.title) === key) return structuredClone(p);
    }
    return null;
  }

  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }

  async findByArxivId(arxivId: string): Promise<Paper | null> {
    for (const p of this.store.values()) {
      if (p.arxivId === arxivId) return structuredClone(p);
    }
    return null;
  }

  async findByDoi(doi: string): Promise<Paper | null> {
    const target = normalizeDoi(doi);
    for (const p of this.store.values()) {
      if (p.doi === target) return structuredClone(p);
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

function copy(paper: Paper | undefined): Paper | null {
  return paper ? structuredClone(paper) : null;
}

function identityOf(paper: Paper): PaperIdentity {
  return { id: paper.id, title: paper.title, status: paper.status };
}
