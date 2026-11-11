import type { Share, ShareableType } from "../../../shared/core-contract.js";
import { rust } from "../../../shared/rust.js";
import type { AddPaperUseCase } from "../../papers/application/parts-1.js";
import type { IPaperRepository, Paper } from "../../papers/domain/parts.js";
import type { IShareRepository } from "../../sharing/domain/parts.js";
import {
  type ILibraryPinRepository,
  type LibraryPin,
  LibraryPinError,
  type NewLibraryPinInput,
} from "../domain/parts.js";

// --- duplicate-shared-paper.use-case ---
export interface DuplicateSharedPaperDeps {
  shares: IShareRepository;
  papers: IPaperRepository;
  addPaper: AddPaperUseCase;
}

/** Fork a shared paper into the recipient's library (new owned copy). */
export class DuplicateSharedPaperUseCase {
  constructor(private readonly deps: DuplicateSharedPaperDeps) {}

  async execute(input: { resourceId: string; ownerId: string }): Promise<Paper> {
    const shares = await this.deps.shares.listSharedWithMe("paper");
    const allowed = shares.some((s) =>
      rust().shareCoversResource(s, "paper", input.resourceId, input.ownerId),
    );
    if (!allowed) {
      throw new LibraryPinError("This paper is not shared with you.");
    }

    const source = await this.deps.papers.getById(input.resourceId);
    if (!source) {
      throw new LibraryPinError("Paper not found or not accessible.");
    }

    return this.deps.addPaper.addManual({
      title: `${source.title} (copy)`,
      authors: [...source.authors],
      year: source.year,
      venue: source.venue,
      url: source.url,
      abstract: source.abstract,
      summary: source.summary,
      status: source.status,
      rating: source.rating,
      bibtex: source.bibtex,
      tags: [...source.tags],
      metadata: {
        ...source.metadata,
        copiedFromPaperId: source.id,
        copiedFromOwnerId: input.ownerId,
      },
    });
  }
}

// --- merge-pinned-screen-data ---
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

// --- parts ---
// --- load-pinned-screen-data ---
/**
 * The two reads every pinned screen makes before merging, and the merge itself.
 *
 * Six screens each wrote the same preamble — fetch this project's pins, fetch
 * the shares addressed to me of `resourceType`, fall back to an empty list when
 * either repository is absent — and then passed the same resource type to
 * `mergePinnedScreenData` one line later. The resource type appearing twice is
 * the part worth removing: a screen that spells it differently in the two places
 * merges against another type's shares, and both calls succeed, so the symptom
 * is a screen whose comment and edit rights are quietly wrong rather than an
 * error.
 *
 * The optional repositories stay optional: papers are pinned and shared, and a
 * deployment with no sharing at all is a supported configuration, not a broken
 * one.
 */
export interface PinnedScreenSources {
  pins?: Pick<ILibraryPinRepository, "listForProject">;
  shares?: Pick<IShareRepository, "listSharedWithMe">;
}

export async function loadPinnedScreenData<
  TSummary extends { id: string },
  TFull extends TSummary,
>(
  sources: PinnedScreenSources,
  input: {
    resourceType: ShareableType;
    owned: readonly TSummary[];
    loadById: (id: string) => Promise<TFull | null>;
  },
): Promise<PinnedScreenMerge<TSummary>> {
  const [pins, shares] = await Promise.all([
    sources.pins?.listForProject() ?? Promise.resolve([]),
    sources.shares?.listSharedWithMe(input.resourceType) ?? Promise.resolve([]),
  ]);

  return mergePinnedScreenData({ ...input, pins, shares });
}

// --- pin-shared-resource.use-case ---
export interface PinSharedResourceDeps {
  pins: ILibraryPinRepository;
  shares: IShareRepository;
}

export class PinSharedResourceUseCase {
  constructor(private readonly deps: PinSharedResourceDeps) {}

  async execute(input: NewLibraryPinInput): Promise<LibraryPin> {
    const shares = await this.deps.shares.listSharedWithMe(input.resourceType);
    const allowed = shares.some((s) =>
      rust().shareCoversResource(s, input.resourceType, input.resourceId, input.ownerId),
    );
    if (!allowed) {
      throw new LibraryPinError("This item is not shared with you.");
    }
    return this.deps.pins.pin(input);
  }
}
