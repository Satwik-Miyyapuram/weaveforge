import { imagesOf, UpdatePaperUseCase, type IPaperRepository, type Paper } from "@weaveforge/core";
import type { IBibliographyIntegration } from "@weaveforge/core";
import { logToApp } from "@/lib/error-report/app-log";
import { describeRejection } from "@/lib/format-error";
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
      } catch (err) {
        // Best-effort: the local delete still goes ahead, but a Zotero item
        // left behind should be traceable.
        logToApp({
          level: "warn",
          source: "zotero",
          message: "Could not delete the paper from Zotero",
          detail: `${zoteroKey}: ${describeRejection(err)}`,
        });
      }
    }
    // A paper's images are independent objects in blob storage, so deleting
    // them one round trip at a time made the delete take as long as the paper
    // had figures. Best-effort per image, as before — one failure must not
    // strand the rest or the row itself — but an image left behind is logged.
    await Promise.all(
      imagesOf(paper).map(async (img) => {
        try {
          await this.deps.images.remove(img);
        } catch (err) {
          logToApp({
            level: "warn",
            source: "storage",
            message: "Could not delete a paper image from storage",
            detail: `${img}: ${describeRejection(err)}`,
          });
        }
      }),
    );
    await this.deps.updatePaper.remove(paper.id);
  }
}
