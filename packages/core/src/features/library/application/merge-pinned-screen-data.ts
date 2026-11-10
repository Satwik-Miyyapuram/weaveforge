import type { Share, ShareableType } from "../../../shared/core-contract.js";
import type { LibraryPin } from "../domain/library-pin.js";
import { rust } from "../../../shared/rust.js";

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
 *
 * The pin and share indexing is pure and runs in Rust (`pinnedScreenIndex`); this
 * shell only loads the extra rows that index names.
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
  const index = rust().pinnedScreenIndex({
    resourceType: input.resourceType,
    ownedIds: input.owned.map((x) => x.id),
    pins: input.pins,
    shares: input.shares,
  });
  // A pin whose resource can no longer be read (unshared, deleted) drops that
  // pin; it must not take the owner's own list down with it.
  const loaded = await Promise.all(
    index.extraIds.map((id) => input.loadById(id).catch(() => null)),
  );
  const extras = loaded.filter((item): item is NonNullable<typeof item> => item != null);

  return {
    items: [...input.owned, ...extras],
    pinnedSharedBy: new Map(index.pinnedSharedBy.map((p) => [p.resourceId, p.ownerId])),
    canComment: new Map(index.canComment.map((g) => [g.resourceId, g.granted])),
    canEdit: new Map(index.canEdit.map((g) => [g.resourceId, g.granted])),
  };
}
