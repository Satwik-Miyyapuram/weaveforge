import type { IShareLinkRepository, ResolvedShareLink } from "../domain/share-link.js";
import { decodeShareLinkToken, type IShareLinkTokenHasher } from "../domain/share-link-token.js";

const INVALID_LINK = "Link is invalid or expired.";

export class RedeemShareLinkUseCase {
  constructor(
    private readonly deps: {
      shareLinks: IShareLinkRepository;
      tokenHasher: IShareLinkTokenHasher;
    },
  ) {}

  async execute(urlToken: string): Promise<ResolvedShareLink> {
    const token = decodeToken(urlToken);
    const resolved = token && (await this.deps.shareLinks.redeem(await this.deps.tokenHasher.hash(token)));
    if (!resolved) throw new Error(INVALID_LINK);
    return resolved;
  }
}

/** A mangled token is the same to the visitor as an unknown one, not a decoding error. */
function decodeToken(urlToken: string): Uint8Array | null {
  try {
    return decodeShareLinkToken(urlToken);
  } catch {
    return null;
  }
}
