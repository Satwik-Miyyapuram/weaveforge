/**
 * Revoke an external share link. Content is plaintext (RLS); no DEK rotation.
 */

import type { IShareLinkRepository } from "../domain/share-link.js";
import { NotFoundError, PermissionError } from "../../../shared/errors.js";

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
    // Both conditions were bare `Error`s, which no route can map — they fell
    // through to 500 for what are a 404 and a 403.
    if (!link) throw new NotFoundError("Share link not found");
    if (link.ownerId !== input.ownerId) {
      throw new PermissionError("Not authorized to revoke this link");
    }
    await this.deps.shareLinks.delete(input.linkId);
  }
}
