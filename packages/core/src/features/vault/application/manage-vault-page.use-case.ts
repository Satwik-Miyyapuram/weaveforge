/**
 * Use-cases for vault pages — orchestration only.
 */

import {
  createVaultPage,
  normalizeTitleKey,
  VaultPageValidationError,
  type NewVaultPageInput,
  type VaultPage,
} from "../domain/vault-page.js";
import type { IVaultPageRepository } from "../domain/vault-page-repository.js";
import type { Clock, IdGenerator } from "../../../shared/clock.js";

export interface EditVaultPageInput {
  title?: string;
  body?: string;
}

export interface ManageVaultPageDeps {
  repository: IVaultPageRepository;
  clock: Clock;
  ids: IdGenerator;
}

export class ManageVaultPageUseCase {
  constructor(private readonly deps: ManageVaultPageDeps) {}

  async add(input: NewVaultPageInput): Promise<VaultPage> {
    const page = createVaultPage(input, {
      clock: this.deps.clock,
      ids: this.deps.ids,
    });
    await this.assertTitleUnique(page.title);
    await this.deps.repository.save(page);
    return page;
  }

  /**
   * Titles are unique per project (case-insensitive) so `[[wikilinks]]` resolve
   * to exactly one note. A DB unique index is the hard guard against races; this
   * check exists to surface a clear message instead of a raw constraint error.
   */
  private async assertTitleUnique(title: string, exceptId?: string): Promise<void> {
    const key = normalizeTitleKey(title);
    const existing = await this.deps.repository.list();
    if (existing.some((p) => p.id !== exceptId && normalizeTitleKey(p.title) === key)) {
      throw new VaultPageValidationError(`A note titled “${title.trim()}” already exists.`);
    }
  }

  async update(id: string, input: EditVaultPageInput): Promise<VaultPage> {
    const existing = await this.deps.repository.getById(id);
    if (!existing) {
      throw new VaultPageValidationError(`No vault page with id "${id}".`);
    }
    const title = input.title !== undefined ? input.title.trim() : existing.title;
    if (!title) {
      throw new VaultPageValidationError("Page title is required.");
    }
    if (normalizeTitleKey(title) !== normalizeTitleKey(existing.title)) {
      await this.assertTitleUnique(title, id);
    }
    const updated: VaultPage = {
      ...existing,
      title,
      body: input.body !== undefined ? input.body : existing.body,
      updatedAt: this.deps.clock.nowIso(),
    };
    await this.deps.repository.save(updated);
    return updated;
  }

  async remove(id: string): Promise<void> {
    await this.deps.repository.delete(id);
  }
}
