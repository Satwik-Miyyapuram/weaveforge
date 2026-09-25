import {
  mergePaperInto,
  ValidationError,
  type IAnnotationPinRepository,
  type IBibliographyIntegration,
  type IAnnotationQuotationTypeRepository,
  type IPaperFieldRepository,
  type IPaperRelationRepository,
  type IPaperRepository,
  type IReaderAnnotationSink,
  type IReaderAnnotationSource,
  type IReadingListItemRepository,
  type Paper,
} from "@weaveforge/core";

/** A merge that would lose something the app cannot carry across. */
export class PaperMergeRefusedError extends ValidationError {
  constructor(message: string) {
    super(message);
    this.name = "PaperMergeRefusedError";
  }
}

/**
 * Folds duplicate papers into the one being kept.
 *
 * Everything that points at a duplicate is moved before the duplicate is
 * deleted: its reader annotations (re-created on the kept paper, with their
 * pins and quotation types following), its list memberships, the custom
 * field values the kept paper has no value for, and its relations. Notes link
 * to papers by title, so they need nothing. The duplicate's row goes last, and
 * only when every step before it succeeded — a failure part-way leaves both
 * papers, with the kept one holding more, never neither.
 *
 * Zotero decides which row survives. When a copy is linked to Zotero, a
 * linked row is the one kept whichever copy the reader picked, and the picked
 * copy's details fold into it — the reader chose which *paper* to keep, and
 * gets it, under a row Zotero knows. (The picked copy's row, when it is itself
 * linked; otherwise the first linked one.) Refusing instead left the reader
 * to guess which radio button the app would accept.
 *
 * When several copies are linked, the library is holding Zotero's own
 * duplicate. The extra linked copies are merged like any other and then
 * removed from Zotero too — the same removal Delete does — because a copy
 * deleted only here is still in Zotero, and the next sync would pull it back
 * as a fresh duplicate. Its Zotero annotations are re-created on the kept
 * paper as the app's own, so nothing the reader wrote goes with it. The Zotero
 * removal runs last, after everything has moved, and a failure there stops
 * before the local row goes: retrying the merge then finishes the job instead
 * of the copy coming back.
 */
export class MergePapersUseCase {
  constructor(
    private readonly deps: {
      papers: IPaperRepository;
      annotations: IReaderAnnotationSource & IReaderAnnotationSink;
      pins: IAnnotationPinRepository;
      quotationTypes: IAnnotationQuotationTypeRepository;
      listItems: IReadingListItemRepository;
      fields: IPaperFieldRepository;
      relations: IPaperRelationRepository;
      /** Removes a merged-away copy's Zotero item. Without it, merging two linked copies is refused. */
      bibliography?: Pick<IBibliographyIntegration, "removeRemotePaper">;
      newId: () => string;
      now?: () => string;
    },
  ) {}

  /** Merge every paper in `duplicateIds` into `keepId`, one at a time. */
  async execute(keepId: string, duplicateIds: readonly string[]): Promise<Paper> {
    const chosen = await this.load(keepId);
    // A duplicate already gone is one an earlier, interrupted run of this
    // merge finished: retrying after a Zotero failure names every copy again,
    // and the ones that went through must not stop the rest.
    const others = (
      await Promise.all(duplicateIds.filter((id) => id !== keepId).map((id) => this.deps.papers.getById(id)))
    ).filter((p): p is Paper => p != null);
    const all = [chosen, ...others];
    const linked = all.filter((p) => zoteroKeyOf(p) != null);
    if (linked.length > 1 && !this.deps.bibliography) {
      throw new PaperMergeRefusedError(
        `${linked.length} of these copies are linked to Zotero. Merge them in Zotero; the next sync brings the result here.`,
      );
    }
    let kept = zoteroKeyOf(chosen) != null ? chosen : (linked[0] ?? chosen);
    const dups = all.filter((p) => p.id !== kept.id);
    // The chosen copy folds in first, so where the survivor has no value its
    // details are the ones that fill it.
    dups.sort((a, b) => Number(b.id === keepId) - Number(a.id === keepId));
    for (const dup of dups) kept = await this.mergeOne(kept, dup);
    return kept;
  }

  private async load(id: string): Promise<Paper> {
    const paper = await this.deps.papers.getById(id);
    if (!paper) throw new PaperMergeRefusedError("One of these papers is no longer in the library. Reload and try again.");
    return paper;
  }

