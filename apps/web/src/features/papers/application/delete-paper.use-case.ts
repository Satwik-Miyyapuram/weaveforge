import { imagesOf, UpdatePaperUseCase, type IPaperRepository, type Paper } from "@weaveforge/core";
import type { IBibliographyIntegration } from "@weaveforge/core";
import type { IPaperImageStore } from "../domain/zotero";

export class DeletePaperUseCase {
  constructor(
    private readonly deps: {
      bibliography: IBibliographyIntegration;
      images: IPaperImageStore;
      updatePaper: UpdatePaperUseCase;
      papers: IPaperRepository;
    },
  ) {}

  async execute(paper: Paper): Promise<void> {
    const zoteroKey = paper.metadata?.zoteroKey as string | undefined;
    if (zoteroKey) {
      try {
        await this.deps.bibliography.removeRemotePaper(zoteroKey);
      } catch {
        /* best-effort */
      }
    }
    // A paper's images are independent objects in blob storage, so deleting
    // them one round trip at a time made the delete take as long as the paper
    // had figures. Best-effort per image, as before — one failure must not
    // strand the rest or the row itself.
    await Promise.all(
      imagesOf(paper).map(async (img) => {
        try {
          await this.deps.images.remove(img);
        } catch {
          /* best-effort */
        }
      }),
    );
    await this.deps.updatePaper.remove(paper.id);
  }
}
