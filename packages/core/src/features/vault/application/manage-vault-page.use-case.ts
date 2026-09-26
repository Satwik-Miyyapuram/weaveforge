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

export interface EditVaultPageInput {
  title?: string;
  body?: string;
  /** A new parent; `null` moves the page to the top level. Absent leaves it. */
  parentId?: string | null;
  /** Pin or unpin the note. Absent leaves it. */
  pinned?: boolean;
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
    // Only the identity and the title are read here, so the card projection is
    // the right read — and it is required on the port, so this is one call
    // rather than a fallback the caller has to remember to write.
    const existing: readonly { id: string; title: string }[] =
      await this.deps.repository.listSummaries();
    if (existing.some((p) => p.id !== exceptId && normalizeTitleKey(p.title) === key)) {
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
      await this.assertNotUnder(input.parentId, id);
    }
    const updated: VaultPage = {
      ...existing,
      title,
      body: input.body !== undefined ? input.body : existing.body,
      ...(input.parentId === undefined
        ? {}
        : { parentId: input.parentId === null ? undefined : input.parentId }),
      ...(input.pinned === undefined ? {} : { pinned: input.pinned }),
      updatedAt: this.deps.clock.nowIso(),
    };
    await this.deps.repository.save(updated);
    return updated;
  }

  /**
   * A page cannot be moved under itself or under one of its descendants — the
   * parent chain would loop and the tree would drop the whole branch.
   */
  private async assertNotUnder(parentId: string, id: string): Promise<void> {
    let cursor: string | undefined = parentId;
    const seen = new Set<string>();
    while (cursor) {
      if (cursor === id) {
        throw new VaultPageValidationError("A note cannot be moved inside itself.");
      }
      if (seen.has(cursor)) return; // an existing loop is not this move's doing
      seen.add(cursor);
      const parent = await this.deps.repository.getById(cursor);
      if (!parent) throw new NotFoundError(`No vault page with id "${parentId}".`);
      cursor = parent.parentId;
    }
  }

  async remove(id: string): Promise<void> {
    await this.deps.repository.delete(id);
  }
}
