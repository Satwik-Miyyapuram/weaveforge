import type { IPaperRepository, Paper } from "@weaveforge/core";
import type { IZoteroExporter } from "../domain/zotero";

export class AutoPushToZoteroUseCase {
  constructor(
    private readonly deps: {
      exporter: IZoteroExporter;
      papers: IPaperRepository;
    },
  ) {}

  async execute(paper: Paper): Promise<void> {
    if (paper.metadata?.zoteroKey) return;
    try {
      const key = await this.deps.exporter.save(paper);
      if (key) {
        await this.deps.papers.save({ ...paper, metadata: { ...paper.metadata, zoteroKey: key } });
      }
    } catch {
      /* best-effort */
    }
  }
}
