/**
 * Kept apart from `bibliography-integration.ts`: the deployment registry pulls
 * that module onto every route, and this merge (with the note-tag helpers) is
 * only needed when a sync or import runs, so callers load it on demand.
 */
import { type IPaperRepository, type ManageTagsUseCase } from "@weaveforge/core";
import type { BibliographyAnnotation, BibliographyAnnotationPull } from "@weaveforge/core";
import { reconcileTagsFromBody } from "@/features/papers/lib/note-tags";
import { readyCore } from "@/lib/rust-core";

/** Metadata key for the Zotero PDF attachment a paper's annotations hang off. */
export const ZOTERO_ATTACHMENT_KEY = "zoteroAttachmentKey";

/**
 * Merge pulled annotations into local papers + tag index.
 *
 * Also records each paper's Zotero PDF attachment, which is what write-back
 * hangs new annotations on, and empties the cached annotations of a paper the
 * pull covered and found none on — otherwise a highlight deleted in Zotero
 * stayed in the reader for good.
 *
 * Which papers change, and their merged summary, is decided in Rust
 * (`integrations::bibliography_annotations`); this function does the reads,
 * saves and tag reconcile.
 */
export async function applyBibliographyAnnotations(
  pulled: BibliographyAnnotationPull,
  papers: IPaperRepository,
  tags: ManageTagsUseCase,
): Promise<number> {
  const { byPaper, attachments } = pulled;
  const all = await papers.list();
  const plans = readyCore().planBibliographyAnnotations(
    all.map((p) => {
      const zotero = p.metadata?.["zoteroKey"];
      const recorded = p.metadata?.[ZOTERO_ATTACHMENT_KEY];
      const cached = p.metadata?.["annotations"];
      return {
        id: p.id,
        summary: p.summary ?? null,
        zoteroKey: typeof zotero === "string" ? zotero : null,
        recordedAttachmentKey: typeof recorded === "string" ? recorded : null,
        cachedAnnotationCount: Array.isArray(cached) ? cached.length : 0,
      };
    }),
    {
      byPaper: Object.fromEntries(
        [...byPaper].map(([key, anns]) => [key, anns.map(toTagSource)]),
      ),
      attachments: Object.fromEntries(attachments),
    },
  );
  const byId = new Map(all.map((p) => [p.id, p]));
  let synced = 0;
  for (const plan of plans) {
    const p = byId.get(plan.id);
    if (!p) continue;
    const anns = byPaper.get(plan.zoteroKey) ?? [];
    await papers.save({
      ...p,
      summary: plan.summary ?? undefined,
      metadata: {
        ...p.metadata,
        ...(plan.covered ? { annotations: anns } : {}),
        ...(plan.attachmentKey ? { [ZOTERO_ATTACHMENT_KEY]: plan.attachmentKey } : {}),
      },
    });
    if (plan.reconcileTags) await reconcileTagsFromBody(tags, p.id, plan.summary ?? "");
    synced += plan.annotationCount;
  }
  return synced;
}

function toTagSource(a: BibliographyAnnotation) {
  return { kind: a.kind ?? null, tags: a.tags, comment: a.comment ?? null, text: a.text ?? null };
}
