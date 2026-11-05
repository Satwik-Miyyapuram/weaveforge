/**
 * The container and the Rust core behind {@link importBibFile}.
 */

import type { Paper } from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { loadCore } from "@/lib/rust-core";
import { scaffoldNewPaperNote } from "../application/paper-source-note-scaffold";
import { importBibFile, type BibFileLike, type BibImportOutcome } from "../application/paper-from-bib";

/** Adds the new entries of a `.bib` file to the library. */
export async function addBibFile(file: BibFileLike): Promise<BibImportOutcome> {
  const papers = getContainer().papers;
  const core = await loadCore();
  return importBibFile(file, {
    plan: (name, text, dois, keys) => core.planBibImport(name, text, dois, keys),
    listPapers: () => papers.listPapers(),
    add: (input) => papers.addPaper.add(input),
    afterCreate: async (paper: Paper) => {
      const saved = await scaffoldNewPaperNote(paper, papers.updatePaper);
      await getContainer().zotero.autoPush(saved);
    },
  });
}
