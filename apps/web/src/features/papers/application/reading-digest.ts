import type { Paper, ReaderAnnotation, WorkspaceAnnotation } from "@weaveforge/core";
import { buildLocusLink } from "@/features/reader/application/build-locus-link";
import { formatQuoteBlock } from "./sync-annotation-excerpts";

const HEADING = "## Highlights";

/**
 * The paper's reader marks as note markdown: each a repaired quote, then a
 * link back to its page and the comment. Marks already in `existing` are left
 * out, so running it again only adds what is new. "" when nothing is new.
 */
export function highlightsDigest(
  annotations: readonly ReaderAnnotation[],
  opts: { paperId: string; existing: string },
): string {
  let seen = opts.existing;
  const blocks: string[] = [];
  for (const a of [...annotations].sort(byPage)) {
    const text = a.text.trim();
    const comment = a.comment.trim();
    if (!text && !comment) continue;
    const quote = text ? formatQuoteBlock(text) : "";
    const page = a.anchor.zoteroPosition?.pageIndex;
    const href = buildLocusLink({ paperId: opts.paperId, locus: a.anchor.locus, page });
    const link = `[${page === undefined ? "in reader" : `p. ${page + 1}`}](${href})`;
    const tail = comment ? `${link} ${comment}` : link;
    // A quote already in the note is that mark; a bare comment is its line.
    if (seen.includes(quote || tail)) continue;
    const block = quote ? `${quote}\n\n${tail}` : tail;
    blocks.push(block);
    seen += `\n${block}`;
  }
  if (blocks.length === 0) return "";
  const head = opts.existing.includes(HEADING) ? "" : `${HEADING}\n\n`;
  return `${head}${blocks.join("\n\n")}\n`;
}

function byPage(a: ReaderAnnotation, b: ReaderAnnotation): number {
  const pa = a.anchor.zoteroPosition?.pageIndex ?? Number.MAX_SAFE_INTEGER;
  const pb = b.anchor.zoteroPosition?.pageIndex ?? Number.MAX_SAFE_INTEGER;
  return pa - pb || a.sortIndex.localeCompare(b.sortIndex);
}

/**
 * A log body for `day`'s reading: papers marked that day, most marks first,
 * then papers marked read that day. "" when there was none.
 */
export function draftReadingLog(
  papers: readonly Pick<Paper, "id" | "title" | "readAt">[],
  annotations: readonly WorkspaceAnnotation[],
  day: Date,
): string {
  const sameDay = (iso: string | undefined) => iso !== undefined && new Date(iso).toDateString() === day.toDateString();
  const counts = new Map<string, number>();
  for (const a of annotations) if (sameDay(a.createdAt)) counts.set(a.paperId, (counts.get(a.paperId) ?? 0) + 1);
  const marked = papers
    .filter((p) => counts.has(p.id))
    .sort((a, b) => counts.get(b.id)! - counts.get(a.id)! || a.title.localeCompare(b.title))
    .map((p) => {
      const n = counts.get(p.id)!;
      return `- [[${p.title}]]: ${n} annotation${n === 1 ? "" : "s"}`;
    });
  const read = papers.filter((p) => !counts.has(p.id) && sameDay(p.readAt)).map((p) => `- [[${p.title}]]`);
  const lines = [...marked, ...read];
  return lines.length ? `Reading:\n${lines.join("\n")}\n` : "";
}
