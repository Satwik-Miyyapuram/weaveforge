import type {
  ILabSnapshotRepository,
  LabSnapshot,
  PublishLabSnapshotInput,
} from "../features/org/index.js";

export class InMemoryLabSnapshotRepository implements ILabSnapshotRepository {
  private readonly items = new Map<string, LabSnapshot & { ownerId: string }>();
  private ownerId = "self";

  /** Test helper: change the synthetic current user / publish owner. */
  setOwnerId(ownerId: string) {
    this.ownerId = ownerId;
  }

  async publish(input: PublishLabSnapshotInput): Promise<LabSnapshot> {
    const now = new Date().toISOString();
    const snapshot: LabSnapshot & { ownerId: string } = {
      id: `lab-snapshot-${this.items.size + 1}`,
      projectId: "project-1",
      title: input.title.trim(),
      note: input.note?.trim() || undefined,
      content: structuredClone(input.content),
      publishedAt: now,
      createdAt: now,
      ownerId: this.ownerId,
    };
    this.items.set(snapshot.id, snapshot);
    return structuredClone(toPublic(snapshot));
  }

  async remove(id: string): Promise<void> {
    const existing = this.items.get(id);
    if (existing && existing.ownerId === this.ownerId) this.items.delete(id);
  }

  async listMine(): Promise<LabSnapshot[]> {
    return [...this.items.values()]
      .filter((row) => row.ownerId === this.ownerId)
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
      .map((row) => structuredClone(toPublic(row)));
  }

  async listForMember(memberId: string): Promise<LabSnapshot[]> {
    return [...this.items.values()]
      .filter((row) => row.ownerId === memberId)
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
      .map((row) => structuredClone(toPublic(row)));
  }

  async getById(id: string): Promise<LabSnapshot | null> {
    const row = this.items.get(id);
    return row ? structuredClone(toPublic(row)) : null;
  }
}

function toPublic(row: LabSnapshot & { ownerId: string }): LabSnapshot {
  const { ownerId: _ownerId, ...publicRow } = row;
  return publicRow;
}
