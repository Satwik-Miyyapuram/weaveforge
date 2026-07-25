import type { ILibraryPinRepository } from "../features/library/domain/library-pin-repository.js";
import type {
  LibraryPin,
  NewLibraryPinInput,
} from "../features/library/domain/library-pin.js";
import type { ShareableType } from "../features/sharing/domain/share.js";

/**
 * In-memory {@link ILibraryPinRepository}. Scoped to one user + project, mirroring
 * the Supabase adapter's project context.
 */
export class InMemoryLibraryPinRepository implements ILibraryPinRepository {
  private readonly store = new Map<string, LibraryPin>();
  private seq = 0;

  constructor(
    private userId: string = "me",
    private projectId: string = "proj-1",
  ) {}

  setScope(userId: string, projectId: string): void {
    this.userId = userId;
    this.projectId = projectId;
  }

  private key(resourceType: ShareableType, resourceId: string): string {
    return `${this.userId}|${this.projectId}|${resourceType}|${resourceId}`;
  }

  async pin(input: NewLibraryPinInput): Promise<LibraryPin> {
    const key = this.key(input.resourceType, input.resourceId);
    const existing = this.store.get(key);
    const pin: LibraryPin = {
      id: existing?.id ?? `pin-${++this.seq}`,
      userId: this.userId,
      projectId: this.projectId,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      ownerId: input.ownerId,
      createdAt: existing?.createdAt ?? new Date(this.seq).toISOString(),
    };
    this.store.set(key, pin);
    return { ...pin };
  }

  async unpin(resourceType: ShareableType, resourceId: string): Promise<void> {
    this.store.delete(this.key(resourceType, resourceId));
  }

  async listForProject(): Promise<LibraryPin[]> {
    return [...this.store.values()]
      .filter((p) => p.userId === this.userId && p.projectId === this.projectId)
      .map((p) => ({ ...p }));
  }

  async isPinned(resourceType: ShareableType, resourceId: string): Promise<boolean> {
    return this.store.has(this.key(resourceType, resourceId));
  }
}
