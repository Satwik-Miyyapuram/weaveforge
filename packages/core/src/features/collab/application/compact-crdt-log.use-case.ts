/**
 * Compact CRDT update log after snapshot persist (plan §7.3).
 */

import type { ICrdtUpdateStore } from "../domain/crdt-update-store.js";

export class CompactCrdtLogUseCase {
  constructor(private readonly deps: { crdtStore: ICrdtUpdateStore }) {}

  async execute(input: {
    resourceType: string;
    resourceId: string;
    snapshotUptoId: number;
    setSnapshotUpto: (uptoId: number) => Promise<void>;
  }): Promise<void> {
    if (input.snapshotUptoId <= 0) return;
    await this.deps.crdtStore.deleteUpTo(
      input.resourceType,
      input.resourceId,
      input.snapshotUptoId,
    );
    await input.setSnapshotUpto(input.snapshotUptoId);
  }
}
