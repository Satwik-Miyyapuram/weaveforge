import type { IPaperRepository, MetadataResolver, UpdatePaperUseCase } from "@weaveforge/core";
import { MergePapersUseCase } from "@/features/papers/application/merge-papers.use-case";
import { LibraryTidyFacade } from "@/container/facades/library-tidy";

type MergeDeps = ConstructorParameters<typeof MergePapersUseCase>[0];

/**
 * The library tidy-up, wired.
 *
 * A piece of the composition root pulled out for the same reason as
 * `lifecycle.ts`: the root sits at the size cap, and a merge touches every
 * store that can point at a paper, which is a list worth reading in one place.
 */
export function createLibraryTidy(deps: {
  papers: IPaperRepository;
  updatePaper: UpdatePaperUseCase;
  resolver: Pick<MetadataResolver, "resolve">;
  newId: () => string;
  bibliography: MergeDeps["bibliography"];
  backend: {
    readerAnnotationRepository: MergeDeps["annotations"];
    annotationPinRepository: MergeDeps["pins"];
    annotationQuotationTypeRepository: MergeDeps["quotationTypes"];
    readingListItemRepository: MergeDeps["listItems"];
    paperFieldRepository: MergeDeps["fields"];
    paperRelationRepository: MergeDeps["relations"];
  };
}): LibraryTidyFacade {
  const { backend } = deps;
  return new LibraryTidyFacade({
    papers: deps.papers,
    updatePaper: deps.updatePaper,
    resolver: deps.resolver,
    mergePapers: new MergePapersUseCase({
      papers: deps.papers,
      annotations: backend.readerAnnotationRepository,
      pins: backend.annotationPinRepository,
      quotationTypes: backend.annotationQuotationTypeRepository,
      listItems: backend.readingListItemRepository,
      fields: backend.paperFieldRepository,
      relations: backend.paperRelationRepository,
      bibliography: deps.bibliography,
      newId: deps.newId,
    }),
  });
}
