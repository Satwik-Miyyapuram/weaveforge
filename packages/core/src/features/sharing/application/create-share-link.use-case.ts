import type { IdGenerator } from "../../../shared/clock.js";
import type { ShareableType } from "../domain/share.js";
import { defaultShareLinkExpiresAt, type IShareLinkRepository } from "../domain/share-link.js";
import {
  encodeShareLinkToken,
  generateShareLinkToken,
  type IShareLinkTokenHasher,
} from "../domain/share-link-token.js";

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

    const token = await generateShareLinkToken((n) => this.deps.randomBytes(n));
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
          : defaultShareLinkExpiresAt(this.deps.clock.nowIso),
      dekWrap: null,
      dekEpoch: null,
    });

    return { linkId: id, urlToken: encodeShareLinkToken(token) };
  }
}
