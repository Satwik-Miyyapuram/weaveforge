/**
 * The popover's intents, mapped onto use-cases.
 *
 * The component is presentation only and the reader owns positioning; this is
 * the one place that knows which repository a "Read later" click ends up in.
 * Dependencies are narrowed to the methods actually used, so the module can be
 * tested against fakes and does not drag the whole container into a test.
 */

import type {
  NewPaperInput,
  NewPaperRelationInput,
  Paper,
  PaperRef,
  PaperStatus,
  ParsedReference,
} from "@weaveforge/core";

export interface ReferenceActionDeps {
  /** Resolves metadata for a DOI/arXiv/title reference and adds it. */
  importPaper: { fromRef(ref: PaperRef, status?: PaperStatus): Promise<Paper> };
  /** Adds a paper from fields the user typed. */
  addPaper: { addManual(input: NewPaperInput): Promise<Paper> };
  lists: { addPaperToList(listId: string, paperId: string, note?: string): Promise<unknown> };
  relations: { add(input: NewPaperRelationInput): Promise<unknown> };
}

/**
 * The strongest identifier the entry carries.
 *
 * Resolution order matters: an identifier is a certain match, a title is a
 * search. Only the last resort goes through the bibliographic providers, and it
 * carries the year and first author as hints so a wrong-year paper of the same
 * name is less likely to be picked.
 */
export function referenceRef(entry: ParsedReference): PaperRef {
  if (entry.doi) return { kind: "doi", value: entry.doi };
  if (entry.arxivId) return { kind: "arxiv", value: entry.arxivId };
  return {
    kind: "bibliographic",
    value: entry.title?.trim() || entry.raw.trim(),
    hints: {
      ...(entry.title ? { title: entry.title } : {}),
      ...(entry.year != null ? { year: entry.year } : {}),
      ...(entry.authors[0] ? { firstAuthor: entry.authors[0] } : {}),
    },
  };
}

/** Fields a manual add can fill from a parsed entry, without inventing any. */
export function manualInputFromReference(entry: ParsedReference): NewPaperInput {
  return {
    title: entry.title?.trim() || entry.raw.trim().slice(0, 200),
    status: "to_read",
    ...(entry.authors.length ? { authors: entry.authors } : {}),
    ...(entry.year != null ? { year: entry.year } : {}),
    ...(entry.doi ? { doi: entry.doi } : {}),
    ...(entry.arxivId ? { arxivId: entry.arxivId } : {}),
    ...(entry.url ? { url: entry.url } : {}),
  };
}

export function createReferenceActions(deps: ReferenceActionDeps) {
  return {
    /** State A's primary action: put the cited paper on the shelf as `to_read`. */
    readLater: (entry: ParsedReference): Promise<Paper> =>
      deps.importPaper.fromRef(referenceRef(entry), "to_read"),

    /**
     * Add to a chosen reading list. The paper is imported first, because a list
     * item points at a paper row and the popover may be looking at one we have
     * never seen.
     */
    async addToList(entry: ParsedReference, listId: string): Promise<Paper> {
      const paper = await deps.importPaper.fromRef(referenceRef(entry), "to_read");
      await deps.lists.addPaperToList(listId, paper.id);
      return paper;
    },

    /** Unresolved entry: no metadata anywhere, so add what the text gives us. */
    addManually: (entry: ParsedReference): Promise<Paper> =>
      deps.addPaper.addManual(manualInputFromReference(entry)),

    /**
     * State B's link action: `citingPaper` cites `citedPaper`. The use-case is
     * idempotent, so a double click or a second visit cannot duplicate the edge.
     */
    linkPapers: (citingPaperId: string, citedPaperId: string): Promise<unknown> => {
      if (citingPaperId === citedPaperId) {
        return Promise.reject(new Error("A paper cannot cite itself."));
      }
      return deps.relations.add({
        fromPaper: citingPaperId,
        toPaper: citedPaperId,
        relation: "cites",
        source: "manual",
      });
    },
  };
}

export type ReferenceActions = ReturnType<typeof createReferenceActions>;