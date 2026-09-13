/**
 * Adding a paper, with its PDF fetched in the background once there is a
 * folder to put it in.
 *
 * The bulk walk (`downloadLibraryPdfs`) runs when a folder is adopted, so a
 * paper added *afterwards* — a local Zotero pull, a DOI resolved from the add
 * form, a duplicate shared into the library — would otherwise wait for the
 * next adoption to reach `papers/pdf/`. Every one of those paths creates its
 * paper through {@link AddPaperUseCase}, so decorating it here covers them
 * all, including the ones added by integrations that never see the papers
 * screen.
 *
 * A subclass rather than a wrapper because the use-case is injected as its own
 * class in a dozen places — and a subclass *is* one, which a hand-rolled
 * wrapper over a class with private fields would not be.
 */

import {
  AddPaperUseCase,
  type AddPaperDeps,
  type NewPaperInput,
  type Paper,
} from "@weaveforge/core";

import { queuePaperPdfDownload } from "@/features/reader/application/download-library-pdfs";

/** How a paper's PDF is asked for; injected so a test needs no container. */
export type PaperPdfPrefetcher = (paperId: string) => void;

export class PrefetchingAddPaperUseCase extends AddPaperUseCase {
  constructor(
    deps: AddPaperDeps,
    private readonly prefetch: PaperPdfPrefetcher = queuePaperPdfDownload,
  ) {
    super(deps);
  }

  /**
   * The paper, and then its PDF — never the other way round.
   *
   * `addManual` answers with an existing paper when the input is a duplicate,
   * and asking for that paper's PDF again is free: the store is checked first
   * and, where it already holds the bytes, nothing is fetched.
   */
  override async addManual(input: NewPaperInput): Promise<Paper> {
    const paper = await super.addManual(input);
    try {
      this.prefetch(paper.id);
    } catch {
      // The paper exists, which is what was asked for. A prefetch that cannot
      // even be queued is not a reason to fail the add: the reader resolves
      // the paper's source when it is opened, folder or no folder.
    }
    return paper;
  }
}
