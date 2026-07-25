import type { ShareableType } from "../domain/share.js";
import type { IShareLinkRepository, ShareLink } from "../domain/share-link.js";

export class ManageShareLinksUseCase {
  constructor(private readonly deps: { shareLinks: IShareLinkRepository }) {}

  listForResource(resourceType: ShareableType, resourceId: string): Promise<ShareLink[]> {
    return this.deps.shareLinks.listForResource(resourceType, resourceId);
  }

  revoke(id: string): Promise<void> {
    return this.deps.shareLinks.delete(id);
  }
}
