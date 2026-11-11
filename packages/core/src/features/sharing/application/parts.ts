import type {
  Comment,
  IShareLinkRepository,
  IShareLinkTokenHasher,
  NewCommentInput,
  NewShareInput,
  ResolvedShareLink,
  Share,
  ShareableType,
  ShareLink,
} from "../../../shared/core-contract.js";
import { NotFoundError, PermissionError } from "../../../shared/errors.js";
import { rust } from "../../../shared/rust.js";
import type { ICommentRepository, IShareRepository } from "../domain/parts.js";

// --- manage-comments.use-case ---
/** Use-case for comments. Validates then delegates (RLS gates who may add). */
export interface ManageCommentsDeps {
  repository: ICommentRepository;
}

export class ManageCommentsUseCase {
  constructor(private readonly deps: ManageCommentsDeps) {}

  list(resourceType: string, resourceId: string): Promise<Comment[]> {
    return this.deps.repository.list(resourceType, resourceId);
  }

  async add(input: NewCommentInput): Promise<Comment> {
    return this.deps.repository.add(rust().normalizeCommentInput(input as never));
  }

  async remove(id: string): Promise<void> {
    await this.deps.repository.remove(id);
  }

  setResolved(id: string, resolved: boolean): Promise<string | null> {
    return this.deps.repository.setResolved(id, resolved);
  }
}

// --- manage-share-links.use-case ---
export class ManageShareLinksUseCase {
  constructor(private readonly deps: { shareLinks: IShareLinkRepository }) {}

  listForResource(resourceType: ShareableType, resourceId: string): Promise<ShareLink[]> {
    return this.deps.shareLinks.listForResource(resourceType, resourceId);
  }
}

// --- manage-sharing.use-case ---
/**
 * Use-case for sharing. Orchestration only: validate the grant and delegate to
 * the repository (which enforces idempotency + RLS). Kept thin because the DB
 * owns identity, ownership (auth.uid()), and the uniqueness rule.
 */
export interface ManageSharingDeps {
  repository: IShareRepository;
}

export class ManageSharingUseCase {
  constructor(private readonly deps: ManageSharingDeps) {}

  /** Share one item, or all of a type (`resourceId: null`), with a member. */
  async grant(input: NewShareInput): Promise<Share> {
    return this.deps.repository.grant(rust().normalizeShareInput(input));
  }

  async revoke(id: string): Promise<void> {
    await this.deps.repository.revoke(id);
  }

  listForResource(resourceType: ShareableType, resourceId: string | null): Promise<Share[]> {
    return this.deps.repository.listForResource(resourceType, resourceId);
  }

  listSharedWithMe(resourceType?: ShareableType): Promise<Share[]> {
    return this.deps.repository.listSharedWithMe(resourceType);
  }
}

// --- redeem-share-link.use-case ---
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

// --- revoke-share-link.use-case ---
/**
 * Revoke an external share link. Content is plaintext (RLS); no DEK rotation.
 */
export class RevokeShareLinkUseCase {
  constructor(
    private readonly deps: {
      shareLinks: IShareLinkRepository;
    },
  ) {}

  async execute(input: { ownerId: string; linkId: string }): Promise<void> {
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
