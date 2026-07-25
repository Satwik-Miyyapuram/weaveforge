/**
 * Use-case for sharing. Orchestration only: validate the grant and delegate to
 * the repository (which enforces idempotency + RLS). Kept thin because the DB
 * owns identity, ownership (auth.uid()), and the uniqueness rule.
 */
import {
  normalizeShareInput,
  type NewShareInput,
  type Share,
  type ShareableType,
} from "../domain/share.js";
import type { IShareRepository } from "../domain/share-repository.js";

export interface ManageSharingDeps {
  repository: IShareRepository;
}

export class ManageSharingUseCase {
  constructor(private readonly deps: ManageSharingDeps) {}

  /** Share one item, or all of a type (`resourceId: null`), with a member. */
  async grant(input: NewShareInput): Promise<Share> {
    return this.deps.repository.grant(normalizeShareInput(input));
  }

  async revoke(id: string): Promise<void> {
    await this.deps.repository.revoke(id);
  }

  listForResource(resourceType: ShareableType, resourceId: string | null): Promise<Share[]> {
    return this.deps.repository.listForResource(resourceType, resourceId);
  }

  listSharedWithMe(resourceType?: ShareableType): Promise<Share[]> {
    return this.deps.repository.listSharedWithMe(resourceType);
  }
}
