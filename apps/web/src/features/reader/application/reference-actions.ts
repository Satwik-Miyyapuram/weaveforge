/**
 * The popover's intents, mapped onto use-cases.
 *
 * The component is presentation only and the reader owns positioning; this is
 * the one place that knows which repository a "Read later" click ends up in.
 * Dependencies are narrowed to the methods actually used, so the module can be
 * tested against fakes and does not drag the whole container into a test.
 */

import {
  ValidationError,
  type AddPaperResult,
  type NewPaperInput,
  type NewPaperRelationInput,
  type PaperMetadata,
  type PaperRef,
  type PaperStatus,
  type ParsedReference,
} from "@weaveforge/core";
import { readyCore } from "@/lib/rust-core";

export interface ReferenceActionDeps {
  /** Resolves metadata for a DOI/arXiv/title reference and adds it. */
  importPaper: { importRef(ref: PaperRef, status?: PaperStatus): Promise<AddPaperResult> };
  /** Adds a paper from known fields, deduping against the library. */
  addPaper: { add(input: NewPaperInput): Promise<AddPaperResult> };
  relations: { add(input: NewPaperRelationInput): Promise<unknown> };
}

export function createReferenceActions(deps: ReferenceActionDeps) {
  /**
   * Add the record the popover resolved, when there is one. Searching the
   * entry's title again could land on another paper than the one shown, and a
   * neighbouring entry would then read "in library" for a paper it never cited.
   */
  const add = (entry: ParsedReference, metadata: PaperMetadata | undefined) =>
    metadata ? deps.addPaper.add(metadata) : deps.importPaper.importRef(readyCore().referenceRef(entry));

  return {
    /**
     * Put the cited paper on the shelf with the library's default status. The
     * popover is a footnote, not a triage tool: choosing a reading list from
     * here was a detour, and lists remain a library-side action.
     */
    addToLibrary: (entry: ParsedReference, metadata?: PaperMetadata): Promise<AddPaperResult> =>
      add(entry, metadata),

    /** Unresolved entry: no metadata anywhere, so add what the text gives us. */
    addManually: (entry: ParsedReference): Promise<AddPaperResult> =>
      deps.addPaper.add(readyCore().manualInputFromReference(entry)),

    /**
     * State B's link action: `citingPaper` cites `citedPaper`. The use-case is
     * idempotent, so a double click or a second visit cannot duplicate the edge.
     */
    linkPapers: (citingPaperId: string, citedPaperId: string): Promise<unknown> => {
      if (citingPaperId === citedPaperId) {
        return Promise.reject(new ValidationError("A paper cannot cite itself."));
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