  private async mergeOne(keep: Paper, dup: Paper): Promise<Paper> {
    const { annotations, pins, quotationTypes, listItems, fields, relations } = this.deps;
    const anns = await annotations.list(dup.id);

    const merged: Paper = { ...mergePaperInto(keep, dup), updatedAt: this.deps.now?.() ?? new Date().toISOString() };
    await this.deps.papers.save(merged);

    // Annotations: a new id on the kept paper, so pins keyed by the old id follow.
    const keyMap = new Map<string, string>();
    for (const a of anns) {
      const copy = await annotations.create(keep.id, {
        type: a.type,
        color: a.color,
        text: a.text,
        comment: a.comment,
        tags: a.tags,
        anchor: a.anchor,
        sortIndex: a.sortIndex,
        pageIndex: a.anchor.zoteroPosition?.pageIndex ?? 0,
      });
      keyMap.set(a.id, copy.id);
    }
    const keyFor = (k: string) => keyMap.get(k) ?? k;

    const keptPins = new Set((await pins.listForPaper(keep.id)).map((p) => p.annotationKey));
    for (const pin of await pins.listForPaper(dup.id)) {
      const key = keyFor(pin.annotationKey);
      if (!keptPins.has(key)) await pins.save({ paperId: keep.id, annotationKey: key, reportSectionId: pin.reportSectionId });
      await pins.remove(dup.id, pin.annotationKey);
    }
    const keptTypes = new Set((await quotationTypes.listForPaper(keep.id)).map((q) => q.annotationKey));
    for (const q of await quotationTypes.listForPaper(dup.id)) {
      const key = keyFor(q.annotationKey);
      if (!keptTypes.has(key)) await quotationTypes.save({ paperId: keep.id, annotationKey: key, quotationType: q.quotationType });
      await quotationTypes.remove(dup.id, q.annotationKey);
    }

    for (const item of await listItems.listsForPaper(dup.id)) {
      if (!(await listItems.find(item.listId, keep.id))) {
        await listItems.add({ ...item, id: this.deps.newId(), paperId: keep.id });
      }
      await listItems.remove(item.id);
    }

    const keptFields = new Set((await fields.listValuesForPaper(keep.id)).map((v) => v.fieldId));
    for (const v of await fields.listValuesForPaper(dup.id)) {
      if (!keptFields.has(v.fieldId)) await fields.setValue({ paperId: keep.id, fieldId: v.fieldId, value: v.value });
    }

    for (const rel of await relations.relationsFor(dup.id)) {
      const fromPaper = rel.fromPaper === dup.id ? keep.id : rel.fromPaper;
      const toPaper = rel.toPaper === dup.id ? keep.id : rel.toPaper;
      const pointless = fromPaper === toPaper;
      if (!pointless && !(await relations.findEdge(fromPaper, toPaper, rel.relation))) {
        await relations.save({ ...rel, id: this.deps.newId(), fromPaper, toPaper });
      }
      await relations.delete(rel.id);
    }

    for (const a of anns) await annotations.remove(a.id);
    const zoteroKey = zoteroKeyOf(dup);
    if (zoteroKey != null) {
      try {
        await this.deps.bibliography?.removeRemotePaper(zoteroKey);
      } catch (err) {
        const why = err instanceof Error ? ` (${err.message})` : "";
        throw new PaperMergeRefusedError(
          `Everything from “${dup.title}” was moved, but Zotero would not remove its copy${why}. Run the merge again once Zotero is reachable.`,
        );
      }
    }
    // The row itself, directly: its images and PDF now belong to the kept
    // paper, so the delete path that removes a paper's images must not run.
    await this.deps.papers.delete(dup.id);
    // A delete the store refused without an error — a row-level policy that
    // matches nothing answers with success — would leave the pair in place and
    // the tidy-up offering the same merge for ever. Say so instead.
    if (await this.deps.papers.getById(dup.id)) {
      throw new PaperMergeRefusedError(
        `Everything from “${dup.title}” was moved, but the copy itself could not be removed. Delete it from the list by hand.`,
      );
    }
    return merged;
  }
}

function zoteroKeyOf(paper: Paper): string | undefined {
  const key = paper.metadata?.["zoteroKey"];
  return typeof key === "string" && key ? key : undefined;
}
