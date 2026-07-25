import type { CrdtUpdateRecord, ICrdtUpdateStore } from "../features/collab/domain/crdt-update-store.js";

export class InMemoryCrdtUpdateStore implements ICrdtUpdateStore {
  private seq = 1;
  private readonly rows: CrdtUpdateRecord[] = [];

  async append(input: {
    resourceType: string;
    resourceId: string;
    projectId: string | null;
    epoch: number;
    payload: Uint8Array;
    authorId: string;
  }): Promise<CrdtUpdateRecord> {
    const record: CrdtUpdateRecord = {
      id: this.seq++,
      ...input,
      payload: input.payload.slice(),
      createdAt: new Date().toISOString(),
    };
    this.rows.push(record);
    return record;
  }

  async listAfter(
    resourceType: string,
    resourceId: string,
    afterId = 0,
  ): Promise<CrdtUpdateRecord[]> {
    return this.rows.filter(
      (r) =>
        r.resourceType === resourceType &&
        r.resourceId === resourceId &&
        r.id > afterId,
    );
  }

  async deleteUpTo(resourceType: string, resourceId: string, uptoId: number): Promise<void> {
    for (let i = this.rows.length - 1; i >= 0; i--) {
      const r = this.rows[i]!;
      if (r.resourceType === resourceType && r.resourceId === resourceId && r.id <= uptoId) {
        this.rows.splice(i, 1);
      }
    }
  }

  async deleteAll(resourceType: string, resourceId: string): Promise<void> {
    for (let i = this.rows.length - 1; i >= 0; i--) {
      const r = this.rows[i]!;
      if (r.resourceType === resourceType && r.resourceId === resourceId) {
        this.rows.splice(i, 1);
      }
    }
  }

  async countAfter(resourceType: string, resourceId: string, afterId = 0): Promise<number> {
    return this.rows.filter(
      (r) =>
        r.resourceType === resourceType &&
        r.resourceId === resourceId &&
        r.id > afterId,
    ).length;
  }
}
