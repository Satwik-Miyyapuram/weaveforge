/**
 * Tidying a library that was imported before the import got careful.
 *
 * Import now refuses placeholder titles and matches duplicates by DOI, arXiv id
 * and title (see `paper-title.ts` and `AddPaperUseCase`). Rows stored before
 * that keep their "Catalog Page" titles and their second copies. This module
 * finds both, and says what it would change; nothing here writes. The Papers
 * screen shows the proposals and saves only what the reader accepts.
 */

import { normalizeDoi, normalizeTags, type Paper, type PaperStatus, type PaperSummary } from "../domain/paper.js";
import { isPlaceholderTitle, titleFromFileName, titleKey } from "../domain/paper-title.js";

/** What the tidy-up would do about one paper's title. */
export interface TitleFix {
  id: string;
  current: string;
  /** A title read back out of the stored one (a reference-manager filename). */
  proposed?: string;
  /**
   * The stored title names nothing, and the paper has an identifier a metadata
   * source can answer for. The screen looks it up before proposing anything.
   */
  lookup?: { doi?: string; arxivId?: string };
}

/**
 * The fix for one paper's title, or null when the title is fine.
 *
 * A filename becomes its title when that gives a real one. A placeholder with a
 * DOI or arXiv id is sent to a lookup. A placeholder with neither is still
 * listed, with no proposal, so the reader sees it and can set it by hand.
 */
export function titleFixFor(paper: Pick<PaperSummary, "id" | "title" | "doi" | "arxivId">): TitleFix | null {
  const current = paper.title ?? "";
  const fromFile = titleFromFileName(current);
  if (fromFile !== current && !isPlaceholderTitle(fromFile)) {
    return { id: paper.id, current, proposed: fromFile };
  }
  if (!isPlaceholderTitle(current)) return null;
  const doi = normalizeDoi(paper.doi);
  const arxivId = paper.arxivId?.trim() || undefined;
  return {
    id: paper.id,
    current,
    ...(doi || arxivId ? { lookup: { ...(doi ? { doi } : {}), ...(arxivId ? { arxivId } : {}) } } : {}),
  };
}

/** Every title in the library that the tidy-up would offer to fix. */
export function titleFixes(papers: readonly Pick<PaperSummary, "id" | "title" | "doi" | "arxivId">[]): TitleFix[] {
  const known = knownTitleKeys(papers);
  return papers
    .map(titleFixFor)
    .filter((fix): fix is TitleFix => fix !== null)
    .map((fix) => {
      const base = fix.proposed ? withoutCopySuffix(fix.proposed, known) : null;
      return base ? { ...fix, proposed: base } : fix;
    });
}

/**
 * Zotero's rename adds " 1", " 2" when a file name is already taken, so a
 * second copy of a paper can arrive titled "… Learning 1.pdf". A title can end
 * in a number too ("Llama 2"), so the suffix goes only when what is left is
 * the title of another paper in the library — the copy it was numbered against.
 *
 * Returns the title without the suffix, or null to keep it as it is.
 */
function withoutCopySuffix(title: string, known: ReadonlySet<string>): string | null {
  const m = /^(.*\S)\s+\d{1,2}$/.exec(title);
  if (!m) return null;
  const key = titleKey(m[1]);
  return key && known.has(key) ? m[1]! : null;
}

function knownTitleKeys(papers: readonly Pick<PaperSummary, "title">[]): Set<string> {
  const keys = new Set<string>();
  for (const p of papers) {
    const k = titleKey(p.title);
    if (k) keys.add(k);
  }
  return keys;
}

/** The key a paper is grouped by title under, with a copy suffix read as above. */
function groupingKey(title: string | undefined, known: ReadonlySet<string>): string | null {
  if (!title) return null;
  const fromFile = titleFromFileName(title);
  if (fromFile !== title) {
    const base = withoutCopySuffix(fromFile, known);
    if (base) return titleKey(base);
  }
  return titleKey(title);
}

/** An arXiv id without its version: 2101.00001v2 and 2101.00001 are one paper. */
function arxivBase(id: string | undefined): string | undefined {
  const t = id?.trim().toLowerCase().replace(/^arxiv:/, "");
  return t ? t.replace(/v\d+$/, "") : undefined;
}

/** Why two papers were grouped, strongest first. */
export type DuplicateReason = "doi" | "arxiv" | "title";

export interface DuplicateGroup {
  /** The copy the others would be merged into. */
  keepId: string;
  /** Every paper in the group, the kept one included, in library order. */
  ids: string[];
  reason: DuplicateReason;
}

/**
 * Papers that are the same paper: the same DOI, the same arXiv id (any
 * version), or, for papers with neither, the same normalised title.
 *
 * Grouped transitively, so a copy matched by DOI to one and by title to another
 * joins one group, not two. A title match between two papers that both carry a
 * DOI, and different ones, is not a match: a paper and its erratum share a
 * title and are different records.
 */
