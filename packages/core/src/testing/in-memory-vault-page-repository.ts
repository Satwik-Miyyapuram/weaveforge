import {
  buildPageTree,
  vaultBodyPreview,
  type VaultPage,
  type VaultPageFilter,
  type VaultPageSummary,
  type VaultPageTreeNode,
} from "../features/vault/domain/vault-page.js";
import type { IVaultPageRepository } from "../features/vault/domain/vault-page-repository.js";

export class InMemoryVaultPageRepository implements IVaultPageRepository {
  private readonly store = new Map<string, VaultPage>();

  async getById(id: string): Promise<VaultPage | null> {
    return this.store.get(id) ?? null;
  }

  async list(filter?: VaultPageFilter): Promise<VaultPage[]> {
    let items = [...this.store.values()];
    if (filter?.parentId !== undefined) {
      const target = filter.parentId ?? undefined;
      items = items.filter((p) => (p.parentId ?? undefined) === target);
    }
    if (filter?.query) {
      const needle = filter.query.toLowerCase();
      items = items.filter(
        (p) =>
          p.title.toLowerCase().includes(needle) ||
          p.body.toLowerCase().includes(needle),
      );
    }
    return items.sort(
      (a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title),
    );
  }

  /**
   * The card/tree projection, modelled honestly (review-2 F6): no `body` field
   * at all, exactly as the Supabase adapter's reduced column list produces.
   * Spreading the full page and blanking `body` was the double that made the
   * real projection look like a full entity.
   */
  async listSummaries(): Promise<VaultPageSummary[]> {
    const items = await this.list();
    return items.map((p) => ({
      id: p.id,
      title: p.title,
      bodyPreview: vaultBodyPreview(p.body),
      parentId: p.parentId,
      pinned: p.pinned,
      sortOrder: p.sortOrder,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    }));
  }

  async getTree(): Promise<VaultPageTreeNode[]> {
    return buildPageTree([...this.store.values()]);
  }

  async save(entity: VaultPage): Promise<void> {
    this.store.set(entity.id, { ...entity });
  }

  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }
}
