import type { ShareableType } from "../../../shared/core-contract.js";
import type { IShareLinkRepository, ShareLink } from "../../../shared/core-contract.js";

export class ManageShareLinksUseCase {
  constructor(private readonly deps: { shareLinks: IShareLinkRepository }) {}

  listForResource(resourceType: ShareableType, resourceId: string): Promise<ShareLink[]> {
    return this.deps.shareLinks.listForResource(resourceType, resourceId);
  }
}
