import type { Share, ShareableType } from "../../sharing/domain/share.js";
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

interface Grants {
  comment: boolean;
  edit: boolean;
}

/** What each share row says about one resource, or about everything one owner has. */
interface GrantIndex {
  /** Keyed by resource id, for shares that name one. */
  exact: Map<string, Grants>;
  /** Keyed by owner, for "everything of this type I own". */
  blanket: Map<string, Grants>;
}

/**
 * Read the share rows once, into the two shapes the two questions need.
 *
 * Both questions used to be answered by scanning the whole share list: once per
 * share row to build the maps below, and then again *per pinned resource*, with
 * `.some(...)` over every share. A lab with 200 pins and 400 shares ran 160 000
 * predicate evaluations on every screen load, in a helper six screens call.
 *
 * The two questions are genuinely different, which is why they are two indexes
 * rather than one:
 *
 *   * most shares name a resource (`resourceId`), and grant comment or edit on
 *     that one row;
 *   * a share with no resource id is a blanket grant — everything of this type
 *     that the sharer owns — and it applies to a pin only when the *pin's* owner
 *     is the sharer. `shareCoversResource` is what says so, and dropping this
 *     index would silently remove comment and edit rights from every pin whose
 *     owner shared their whole library.
 */
function grantIndex(shares: readonly Share[], resourceType: ShareableType): GrantIndex {
  const exact = new Map<string, Grants>();
  const blanket = new Map<string, Grants>();

  const merge = (into: Map<string, Grants>, key: string, share: Share) => {
    const granted = into.get(key) ?? { comment: false, edit: false };
    granted.comment ||= share.access === "comment" || share.access === "edit";
    granted.edit ||= share.access === "edit";
    into.set(key, granted);
  };

  for (const share of shares) {
    if (share.resourceType !== resourceType) continue;
    if (share.resourceId) merge(exact, share.resourceId, share);
    else merge(blanket, share.ownerId, share);
  }
  return { exact, blanket };
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

  // Every share of this type that names a resource, not only the pinned ones:
  // a note opened from a link may be shared without being pinned, and the
  // editor still needs to know whether this reader may comment on it.
  const grants = grantIndex(input.shares, input.resourceType);
  const canComment = new Map<string, boolean>();
  const canEdit = new Map<string, boolean>();
  for (const [resourceId, granted] of grants.exact) {
    canComment.set(resourceId, granted.comment);
    canEdit.set(resourceId, granted.edit);
  }

  // Then the blanket grants, which apply through the pin's owner.
  for (const [resourceId, ownerId] of pinnedSharedBy) {
    const blanket = grants.blanket.get(ownerId);
    canComment.set(resourceId, canComment.get(resourceId) === true || blanket?.comment === true);
    canEdit.set(resourceId, canEdit.get(resourceId) === true || blanket?.edit === true);
  }

  return {
    items: [...input.owned, ...extras],
    pinnedSharedBy,
    canComment,
    canEdit,
  };
}
