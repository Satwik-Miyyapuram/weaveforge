import {
  CreateShareLinkUseCase,
  ManageShareLinksUseCase,
  RedeemShareLinkUseCase,
  RevokeShareLinkUseCase,
} from "@weaveforge/core";

import { rustShareLinkRepository } from "@/backend/providers/postgrest/rust-repository";
import { WebCryptoShareLinkTokenHasher } from "@/container/parts";
import { randomBytes, systemClock, uuidIds } from "@/lib/parts";

/** The share link use cases; all null on a backend without a database. */
export function wireShareLinks(db: Parameters<typeof rustShareLinkRepository>[0] | null) {
  const shareLinkTokenHasher = new WebCryptoShareLinkTokenHasher();
  const shareLinkRepository =
    db ? rustShareLinkRepository(db) : null;
  const createShareLink =
    shareLinkRepository &&
    new CreateShareLinkUseCase({
      shareLinks: shareLinkRepository,
      tokenHasher: shareLinkTokenHasher,
      ids: uuidIds,
      clock: systemClock,
      randomBytes,
    });
  const redeemShareLink =
    shareLinkRepository &&
    new RedeemShareLinkUseCase({
      shareLinks: shareLinkRepository,
      tokenHasher: shareLinkTokenHasher,
    });
  const manageShareLinks =
    shareLinkRepository && new ManageShareLinksUseCase({ shareLinks: shareLinkRepository });
  const revokeShareLink =
    shareLinkRepository &&
    new RevokeShareLinkUseCase({ shareLinks: shareLinkRepository });
  return { createShareLink, redeemShareLink, manageShareLinks, revokeShareLink };
}
