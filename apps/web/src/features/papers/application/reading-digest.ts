import type { Paper, ReaderAnnotation, WorkspaceAnnotation } from "@weaveforge/core";
import type { DigestMark, ReadingMark, ReadingPaper } from "@weaveforge/wasm";
import { buildLocusLink } from "@/features/reader/application/build-locus-link";
import { readyCore } from "@/lib/rust-core";

/**
 * The paper's reader marks as note markdown: each a repaired quote, then a
 * link back to its page and the comment. Marks already in `existing` are left
 * out, so running it again only adds what is new. "" when nothing is new.
 *
 * This prepares each mark (quote repair, reader link, trimming) and Rust
 * assembles the markdown.
 */
export function highlightsDigest(
  annotations: readonly ReaderAnnotation[],
  opts: { paperId: string; existing: string },
): string {
  const marks: DigestMark[] = [];
  for (const a of annotations) {
    const text = a.text.trim();
    const comment = a.comment.trim();
    if (!text && !comment) continue;
    const page = a.anchor.zoteroPosition?.pageIndex;
    marks.push({
      text,
      comment,
      quote: text ? readyCore().formatQuoteBlock(text) : "",
      href: buildLocusLink({ paperId: opts.paperId, locus: a.anchor.locus, page }),
      pageIndex: page ?? null,
      sortIndex: a.sortIndex,
    });
  }
  return readyCore().highlightsDigest(marks, opts.existing);
}

/**
 * A log body for `day`'s reading: papers marked that day, most marks first,
 * then papers marked read that day. "" when there was none.
 *
 * Days are local calendar days. TS turns each timestamp into a local
 * `YYYY-MM-DD`, and Rust compares those strings, so Rust has no timezone logic.
 */
export function draftReadingLog(
  papers: readonly Pick<Paper, "id" | "title" | "readAt">[],
  annotations: readonly WorkspaceAnnotation[],
  day: Date,
): string {
  const target = localDay(day);
  const readingMarks: ReadingMark[] = [];
  for (const a of annotations) {
    const made = dayOf(a.createdAt);
    if (made !== null) readingMarks.push({ paperId: a.paperId, day: made });
  }
  const readingPapers: ReadingPaper[] = papers.map((p) => ({
    id: p.id,
    title: p.title,
    readDay: dayOf(p.readAt),
  }));
  return readyCore().draftReadingLog(readingPapers, readingMarks, target);
}

/** A local calendar day as "YYYY-MM-DD". */
function localDay(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The local day of an ISO timestamp, or null when it is missing or not a date. */
function dayOf(iso: string | undefined): string | null {
  if (iso === undefined) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : localDay(d);
}
