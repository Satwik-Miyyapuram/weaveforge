import { NotFoundError } from "../../../shared/errors.js";
import type { Clock, IdGenerator } from "../../../shared/parts.js";
import { rust } from "../../../shared/rust.js";
import type {
  IReadingListItemRepository,
  IReadingListRepository,
  IScreeningRepository,
  ItemVerdict,
  PrismaCounts,
  ScreeningDecision,
  ScreeningItem,
  ScreeningStage,
  ScreeningState,
} from "../domain/parts.js";
import {
  type NewReadingListInput,
  type ReadingList,
  type ReadingListItem,
  ReadingListValidationError,
} from "../domain/parts.js";

// --- manage-reading-list.use-case ---
/**
 * Use-cases for reading lists and membership.
 *
 * Orchestration only (DIP): coordinate the domain factory and the two
 * repositories. Business rules here: a list needs a name; adding a paper or
 * note to a list is idempotent (dedupe by list+ref, matching the DB unique
 * constraint).
 */
export interface ManageReadingListDeps {
  lists: IReadingListRepository;
  items: IReadingListItemRepository;
  clock: Clock;
  ids: IdGenerator;
}

export class ManageReadingListUseCase {
  constructor(private readonly deps: ManageReadingListDeps) {}

  async createList(input: NewReadingListInput): Promise<ReadingList> {
    const list = rust().createReadingList(input, {
      clock: this.deps.clock,
      ids: this.deps.ids,
    }) as ReadingList;
    await this.deps.lists.save(list);
    return list;
  }

  /** Add a paper to a list and every ancestor list. Idempotent per list. */
  async addPaperToList(
    listId: string,
    paperId: string,
    note?: string,
  ): Promise<ReadingListItem> {
    if (!listId || !paperId) {
      throw new ReadingListValidationError("listId and paperId are required.");
    }
    return this.addToListAndAncestors(listId, { paperId }, note);
  }

  /** Add a note to a list and every ancestor list. Idempotent per list. */
  async addNoteToList(
    listId: string,
    vaultPageId: string,
    note?: string,
  ): Promise<ReadingListItem> {
    if (!listId || !vaultPageId) {
      throw new ReadingListValidationError("listId and vaultPageId are required.");
    }
    return this.addToListAndAncestors(listId, { vaultPageId }, note);
  }

  /** Persist a new paper order for one list. */
  async reorderPapers(listId: string, orderedPaperIds: readonly string[]): Promise<void> {
    const items = await this.deps.items.listItems(listId);
    const lookup = rust().itemIdsForPapers(listId, items, orderedPaperIds);
    if (lookup.error) throw new ReadingListValidationError(lookup.error);
    await this.reorderItems(listId, lookup.itemIds);
  }

  /** Persist a new mixed item order for one list. */
  async reorderItems(listId: string, orderedItemIds: readonly string[]): Promise<void> {
    if (!listId) throw new ReadingListValidationError("listId is required.");
    const items = await this.deps.items.listItems(listId);
    const plan = rust().planItemOrder(listId, items, orderedItemIds);
    if (plan.error) throw new ReadingListValidationError(plan.error);
    const byId = new Map(items.map((i) => [i.id, i]));
    for (const write of plan.writes) {
      await this.deps.items.add({ ...byId.get(write.itemId)!, sortOrder: write.sortOrder });
    }
  }

  async removePaperFromList(listId: string, paperId: string): Promise<void> {
    await this.removeFromList(listId, { paperId });
  }

  async removeNoteFromList(listId: string, vaultPageId: string): Promise<void> {
    await this.removeFromList(listId, { vaultPageId });
  }

  /** Delete a list, its items, and nested sublists (deepest first). */
  async removeList(listId: string): Promise<void> {
    if (!listId) throw new ReadingListValidationError("listId is required.");
    const list = await this.deps.lists.getById(listId);
    // NotFound, not Validation: see the vault use case for the reasoning.
    if (!list) throw new NotFoundError(`List ${listId} not found.`);

    // One read of the lists; the tree is walked in memory.
    const all = await this.deps.lists.list();
    for (const id of rust().deepestFirstListIds(listId, all)) {
      for (const item of await this.deps.items.listItems(id)) {
        await this.deps.items.remove(item.id);
      }
      await this.deps.lists.delete(id);
    }
  }

  /** Walk parentId links from listId up to the root. */
  private async ancestorListIds(listId: string): Promise<string[]> {
    const ancestors: string[] = [];
    let current = await this.deps.lists.getById(listId);
    while (current?.parentId) {
      ancestors.push(current.parentId);
      current = await this.deps.lists.getById(current.parentId);
    }
    return ancestors;
  }

  private findRef(listId: string, ref: ItemRef): Promise<ReadingListItem | null> {
    return "paperId" in ref
      ? this.deps.items.find(listId, ref.paperId)
      : this.deps.items.findNote(listId, ref.vaultPageId);
  }

  private membershipsOf(ref: ItemRef): Promise<ReadingListItem[]> {
    return "paperId" in ref
      ? this.deps.items.listsForPaper(ref.paperId)
      : this.deps.items.listsForNote(ref.vaultPageId);
  }

