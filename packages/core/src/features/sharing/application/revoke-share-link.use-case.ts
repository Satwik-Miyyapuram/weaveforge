/**
 * Revoke an external share link. Content is plaintext (RLS); no DEK rotation.
 */

import type { IShareLinkRepository } from "../domain/share-link.js";

export class RevokeShareLinkUseCase {
  constructor(
    private readonly deps: {
      shareLinks: IShareLinkRepository;
    },
  ) {}

  async execute(input: {
    ownerId: string;
    linkId: string;
    /** Ignored — retained for call-site compatibility; DEK rotation was E2EE-only. */
    rotateDek?: boolean;
  }): Promise<void> {
    const link = await this.deps.shareLinks.getById(input.linkId);
    if (!link) throw new Error("Share link not found");
    if (link.ownerId !== input.ownerId) throw new Error("Not authorized to revoke this link");
    await this.deps.shareLinks.delete(input.linkId);
  }
}