export function findDuplicateGroups(papers: readonly PaperSummary[]): DuplicateGroup[] {
  const parent = papers.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  const reasonOf = new Map<number, DuplicateReason>();
  const rank: Record<DuplicateReason, number> = { doi: 0, arxiv: 1, title: 2 };
  const union = (a: number, b: number, reason: DuplicateReason) => {
    const ra = find(a);
    const rb = find(b);
    const best = [reasonOf.get(ra), reasonOf.get(rb), reason]
      .filter((r): r is DuplicateReason => !!r)
      .sort((x, y) => rank[x] - rank[y])[0]!;
    if (ra !== rb) parent[rb] = ra;
    reasonOf.set(ra, best);
  };

  const byKey = (key: (p: PaperSummary) => string | undefined | null, reason: DuplicateReason) => {
    const first = new Map<string, number>();
    papers.forEach((p, i) => {
      const k = key(p);
      if (!k) return;
      const seen = first.get(k);
      if (seen === undefined) first.set(k, i);
      else union(seen, i, reason);
    });
  };
  byKey((p) => normalizeDoi(p.doi), "doi");
  byKey((p) => arxivBase(p.arxivId), "arxiv");
  // Title only groups papers that do not contradict each other by DOI.
  const titled = new Map<string, number[]>();
  const known = knownTitleKeys(papers);
  papers.forEach((p, i) => {
    const k = groupingKey(p.title, known);
    if (k) titled.set(k, [...(titled.get(k) ?? []), i]);
  });
  for (const members of titled.values()) {
    for (let a = 0; a < members.length; a++) {
      for (let b = a + 1; b < members.length; b++) {
        const da = normalizeDoi(papers[members[a]!]!.doi);
        const db = normalizeDoi(papers[members[b]!]!.doi);
        if (da && db && da !== db) continue;
        union(members[a]!, members[b]!, "title");
      }
    }
  }

  const groups = new Map<number, number[]>();
  papers.forEach((_, i) => {
    const root = find(i);
    groups.set(root, [...(groups.get(root) ?? []), i]);
  });
  const out: DuplicateGroup[] = [];
  for (const [root, members] of groups) {
    if (members.length < 2) continue;
    const group = members.map((i) => papers[i]!);
    out.push({ keepId: pickKeeper(group).id, ids: group.map((p) => p.id), reason: reasonOf.get(root) ?? "title" });
  }
  return out;
}

const STATUS_PROGRESS: Record<PaperStatus, number> = { to_read: 0, skimmed: 1, reading: 2, read: 3 };

/**
 * The copy to keep: the one with a PDF, then the one read furthest, then the
 * one with a real title and identifiers, then the oldest — the one the
 * reader's links and lists were most likely made against.
 */
export function pickKeeper<T extends PaperSummary>(group: readonly T[]): T {
  const score = (p: T) =>
    (p.pdfPath ? 1000 : 0) +
    STATUS_PROGRESS[p.status] * 100 +
    (isPlaceholderTitle(p.title) ? 0 : 50) +
    (p.doi ? 10 : 0) +
    (p.arxivId ? 10 : 0) +
    (p.summary ? 5 : 0) +
    Math.min(p.tags.length, 4);
  return [...group].sort((a, b) => score(b) - score(a) || a.createdAt.localeCompare(b.createdAt))[0]!;
}

/** Identity of a list entry: an annotation's `key`, or the value itself. */
function entryKey(x: unknown): string {
  if (x && typeof x === "object" && typeof (x as { key?: unknown }).key === "string") return `k:${(x as { key: string }).key}`;
  return `v:${JSON.stringify(x)}`;
}

/** Two lists as one, first-seen order, no entry twice (annotations by key). */
function unionList(a: readonly unknown[], b: readonly unknown[]): unknown[] {
  const seen = new Set<string>();
  return [...a, ...b].filter((x) => {
    const k = entryKey(x);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Metadata keys that tie a row to one outside record and must not be copied. */
const OWN_METADATA = new Set(["zoteroKey", "zoteroVersion", "zoteroLibraryId", "mergedFrom"]);

/**
 * The kept paper with what the duplicate knew and it did not.
 *
 * Nothing the kept copy has is overwritten: a gap is filled, tags and
 * metadata keys are unioned (and list-valued ones such as cached annotations
 * and figure images are joined, so pins on the duplicate's annotations still
 * point at something), the status and rating are the further along of the
 * two, and two different summaries are both kept. The duplicate's id is
 * recorded under `metadata.mergedFrom`, so a merge can be traced.
 */
export function mergePaperInto(keep: Paper, dup: Paper): Paper {
  const title = isPlaceholderTitle(keep.title) && !isPlaceholderTitle(dup.title) ? dup.title : keep.title;
  const summaries = [keep.summary?.trim(), dup.summary?.trim()].filter((s): s is string => !!s);
  const metadata: Record<string, unknown> = { ...keep.metadata };
  for (const [k, v] of Object.entries(dup.metadata ?? {})) {
    if (OWN_METADATA.has(k)) continue;
    if (metadata[k] === undefined) metadata[k] = v;
    else if (Array.isArray(metadata[k]) && Array.isArray(v)) metadata[k] = unionList(metadata[k] as unknown[], v);
  }
  const mergedFrom = Array.isArray(keep.metadata?.["mergedFrom"]) ? (keep.metadata["mergedFrom"] as unknown[]) : [];
  metadata["mergedFrom"] = [...mergedFrom.filter((x) => x !== dup.id), dup.id];
  return {
    ...keep,
    title,
    authors: keep.authors.length ? keep.authors : dup.authors,
    year: keep.year ?? dup.year,
    venue: keep.venue ?? dup.venue,
    doi: keep.doi ?? dup.doi,
    arxivId: keep.arxivId ?? dup.arxivId,
    url: keep.url ?? dup.url,
    pdfPath: keep.pdfPath ?? dup.pdfPath,
    abstract: keep.abstract ?? dup.abstract,
    summary: summaries.length > 1 && summaries[0] !== summaries[1] ? summaries.join("\n\n") : summaries[0],
    status: STATUS_PROGRESS[dup.status] > STATUS_PROGRESS[keep.status] ? dup.status : keep.status,
    rating: Math.max(keep.rating ?? 0, dup.rating ?? 0) || undefined,
    readAt: keep.readAt ?? dup.readAt,
    bibtex: keep.bibtex ?? dup.bibtex,
    tags: normalizeTags([...keep.tags, ...dup.tags]),
    metadata,
  };
}
