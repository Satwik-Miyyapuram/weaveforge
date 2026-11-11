import type { IdGenerator } from "../../../shared/parts.js";
import type {
  IShareLinkRepository,
  IShareLinkTokenHasher,
  ShareableType,
} from "../../../shared/core-contract.js";
import { rust } from "../../../shared/rust.js";

/** Random bytes in a share-link token; the Rust core encodes it for the URL. */
const SHARE_LINK_TOKEN_BYTES = 32;

export class CreateShareLinkUseCase {
  constructor(
    private readonly deps: {
      shareLinks: IShareLinkRepository;
      tokenHasher: IShareLinkTokenHasher;
      ids: IdGenerator;
      clock: { nowIso: () => string };
      randomBytes: (n: number) => Promise<Uint8Array>;
    },
  ) {}

  async execute(input: {
    ownerId: string;
    resourceType: ShareableType;
    resourceId: string;
    expiresAt?: string | null;
  }): Promise<{ linkId: string; urlToken: string }> {
    if (!input.resourceId) {
      throw new Error("Share links require a specific resource.");
    }

    const token = await this.deps.randomBytes(SHARE_LINK_TOKEN_BYTES);
    const tokenHash = await this.deps.tokenHasher.hash(token);
    const id = this.deps.ids.newId();
    await this.deps.shareLinks.save({
      id,
      ownerId: input.ownerId,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      access: "view",
      tokenHash,
      expiresAt:
        input.expiresAt !== undefined
          ? input.expiresAt
          : rust().defaultShareLinkExpiresAt(Date.parse(this.deps.clock.nowIso())),
      dekWrap: null,
      dekEpoch: null,
    });

    return { linkId: id, urlToken: rust().encodeShareLinkToken(token) };
  }
}
