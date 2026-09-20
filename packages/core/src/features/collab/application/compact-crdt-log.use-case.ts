/**
 * Compact CRDT update log after snapshot persist (plan §7.3).
 *
 * A compacted prefix is only redundant once the fact that it is covered has been
 * written down, and only once the content it holds exists somewhere else durable.
 * Both halves are now the database's job: `compact` moves the watermark and
 * sweeps the covered rows in one transaction, and refuses outright unless the
 * caller may edit the resource.
 *
 * What this class still does is decide *whether* to ask:
 *
 *   * a caller with no snapshot is not compacting anything (`snapshotUptoId <= 0`);
 *   * a caller whose snapshot is behind the stored watermark is a no-op, because
 *     another writer has already covered that range — and the database would
 *     refuse the rewind anyway, which is why `currentSnapshotUpto` is a courtesy
 *     rather than the guard;
 *   * and, in the layer that owns the body, compaction waits until the body it
 *     is about to make the only copy of has actually been written. That is
 *     `EncryptedYjsProvider`'s barrier, not this class's — a use case cannot know
 *     whether a document's text has landed.
 *
 * Two writers co-editing means two clients can compact, so the answer matters:
 * the outcome says whether anything happened, whether the caller was refused, and
 * — for the refusals — why nothing did.
 */
import type { CompactOutcome, ICrdtUpdateStore } from "../domain/crdt-update-store.js";

export class CompactCrdtLogUseCase {
  constructor(private readonly deps: { crdtStore: ICrdtUpdateStore }) {}

  async execute(input: {
    resourceType: string;
    resourceId: string;
    /** The newest update the caller's snapshot covers. */
    snapshotUptoId: number;
    /**
     * The watermark the caller last read, when it has one. Omitted means "I do
     * not know", which is not the same as zero.
     */
    currentSnapshotUpto?: number;
  }): Promise<CompactOutcome> {
    if (input.snapshotUptoId <= 0) return { status: "no-op", reason: "nothing-to-do" };
    if (input.currentSnapshotUpto != null && input.snapshotUptoId <= input.currentSnapshotUpto) {
      return { status: "no-op", reason: "stale" };
    }

    return this.deps.crdtStore.compact({
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      uptoId: input.snapshotUptoId,
      currentUpto: input.currentSnapshotUpto,
    });
  }
}
