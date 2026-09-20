/**
 * Compact CRDT update log after snapshot persist (plan §7.3).
 *
 * The order of the two steps is the whole safety argument, and it is easy to
 * get backwards because the destructive one is the one that feels like cleanup.
 *
 * A compacted prefix is only redundant once the fact that it is covered has
 * been written down. Destroy the rows first and every crash, refused request or
 * dropped connection in between leaves the newest edits gone while the recorded
 * watermark still says they are reachable — and the only other durable copy is
 * the entity body, which the editor saves fire-and-forget. So: record the
 * watermark, then sweep. `deleteUpTo` is idempotent, so a crash between the two
 * steps costs nothing worse than rows the next compaction sweeps again.
 *
 * Two writers co-editing means two clients can compact, so the watermark is
 * also required to move forwards only. The caller passes what it last read; a
 * client holding an older snapshot is a no-op. That read-then-write check is
 * not by itself race-proof — the authoritative guard is the conditional update
 * in `CrdtSnapshotStore.setSnapshotUpto`, which is what makes a rewind
 * impossible even when two callers interleave here.
 */
import type { ICrdtUpdateStore } from "../domain/crdt-update-store.js";

export class CompactCrdtLogUseCase {
  constructor(private readonly deps: { crdtStore: ICrdtUpdateStore }) {}

  async execute(input: {
    resourceType: string;
    resourceId: string;
    snapshotUptoId: number;
    /**
     * The watermark the caller last read, when it has one. Omitted means "I do
     * not know", which is not the same as zero: the write still happens and the
     * database decides whether it is an advance.
     */
    currentSnapshotUpto?: number;
    setSnapshotUpto: (uptoId: number) => Promise<void>;
  }): Promise<void> {
    if (input.snapshotUptoId <= 0) return;
    if (
      input.currentSnapshotUpto != null &&
      input.snapshotUptoId <= input.currentSnapshotUpto
    ) {
      return;
    }

    // Durable bookkeeping first: nothing may be destroyed on the strength of a
    // watermark that was never stored.
    await input.setSnapshotUpto(input.snapshotUptoId);
    // Then the cleanup, which is safe to repeat and safe to skip.
    await this.deps.crdtStore.deleteUpTo(
      input.resourceType,
      input.resourceId,
      input.snapshotUptoId,
    );
  }
}
