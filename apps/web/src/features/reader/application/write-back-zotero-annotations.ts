import type {
  IReaderAnnotationSource,
  IReaderAnnotationSyncRecorder,
  Paper,
  ReaderAnnotation,
} from "@weaveforge/core";
import { zoteroWriteBackAnnotations } from "@weaveforge/core";
import type { ZoteroAnnotationWriteResult } from "../infrastructure/zotero-annotation-write-back";

/**
 * Send the annotations made in this app to Zotero, and remember what Zotero
 * answered.
 *
 * This is the half of annotation sync that was missing: the pull brought
 * Zotero's highlights in, but nothing ever sent ours back, so a highlight made
 * here never reached the Zotero reader.
 *
 * What goes:
 * - a local annotation Zotero has never seen (`zoteroKey` null) is created;
 * - one edited here since its last sync (`pending`) is updated, under a
 *   version guard, so an edit made in Zotero meanwhile comes back `conflict`
 *   rather than being overwritten.
 *
 * What stays: annotations that came *from* Zotero (pushing them back is how a
 * round trip turns into a duplicate), rows already `synced`, rows in
 * `conflict` (they wait for the reader to resolve them), and whatever
 * `zoteroWriteBackAnnotations` leaves out (ink, marks with no PDF page).
 */

export interface ZoteroAnnotationPusher {
  push(
    parentItemKey: string,
    annotations: readonly ReaderAnnotation[],
    options: { live: true },
  ): Promise<{ results: ZoteroAnnotationWriteResult[] }>;
}

export interface ZoteroAnnotationWriteBackSummary {
  created: number;
  updated: number;
  conflicts: number;
  failed: number;
  /** The first failure's reason, so the screen can say why. */
  firstError?: string;
}

/** The local annotations a write-back owes Zotero. */
export function annotationsOwedToZotero(annotations: readonly ReaderAnnotation[]): ReaderAnnotation[] {
  return zoteroWriteBackAnnotations(
    annotations.filter(
      (a) => a.origin === "local" && (a.zoteroKey == null || a.syncState === "pending"),
    ),
  );
}

export async function writeBackZoteroAnnotations(deps: {
  papers: readonly Paper[];
  /** Paper → the Zotero PDF attachment to write under, or undefined. */
  attachmentOf: (paper: Paper) => string | undefined;
  annotations: IReaderAnnotationSource & IReaderAnnotationSyncRecorder;
  pusher: ZoteroAnnotationPusher;
}): Promise<ZoteroAnnotationWriteBackSummary> {
  const summary: ZoteroAnnotationWriteBackSummary = { created: 0, updated: 0, conflicts: 0, failed: 0 };
  const fail = (reason: string | undefined, count = 1) => {
    summary.failed += count;
    summary.firstError ??= reason;
  };

  for (const paper of deps.papers) {
    const attachment = deps.attachmentOf(paper);
    if (!attachment) continue;
    const owed = annotationsOwedToZotero(await deps.annotations.list(paper.id));
    if (owed.length === 0) continue;

    let results: ZoteroAnnotationWriteResult[];
    try {
      ({ results } = await deps.pusher.push(attachment, owed, { live: true }));
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err), owed.length);
      continue;
    }

    for (const r of results) {
      if (r.outcome === "failed" || !r.zoteroKey) {
        fail(r.reason);
        continue;
      }
      const syncState = r.outcome === "conflict" ? "conflict" : "synced";
      const prior = owed.find((a) => a.id === r.id);
      await deps.annotations.recordZoteroSync(r.id, {
        zoteroKey: r.zoteroKey,
        zoteroVersion: r.zoteroVersion ?? prior?.zoteroVersion ?? null,
        syncState,
      });
      if (r.outcome === "created") summary.created += 1;
      else if (r.outcome === "updated") summary.updated += 1;
      else summary.conflicts += 1;
    }
  }
  return summary;
}

/**
 * The write-back's part of the sync line, led by its separator, or "" when
 * nothing was owed. Failures carry the first reason: "1 failed" alone leaves
 * the reader nowhere to go, while a 403 says the key cannot write.
 */
export function zoteroWriteBackMessage(summary: ZoteroAnnotationWriteBackSummary | null): string {
  if (!summary) return "";
  const { created, updated, conflicts, failed, firstError } = summary;
  const sent = created + updated;
  const parts: string[] = [];
  if (sent) parts.push(`sent ${sent} annotation${sent === 1 ? "" : "s"} to Zotero`);
  if (conflicts) parts.push(`${conflicts} changed in Zotero meanwhile, left as is`);
  if (failed) parts.push(`${failed} could not be sent${firstError ? ` (${firstError})` : ""}`);
  return parts.length ? ` · ${parts.join(", ")}` : "";
}
