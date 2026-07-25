import type { IShareRepository } from "../../sharing/domain/share-repository.js";
import { shareCoversResource } from "../../sharing/domain/share.js";
import type { AddPaperUseCase } from "../../papers/application/add-paper.use-case.js";
import type { IPaperRepository } from "../../papers/domain/paper-repository.js";
import type { Paper } from "../../papers/domain/paper.js";
import { LibraryPinError } from "../domain/library-pin.js";

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
      shareCoversResource(s, "paper", input.resourceId, input.ownerId),
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
