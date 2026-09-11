import type { Share, ShareableType } from "../../sharing/domain/share.js";
import { shareAllowsComment, shareAllowsEdit } from "../../sharing/domain/share.js";
import type { LibraryPin } from "../domain/library-pin.js";

export interface PinnedScreenMerge<TSummary extends { id: string }> {
  /**
   * The screen's own list plus the pinned extras. Typed as the **projection**
   * the caller passed in, because that is what this function can promise: an
   * extra loaded through `loadById` may be a fuller row, never a sparser one.
   */
  items: TSummary[];
  pinnedSharedBy: Map<string, string>;
  canComment: Map<string, boolean>;
  canEdit: Map<string, boolean>;
}

/**
 * Merge pinned shared resources into an owned list (Papers, Experiments, …).
 *
 * Two type parameters on purpose (review-2 F6). `TSummary` is the projection the
 * screen already holds — a `VaultPageSummary`, a `PaperSummary` — and `TFull` is
 * whatever `loadById` returns, which must be at least as complete. The result is
 * `TSummary[]`, so a caller cannot read the merged list as if every element were
 * a full entity and write one back: that is exactly how a card edit came to
 * persist `body: ""` over a real note. `TFull extends TSummary` is what makes the
 * mixed list sound, and it is checked at every call site.
 */
export async function mergePinnedScreenData<
  TSummary extends { id: string },
  TFull extends TSummary,
>(input: {
  resourceType: ShareableType;
  owned: readonly TSummary[];
  pins: LibraryPin[];
  shares: Share[];
  loadById: (id: string) => Promise<TFull | null>;
}): Promise<PinnedScreenMerge<TSummary>> {
  const typePins = input.pins.filter((p) => p.resourceType === input.resourceType);
  const pinnedSharedBy = new Map(typePins.map((p) => [p.resourceId, p.ownerId]));
  const ownedIds = new Set(input.owned.map((x) => x.id));
  const extraIds = typePins.map((p) => p.resourceId).filter((id) => !ownedIds.has(id));
  const loaded = await Promise.all(extraIds.map((id) => input.loadById(id)));
  const extras = loaded.filter((item): item is NonNullable<typeof item> => item != null);

  const canComment = new Map<string, boolean>();
  const canEdit = new Map<string, boolean>();
  for (const s of input.shares) {
    if (!s.resourceId) continue;
    const comment = shareAllowsComment(
      s,
      input.resourceType,
      s.resourceId,
      s.ownerId,
    );
    canComment.set(s.resourceId, comment || canComment.get(s.resourceId) === true);
    const edit = shareAllowsEdit(s, input.resourceType, s.resourceId, s.ownerId);
    canEdit.set(s.resourceId, edit || canEdit.get(s.resourceId) === true);
  }
  for (const [resourceId, ownerId] of pinnedSharedBy) {
    const comment = input.shares.some((s) =>
      shareAllowsComment(s, input.resourceType, resourceId, ownerId),
    );
    canComment.set(resourceId, comment || canComment.get(resourceId) === true);
    const edit = input.shares.some((s) =>
      shareAllowsEdit(s, input.resourceType, resourceId, ownerId),
    );
    canEdit.set(resourceId, edit || canEdit.get(resourceId) === true);
  }

  return {
    items: [...input.owned, ...extras],
    pinnedSharedBy,
    canComment,
    canEdit,
  };
}
