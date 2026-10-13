/**
 * Kept apart from `bibliography-integration.ts`: the deployment registry pulls
 * that module onto every route, and this merge (with the note-tag helpers) is
 * only needed when a sync or import runs, so callers load it on demand.
 */
import { extractHashtags, type IPaperRepository, type ManageTagsUseCase } from "@weaveforge/core";
import type { BibliographyAnnotationPull } from "@weaveforge/core";
import { appendTagHashtags, reconcileTagsFromBody } from "@/features/papers/lib/note-tags";

/** Metadata key for the Zotero PDF attachment a paper's annotations hang off. */
export const ZOTERO_ATTACHMENT_KEY = "zoteroAttachmentKey";

/**
 * Merge pulled annotations into local papers + tag index.
 *
 * Also records each paper's Zotero PDF attachment, which is what write-back
 * hangs new annotations on, and empties the cached annotations of a paper the
 * pull covered and found none on — otherwise a highlight deleted in Zotero
 * stayed in the reader for good.
 */
export async function applyBibliographyAnnotations(
  pulled: BibliographyAnnotationPull,
  papers: IPaperRepository,
  tags: ManageTagsUseCase,
): Promise<number> {
  const { byPaper, attachments } = pulled;
  const all = await papers.list();
  let synced = 0;
  for (const p of all) {
    const zk = p.metadata?.["zoteroKey"] as string | undefined;
    if (!zk) continue;
    const anns = byPaper.get(zk) ?? [];
    const attachmentKey = attachments.get(zk);
    const cached = p.metadata?.["annotations"];
    const hadCached = Array.isArray(cached) && cached.length > 0;
    const attachmentChanged = !!attachmentKey && p.metadata?.[ZOTERO_ATTACHMENT_KEY] !== attachmentKey;
    // A paper the pull did not cover (outside the synced collection) is left
    // exactly as it was.
    const covered = byPaper.has(zk) || attachments.has(zk);
    if (!anns.length && !(covered && hadCached) && !attachmentChanged) continue;

    let summary = p.summary;
    if (anns.length) {
      // Tags live in the note body as #hashtags — append any Zotero tags (and the
      // hashtags inside annotation comments/text) to the bottom of the summary,
      // then reconcile the paper's tag index from the body.
      const tagNames = anns.filter((a) => a.kind !== "note").flatMap((a) => [
        ...a.tags,
        ...extractHashtags(a.comment),
        ...extractHashtags(a.text),
      ]);
      summary = appendTagHashtags(p.summary ?? "", tagNames) || undefined;
    }
    await papers.save({
      ...p,
      summary,
      metadata: {
        ...p.metadata,
        ...(covered ? { annotations: anns } : {}),
        ...(attachmentKey ? { [ZOTERO_ATTACHMENT_KEY]: attachmentKey } : {}),
      },
    });
    if (anns.length) await reconcileTagsFromBody(tags, p.id, summary ?? "");
    synced += anns.length;
  }
  return synced;
}
