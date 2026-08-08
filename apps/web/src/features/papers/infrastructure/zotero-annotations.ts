import type { ZoteroCredentialsProvider } from "./zotero-metadata-source";
import type {
  ZoteroAnnotation,
  ZoteroAnnotationPosition,
  ZoteroAnnotationType,
} from "../domain/zotero";
import {
  fetchAllZoteroItems,
  fetchZoteroItemKeys,
  zoteroHeaders,
  zoteroLibraryUrl,
  zoteroTopLevelPath,
} from "./zotero-web-api";

export type { ZoteroAnnotation } from "../domain/zotero";

/**
 * Every type Zotero defines. Unknown values degrade to `undefined`, so a
 * missing entry here silently strips the type off a real annotation — which is
 * what happened to `text` (ANNOTATION_TYPE_TEXT, added after the others).
 */
const ANNOTATION_TYPES = new Set<ZoteroAnnotationType>([
  "highlight",
  "underline",
  "note",
  "image",
  "ink",
  "text",
]);

interface ZoteroTag { tag?: string }
interface ZoteroItem {
  key?: string;
  data?: {
    parentItem?: string;
    annotationText?: string;
    annotationComment?: string;
    annotationColor?: string;
    annotationPageLabel?: string;
    annotationType?: string;
    /** JSON string, e.g. `{"pageIndex":24,"rects":[[x1,y1,x2,y2]]}`. */
    annotationPosition?: string;
    annotationSortIndex?: string;
    note?: string;
    tags?: ZoteroTag[];
  };
}

export class ZoteroAnnotations {
  constructor(
    private readonly credentials: ZoteroCredentialsProvider,
    private readonly fetchFn: typeof fetch = (...a) => fetch(...a),
    private readonly apiOrigin = "https://api.zotero.org",
  ) {}

  /** Map of Zotero paper key → its annotations, across the whole library. */
  async pullAll(): Promise<Map<string, ZoteroAnnotation[]>> {
    const creds = await this.credentials();
    if (!creds.apiKey || !creds.library) {
      throw new Error("Zotero is not configured. Add your API key and library in Settings.");
    }
    const headers = zoteroHeaders(creds.apiKey);
    const baseUrl = zoteroLibraryUrl(creds.library, this.apiOrigin);
    const col = creds.collection;

    // The four reads are independent of one another — the attachment map is
    // only needed to *join* annotations to papers, not to fetch them — so they
    // go out together. Run one after another, each waiting on the last page of
    // the one before, they were the whole cost of a sync.
    const items = (itemType: string | undefined, collection?: string) =>
      fetchAllZoteroItems<ZoteroItem>({
        baseUrl,
        headers,
        params: { itemType, collection },
        fetchFn: this.fetchFn,
        label: itemType ?? "items",
      });

    const [allowedPaperKeys, attachments, annotations, notes] = await Promise.all([
      col
        // Top-level only: this set gates which parents count as papers, so
        // letting attachment keys into it would defeat the collection scope.
        ? fetchZoteroItemKeys({ baseUrl, path: zoteroTopLevelPath(col), headers, fetchFn: this.fetchFn })
        : Promise.resolve(null),
      items("attachment"),
      items("annotation"),
      items("note"),
    ]);

    // Pass 1: attachment → parent paper key (library-wide; children are not in collections).
    const attachToPaper = new Map<string, string>();
    for (const it of attachments) {
      if (!it.key || !it.data?.parentItem) continue;
      const paperKey = it.data.parentItem;
      if (allowedPaperKeys && !allowedPaperKeys.has(paperKey)) continue;
      attachToPaper.set(it.key, paperKey);
    }

    // Pass 2: annotations, resolved to their paper via the attachment map.
    const byPaper = new Map<string, ZoteroAnnotation[]>();
    for (const it of annotations) {
      const attKey = it.data?.parentItem;
      const paperKey = attKey ? attachToPaper.get(attKey) : undefined;
      if (!paperKey) continue;
      const annotationType = parseAnnotationType(it.data?.annotationType);
      const annotationPosition = parseAnnotationPosition(it.data?.annotationPosition);
      const annotationSortIndex = it.data?.annotationSortIndex || undefined;
      const ann: ZoteroAnnotation = {
        key: it.key,
        kind: "annotation",
        text: it.data?.annotationText || undefined,
        comment: it.data?.annotationComment || undefined,
        color: it.data?.annotationColor || undefined,
        page: it.data?.annotationPageLabel || undefined,
        tags: (it.data?.tags ?? []).map((t) => t.tag ?? "").filter(Boolean),
        ...(annotationType ? { annotationType } : {}),
        ...(annotationPosition ? { annotationPosition } : {}),
        ...(annotationSortIndex ? { annotationSortIndex } : {}),
      };
      const list = byPaper.get(paperKey);
      if (list) list.push(ann);
      else byPaper.set(paperKey, [ann]);
    }

    // Zotero notes are direct child items of a paper. Keep them separate from
    // highlights so AI access can be scoped to precisely selected note sources.
    for (const it of notes) {
      const paperKey = it.data?.parentItem;
      if (!paperKey || (allowedPaperKeys && !allowedPaperKeys.has(paperKey))) continue;
      const text = toPlainText(it.data?.note);
      if (!text) continue;
      const note: ZoteroAnnotation = { key: it.key, kind: "note", text, tags: [] };
      const list = byPaper.get(paperKey);
      if (list) list.push(note);
      else byPaper.set(paperKey, [note]);
    }
    return byPaper;
  }

}

