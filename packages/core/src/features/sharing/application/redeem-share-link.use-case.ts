import type { IShareLinkRepository, ResolvedShareLink } from "../domain/share-link.js";
import { decodeShareLinkToken, type IShareLinkTokenHasher } from "../domain/share-link-token.js";

export class RedeemShareLinkUseCase {
  constructor(
    private readonly deps: {
      shareLinks: IShareLinkRepository;
      tokenHasher: IShareLinkTokenHasher;
    },
  ) {}

  async execute(urlToken: string): Promise<ResolvedShareLink> {
    const token = decodeShareLinkToken(urlToken);
    const tokenHash = await this.deps.tokenHasher.hash(token);
    const resolved = await this.deps.shareLinks.redeem(tokenHash);
    if (!resolved) throw new Error("Link is invalid or expired.");
    return resolved;
  }
}
