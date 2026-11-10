import type { IShareLinkRepository, ResolvedShareLink } from "../../../shared/core-contract.js";
import type { IShareLinkTokenHasher } from "../../../shared/core-contract.js";
import { rust } from "../../../shared/rust.js";

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
    return rust().decodeShareLinkToken(urlToken);
  } catch {
    return null;
  }
}
