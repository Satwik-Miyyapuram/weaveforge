import { extractHashtags, type IPaperRepository, type ManageTagsUseCase, type Paper } from "@weaveforge/core";
import type { IZoteroAnnotationPull } from "../domain/zotero";

export class SyncZoteroAnnotationsUseCase {
  constructor(
    private readonly deps: {
      annotations: IZoteroAnnotationPull;
      papers: IPaperRepository;
      tags: ManageTagsUseCase;
    },
  ) {}

  async execute(): Promise<number> {
    const byPaper = await this.deps.annotations.pullAll();
    const papers = await this.deps.papers.list();
    let synced = 0;
    for (const p of papers) {
      const zk = p.metadata?.["zoteroKey"] as string | undefined;
      const anns = zk ? byPaper.get(zk) : undefined;
      if (!anns || anns.length === 0) continue;
      const items = anns.filter((a) => a.kind !== "note").flatMap((a, i) => {
        const base = (name: string, ref: string) => ({
          name,
          source: "zotero_annotation" as const,
          annotationRef: ref,
        });
        return [
          ...a.tags.map((name, j) => base(name, `t:${i}:${j}`)),
          ...extractHashtags(a.comment).map((name, j) => base(name, `c:${i}:${j}`)),
          ...extractHashtags(a.text).map((name, j) => base(name, `x:${i}:${j}`)),
        ];
      });
      await this.deps.papers.save({ ...p, metadata: { ...p.metadata, annotations: anns } });
      await this.deps.tags.reconcileSources(p.id, items, ["zotero_annotation"]);
      synced += anns.length;
    }
    return synced;
  }
}
