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
import { NotFoundError } from "../../../shared/errors.js";
import { assertNotUnder } from "../../../shared/tree.js";

export interface EditVaultPageInput {
  title?: string;
  body?: string;
  /** A new parent; `null` moves the page to the top level. Absent leaves it. */
  parentId?: string | null;
  /** Pin or unpin the note. Absent leaves it. */
  pinned?: boolean;
  /** Make the page a folder or a note. Absent leaves it. */
  isFolder?: boolean;
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
    if (page.parentId) await this.assertFolder(page.parentId);
    await this.deps.repository.save(page);
    return page;
  }

  /**
   * Titles are unique per project (case-insensitive) so `[[wikilinks]]` resolve
   * to exactly one note. A DB unique index is the hard guard against races; this
   * check exists to surface a clear message instead of a raw constraint error.
   */
  private async assertTitleUnique(title: string, exceptId?: string): Promise<void> {
    if (await this.deps.repository.titleTaken(title, exceptId)) {
      throw new VaultPageValidationError(`A note titled “${title.trim()}” already exists.`);
    }
  }

  async update(id: string, input: EditVaultPageInput): Promise<VaultPage> {
    const existing = await this.deps.repository.getById(id);
    if (!existing) {
      // Not-found, not invalid input: the id is well-formed and the request was
      // fine — the row is gone. A route maps this to 404 (F5 of review 2; this
      // used to arrive as a validation error, i.e. 400).
      throw new NotFoundError(`No vault page with id "${id}".`);
    }
    const title = input.title !== undefined ? input.title.trim() : existing.title;
    if (!title) {
      throw new VaultPageValidationError("Page title is required.");
    }
    if (normalizeTitleKey(title) !== normalizeTitleKey(existing.title)) {
      await this.assertTitleUnique(title, id);
    }
    if (input.parentId !== undefined && input.parentId !== null) {
      await this.assertNotUnderSelf(input.parentId, id);
      await this.assertFolder(input.parentId);
    }
    const updated: VaultPage = {
      ...existing,
      title,
      body: input.body !== undefined ? input.body : existing.body,
      ...(input.parentId === undefined
        ? {}
        : { parentId: input.parentId === null ? undefined : input.parentId }),
      ...(input.pinned === undefined ? {} : { pinned: input.pinned }),
      ...(input.isFolder === undefined ? {} : { isFolder: input.isFolder }),
      updatedAt: this.deps.clock.nowIso(),
    };
    await this.deps.repository.save(updated);
    return updated;
  }

  /**
   * Pages go in folders, never under a note. A page that already holds pages
   * counts as a folder: notes nested before the flag existed keep working.
   */
  private async assertFolder(parentId: string): Promise<void> {
    const parent = await this.deps.repository.getById(parentId);
    if (!parent) throw new NotFoundError(`No vault page with id "${parentId}".`);
    if (parent.isFolder) return;
    const children = await this.deps.repository.list({ parentId });
    if (children.length === 0) {
      throw new VaultPageValidationError("A note can only go in a folder.");
    }
  }

  /**
   * A page cannot be moved under itself or under one of its descendants — the
   * parent chain would loop and the tree would drop the whole branch.
   */
  private assertNotUnderSelf(parentId: string, id: string): Promise<void> {
    return assertNotUnder(
      id,
      parentId,
      async (cursor) => {
        const parent = await this.deps.repository.getById(cursor);
        if (!parent) throw new NotFoundError(`No vault page with id "${parentId}".`);
        return parent.parentId;
      },
      () => new VaultPageValidationError("A note cannot be moved inside itself."),
    );
  }

  async remove(id: string): Promise<void> {
    await this.deps.repository.delete(id);
  }
}
