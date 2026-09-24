import {
  findDuplicateGroups,
  isPlaceholderTitle,
  titleFixes,
  type DuplicateGroup,
  type IPaperRepository,
  type MetadataResolver,
  type PaperSummary,
  type TitleFix,
  type UpdatePaperUseCase,
} from "@weaveforge/core";
import type { MergePapersUseCase } from "@/features/papers/application/merge-papers.use-case";

/** What the tidy-up found, with the papers it names so the screen can show them. */
export interface LibraryTidyScan {
  titles: TitleFix[];
  duplicates: DuplicateGroup[];
  papers: Map<string, PaperSummary>;
}

/**
 * Tidying a library imported before import got careful: placeholder titles
 * ("Catalog Page") and second copies of one paper.
 *
 * Its own facade rather than more methods on `PapersFacade`, which is kept
 * small on purpose. Nothing here changes the library on its own: `scan` only
 * reads, and each fix is applied when the reader accepts it.
 */
export class LibraryTidyFacade {
  constructor(
    private readonly deps: {
      papers: IPaperRepository;
      updatePaper: UpdatePaperUseCase;
      resolver: Pick<MetadataResolver, "resolve">;
      mergePapers: MergePapersUseCase;
    },
  ) {}

  async scan(): Promise<LibraryTidyScan> {
    const summaries = await this.deps.papers.listSummaries();
    return {
      titles: titleFixes(summaries),
      duplicates: findDuplicateGroups(summaries),
      papers: new Map(summaries.map((p) => [p.id, p])),
    };
  }

  /**
   * The title a DOI or arXiv id resolves to, or null when no source knows it
   * or the answer is itself a placeholder.
   */
  async lookUpTitle(lookup: NonNullable<TitleFix["lookup"]>): Promise<string | null> {
    const refs = [
      ...(lookup.doi ? [{ kind: "doi" as const, value: lookup.doi }] : []),
      ...(lookup.arxivId ? [{ kind: "arxiv" as const, value: lookup.arxivId }] : []),
    ];
    for (const ref of refs) {
      try {
        const title = (await this.deps.resolver.resolve(ref)).title?.trim();
        if (title && !isPlaceholderTitle(title)) return title;
      } catch {
        /* the next identifier, or no proposal */
      }
    }
    return null;
  }

  setTitle(paperId: string, title: string) {
    return this.deps.updatePaper.setTitle(paperId, title);
  }

  merge(keepId: string, ids: readonly string[]) {
    return this.deps.mergePapers.execute(keepId, ids);
  }
}
