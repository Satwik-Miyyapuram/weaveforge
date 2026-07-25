import type { Share, ShareableType } from "../../sharing/domain/share.js";
import { shareAllowsComment, shareAllowsEdit } from "../../sharing/domain/share.js";
import type { LibraryPin } from "../domain/library-pin.js";

export interface PinnedScreenMerge<T extends { id: string }> {
  items: T[];
  pinnedSharedBy: Map<string, string>;
  canComment: Map<string, boolean>;
  canEdit: Map<string, boolean>;
}

/** Merge pinned shared resources into an owned list (Papers, Experiments, …). */
export async function mergePinnedScreenData<T extends { id: string }>(input: {
  resourceType: ShareableType;
  owned: T[];
  pins: LibraryPin[];
  shares: Share[];
  loadById: (id: string) => Promise<T | null>;
}): Promise<PinnedScreenMerge<T>> {
  const typePins = input.pins.filter((p) => p.resourceType === input.resourceType);
  const pinnedSharedBy = new Map(typePins.map((p) => [p.resourceId, p.ownerId]));
  const ownedIds = new Set(input.owned.map((x) => x.id));
  const extraIds = typePins.map((p) => p.resourceId).filter((id) => !ownedIds.has(id));
  const loaded = await Promise.all(extraIds.map((id) => input.loadById(id)));
  const extras = loaded.filter((item): item is NonNullable<typeof item> => item != null) as T[];

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
