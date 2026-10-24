import type {
  IShareLinkRepository,
  ResolvedShareLink,
  ShareLink,
  ShareLinkSaveInput,
} from "../features/sharing/domain/share-link.js";
import type { ShareableType } from "../features/sharing/domain/share.js";

export class InMemoryShareLinkRepository implements IShareLinkRepository {
  private readonly rows = new Map<string, ShareLinkSaveInput & { createdAt: string }>();

  async getById(id: string): Promise<ShareLink | null> {
    const row = this.rows.get(id);
    return row ? this.toDomain(row) : null;
  }

  async listForResource(resourceType: ShareableType, resourceId: string): Promise<ShareLink[]> {
    return [...this.rows.values()]
      .filter((r) => r.resourceType === resourceType && r.resourceId === resourceId)
      .map((r) => this.toDomain(r));
  }

  async save(input: ShareLinkSaveInput): Promise<ShareLink> {
    const row = { ...input, createdAt: new Date().toISOString() };
    this.rows.set(input.id, row);
    return this.toDomain(row);
  }

  async delete(id: string): Promise<void> {
    this.rows.delete(id);
  }

  /** Like the redeem_share_link RPC: unknown or expired links resolve to null. */
  async redeem(tokenHash: Uint8Array): Promise<ResolvedShareLink | null> {
    const row = this.findByHash(tokenHash);
    if (!row) return null;
    if (row.expiresAt !== null && Date.parse(row.expiresAt) <= Date.now()) return null;
    return this.toResolved(row);
  }

  private findByHash(tokenHash: Uint8Array) {
    const key = this.hashKey(tokenHash);
    return [...this.rows.values()].find((r) => this.hashKey(r.tokenHash) === key);
  }

  private hashKey(bytes: Uint8Array) {
    return [...bytes].join(",");
  }

  private toDomain(row: ShareLinkSaveInput & { createdAt: string }): ShareLink {
    return {
      id: row.id,
      ownerId: row.ownerId,
      resourceType: row.resourceType,
      resourceId: row.resourceId,
      access: row.access,
      expiresAt: row.expiresAt,
      createdAt: row.createdAt,
    };
  }

  private toResolved(row: ShareLinkSaveInput): ResolvedShareLink {
    return {
      id: row.id,
      ownerId: row.ownerId,
      resourceType: row.resourceType,
      resourceId: row.resourceId,
      access: row.access,
      dekWrap: row.dekWrap ?? null,
      dekEpoch: row.dekEpoch ?? null,
    };
  }
}
