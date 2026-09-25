import {
  findDuplicateGroups,
  isConferenceCopy,
  isPlaceholderTitle,
  pickKeeper,
  titleFixes,
  type DuplicateGroup,
  type IPaperRepository,
  type MetadataResolver,
  type Paper,
  type PaperSummary,
  type TitleFix,
  type UpdatePaperUseCase,
} from "@weaveforge/core";
import type { MergePapersUseCase } from "@/features/papers/application/merge-papers.use-case";

/** A duplicate group as the screen shows it. */
export interface TidyDuplicateGroup extends DuplicateGroup {
  /**
   * The published (conference or journal) copy, when the group has exactly
   * one and it is not already the recommended keeper. The screen offers to
   * keep it instead and bring the reader's notes across into it.
   */
  conferenceId?: string;
}

/** What the tidy-up found, with the papers it names so the screen can show them. */
export interface LibraryTidyScan {
  titles: TitleFix[];
  duplicates: TidyDuplicateGroup[];
  papers: Map<string, PaperSummary & Partial<Pick<Paper, "venue">>>;
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
    const groups = findDuplicateGroups(summaries);
    // The summary projection has no venue, abstract or rating, and the keeper
    // is picked on them too. Only the grouped papers are read in full, which
    // in a tidy library is none.
    const full = new Map<string, Paper>();
    for (const id of new Set(groups.flatMap((g) => g.ids))) {
      const paper = await this.deps.papers.getById(id);
      if (paper) full.set(id, paper);
    }
    const papers = new Map<string, PaperSummary & Partial<Pick<Paper, "venue">>>(summaries.map((p) => [p.id, full.get(p.id) ?? p]));
    const duplicates = groups.map((group): TidyDuplicateGroup => {
      const members = group.ids.map((id) => full.get(id)).filter((p): p is Paper => !!p);
      if (members.length !== group.ids.length) return group;
      const keepId = pickKeeper(members).id;
      const published = members.filter(isConferenceCopy);
      const conferenceId = published.length === 1 && published[0]!.id !== keepId ? published[0]!.id : undefined;
      return { ...group, keepId, ...(conferenceId ? { conferenceId } : {}) };
    });
    return { titles: titleFixes(summaries), duplicates, papers };
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