  private async addToListAndAncestors(
    listId: string,
    ref: ItemRef,
    note?: string,
  ): Promise<ReadingListItem> {
    const primary = await this.addToListOne(listId, ref, note);
    for (const ancestorId of await this.ancestorListIds(listId)) {
      await this.addToListOne(ancestorId, ref, undefined, listId);
    }
    return primary;
  }

  /**
   * Remove the item from listId. An ancestor row inherited from listId stays
   * when another list under that ancestor still holds the item directly; it
   * is re-pointed at that holder. Otherwise it goes too.
   */
  private async removeFromList(listId: string, ref: ItemRef): Promise<void> {
    const existing = await this.findRef(listId, ref);
    if (existing) await this.deps.items.remove(existing.id);

    const memberships = await this.membershipsOf(ref);
    const inherited = memberships.filter((m) => m.inheritedFromListId === listId);
    if (inherited.length === 0) return;

    const directHolders = memberships.filter(
      (m) => m.listId !== listId && m.inheritedFromListId === undefined,
    );
    for (const item of inherited) {
      const holder = await this.firstDescendant(item.listId, directHolders);
      if (holder) {
        await this.deps.items.add({ ...item, inheritedFromListId: holder.listId });
      } else {
        await this.deps.items.remove(item.id);
      }
    }
  }

  /** First candidate whose list sits below ancestorId. */
  private async firstDescendant(
    ancestorId: string,
    candidates: readonly ReadingListItem[],
  ): Promise<ReadingListItem | undefined> {
    for (const c of candidates) {
      if ((await this.ancestorListIds(c.listId)).includes(ancestorId)) return c;
    }
    return undefined;
  }

  private async addToListOne(
    listId: string,
    ref: ItemRef,
    note?: string,
    inheritedFromListId?: string,
  ): Promise<ReadingListItem> {
    const existing = await this.findRef(listId, ref);
    if (existing) return existing;

    const siblings = await this.deps.items.listItems(listId);
    const sortOrder = rust().nextSortOrder(siblings);

    const item: ReadingListItem = {
      id: this.deps.ids.newId(),
      listId,
      ...ref,
      sortOrder,
      note,
      inheritedFromListId,
    };
    try {
      await this.deps.items.add(item);
    } catch (err) {
      if (!inheritedFromListId || !isInheritedLinkError(err)) throw err;
      const plain = { ...item, inheritedFromListId: undefined };
      await this.deps.items.add(plain);
      return plain;
    }
    return item;
  }
}

type ItemRef = { paperId: string } | { vaultPageId: string };

/**
 * The inherited link alone can fail: the source list was deleted meanwhile
 * (FK 23503) or an old schema lacks the column (42703 / PGRST204). Only then
 * is a plain row worth retrying; anything else is a real failure. The code
 * set lives in Rust (`is_inherited_link_code`).
 */
function isInheritedLinkError(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return rust().isInheritedLinkCode(typeof code === "string" ? code : undefined);
}

// --- screen-items.use-case ---
/**
 * Recording a screening decision, and reading a screen back.
 *
 * Orchestration only. The rules are in `screening.ts` and the counts are
 * derived there; this coordinates the repository with them, and is the one
 * place that knows a decision needs an id and a timestamp.
 */
export interface ScreenItemsDeps {
  screening: IScreeningRepository;
  clock: Clock;
  ids: IdGenerator;
}

export interface RecordDecisionInput {
  itemId: string;
  reviewerId: string;
  stage: ScreeningStage;
  state: ScreeningState;
  reason?: string;
}

/** A whole screen, read once: the decisions, the counts, and what is unsettled. */
export interface ScreenSummary {
  decisions: ScreeningDecision[];
  counts: PrismaCounts;
  /** One verdict per item per stage, for a table to render without recomputing. */
  verdicts: ItemVerdict[];
  reasons: { reason: string; count: number }[];
  /** Everyone who has recorded a decision, so a caller can offer the comparisons. */
  reviewers: string[];
}

export class ScreenItemsUseCase {
  constructor(private readonly deps: ScreenItemsDeps) {}

  /**
   * Record one decision.
   *
   * The existing decisions are read first because the one rule worth enforcing
   * -- do not screen the full text of something you excluded on the abstract --
   * is about them. Checked here rather than in the database: it is a rule about
   * one reviewer's own trail, and a CHECK constraint cannot see another row.
   */
  async record(input: RecordDecisionInput): Promise<ScreeningDecision> {
    const existing = await this.deps.screening.listForItems([input.itemId]);
    rust().checkDecision(input, existing);

    const decision: ScreeningDecision = {
      id: this.deps.ids.newId(),
      itemId: input.itemId,
      reviewerId: input.reviewerId,
      stage: input.stage,
      state: input.state,
      reason: input.reason?.trim() || undefined,
      decidedAt: this.deps.clock.nowIso(),
    };
    await this.deps.screening.record(decision);
    return decision;
  }

  async summarize(items: readonly ScreeningItem[]): Promise<ScreenSummary> {
    const decisions = await this.deps.screening.listForItems(items.map((item) => item.id));
    const verdicts = rust().verdictsFor(items, decisions) as ItemVerdict[];
    return {
      decisions,
      counts: rust().prismaCounts(items, decisions),
      verdicts,
      reasons: rust().exclusionReasons(decisions),
      reviewers: rust().reviewers(decisions),
    };
  }
}