/**
 * Coordinate arrays from Zotero: `rects` and `nextPageRects` are 4-tuples,
 * `paths` are flat point lists of arbitrary length. Anything malformed is
 * dropped rather than propagated.
 */
function parseNumberArrays(raw: unknown, minLength: number): number[][] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const rows = raw.filter(
    (r): r is number[] =>
      Array.isArray(r) &&
      r.length >= minLength &&
      r.every((n) => typeof n === "number" && Number.isFinite(n)),
  );
  return rows.length > 0 ? rows : undefined;
}

/**
 * Parse Zotero's `annotationPosition` JSON string.
 * Absent, empty, or malformed input degrades to undefined — never throws.
 *
 * Shape per `zotero/reader` `src/common/types.ts` (`PDFPosition`). `paths` and
 * `nextPageRects` are kept because dropping them loses real geometry: `paths`
 * is the whole of an ink annotation, and `nextPageRects` is the tail of a
 * highlight that crosses a page break.
 */
function parseAnnotationPosition(raw: string | undefined): ZoteroAnnotationPosition | undefined {
  if (raw == null || raw.trim() === "") return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    const source = parsed as Record<string, unknown>;
    const pageIndex = source.pageIndex;
    if (typeof pageIndex !== "number" || !Number.isFinite(pageIndex)) return undefined;
    const rects = parseNumberArrays(source.rects, 4);
    const nextPageRects = parseNumberArrays(source.nextPageRects, 4);
    // Ink paths are flat [x1,y1,x2,y2,…] runs; two numbers is one point.
    const paths = parseNumberArrays(source.paths, 2);
    return {
      pageIndex,
      ...(rects ? { rects } : {}),
      ...(nextPageRects ? { nextPageRects } : {}),
      ...(paths ? { paths } : {}),
    };
  } catch {
    return undefined;
  }
}

function parseAnnotationType(raw: string | undefined): ZoteroAnnotationType | undefined {
  if (!raw || !ANNOTATION_TYPES.has(raw as ZoteroAnnotationType)) return undefined;
  return raw as ZoteroAnnotationType;
}

/** Zotero stores notes as HTML fragments. Retrieval always receives plain text. */
function toPlainText(note: string | undefined): string | undefined {
  if (!note) return undefined;
  const text = note
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/p\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text || undefined;
}
