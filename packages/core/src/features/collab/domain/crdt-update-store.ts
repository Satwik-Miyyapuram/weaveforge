/**
 * Encrypted CRDT update persistence (migration 0042).
 */

export interface CrdtUpdateRecord {
  id: number;
  resourceType: string;
  resourceId: string;
  projectId: string | null;
  epoch: number;
  payload: Uint8Array;
  authorId: string;
  createdAt: string;
}

/**
 * What came of trying to compact.
 *
 * `no-op` carries its reason because the three cases are operationally
 * different and identical to a log: a stale caller (a client whose snapshot is
 * behind the stored watermark), a resource with no watermark to move, and a
 * resource that is gone. The caller can say which in a log line without the
 * adapter inventing a status for each.
 */
export type CompactOutcome =
  | { status: "compacted"; deleted: number }
  /** The caller may not edit this resource, so nothing moved and nothing was swept. */
  | { status: "not-permitted" }
  | { status: "no-op"; reason: "stale" | "nothing-to-do" | "missing" };

export interface ICrdtUpdateStore {
  append(input: {
    resourceType: string;
    resourceId: string;
    projectId: string | null;
    epoch: number;
    payload: Uint8Array;
    authorId: string;
  }): Promise<CrdtUpdateRecord>;
  listAfter(resourceType: string, resourceId: string, afterId?: number): Promise<CrdtUpdateRecord[]>;
  deleteUpTo(resourceType: string, resourceId: string, uptoId: number): Promise<void>;
  deleteAll(resourceType: string, resourceId: string): Promise<void>;
  countAfter(resourceType: string, resourceId: string, afterId?: number): Promise<number>;
  /**
   * Move the watermark and sweep what it now covers, **in one transaction**, and
   * only if the caller may edit the resource.
   *
   * This replaces the two-call sequence compaction used to make — write the
   * watermark, then delete — which could not be atomic and had no rights check of
   * its own. Two things followed from that, both silent: a crash between the
   * calls left the watermark claiming coverage of rows that were still there (or
   * the reverse, depending on the order), and a collaborator whose delete was
   * filtered by RLS *advanced the shared watermark anyway*, because PostgREST
   * answers a filtered delete with `204 No Content`. The owner's next compaction
   * then read a watermark that already covered those rows and swept nothing, so
   * the log grew for the life of the document with nothing to show for it.
   *
   * `deleteUpTo` stays on the port for the paths that legitimately sweep without
   * touching a watermark (a deleted resource, a re-key). Compaction is not one of
   * them.
   */
  compact(input: {
    resourceType: string;
    resourceId: string;
    uptoId: number;
    /**
     * What the caller last read, when it has one. Lets a stale caller be a local
     * no-op rather than a round trip; the database decides anyway.
     */
    currentUpto?: number;
  }): Promise<CompactOutcome>;
}
