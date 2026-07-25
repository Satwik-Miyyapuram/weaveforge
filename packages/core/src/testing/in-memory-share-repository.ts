import type {
  IShareRepository,
} from "../features/sharing/domain/share-repository.js";
import type {
  NewShareInput,
  Share,
  ShareableType,
} from "../features/sharing/domain/share.js";

/**
 * In-memory {@link IShareRepository}. A fixed `currentId` stands in for the
 * signed-in user (the DB uses auth.uid()). Grant is idempotent on
 * (owner, recipient, type, resource) — re-granting updates access, mirroring the
 * unique index + delete/insert the Supabase adapter uses (LSP).
 */
export class InMemoryShareRepository implements IShareRepository {
  private readonly store = new Map<string, Share>();
  private seq = 0;
  constructor(private currentId: string = "me") {}

  setCurrent(id: string): void {
    this.currentId = id;
  }

  private key(ownerId: string, i: NewShareInput): string {
    return `${ownerId}|${i.recipientId}|${i.resourceType}|${i.resourceId ?? "*"}`;
  }

  async grant(input: NewShareInput): Promise<Share> {
    const owner = this.currentId;
    const key = this.key(owner, input);
    const existing = [...this.store.values()].find(
      (s) => this.key(s.ownerId, s) === key,
    );
    const share: Share = {
      id: existing?.id ?? `share-${++this.seq}`,
      ownerId: owner,
      recipientId: input.recipientId,
      resourceType: input.resourceType,
      resourceId: input.resourceId ?? null,
      access: input.access ?? "comment",
      createdAt: existing?.createdAt ?? new Date(this.seq).toISOString(),
    };
    this.store.set(share.id, share);
    return { ...share };
  }

  async revoke(id: string): Promise<void> {
    this.store.delete(id);
  }

  async listForResource(
    resourceType: ShareableType,
    resourceId: string | null,
  ): Promise<Share[]> {
    return [...this.store.values()]
      .filter(
        (s) =>
          s.ownerId === this.currentId &&
          s.resourceType === resourceType &&
          (s.resourceId ?? null) === (resourceId ?? null),
      )
      .map((s) => ({ ...s }));
  }

  async listSharedWithMe(resourceType?: ShareableType): Promise<Share[]> {
    return [...this.store.values()]
      .filter(
        (s) =>
          s.recipientId === this.currentId &&
          (resourceType ? s.resourceType === resourceType : true),
      )
      .map((s) => ({ ...s }));
  }
}
