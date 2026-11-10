import { logToApp } from "@/lib/error-report/app-log";
import { readyCore } from "@/lib/rust-core";
import type { ZoteroCredentialsProvider } from "./zotero-metadata-source";
import type { ZoteroAnnotation, ZoteroItemRow } from "@weaveforge/wasm";
import type { ZoteroAnnotationPull } from "../domain/zotero";
import {
  fetchAllZoteroItems,
  fetchZoteroItemKeys,
  zoteroHeaders,
  zoteroLibraryUrl,
  zoteroTopLevelPath,
} from "./zotero-web-api";

export type { ZoteroAnnotation } from "@weaveforge/wasm";

/**
 * Rust leaves absent fields out; the old TS always set comment, color and page,
 * undefined when Zotero had none. Keep those keys so the shape stays the same.
 */
function annotationWithKeys(ann: ZoteroAnnotation): ZoteroAnnotation {
  const mapped = Object.fromEntries(Object.entries(ann).map(([k, v]) => [k, v ?? undefined]));
  return { comment: undefined, color: undefined, page: undefined, ...mapped } as ZoteroAnnotation;
}

export class ZoteroAnnotations {
  constructor(
    private readonly credentials: ZoteroCredentialsProvider,
    private readonly fetchFn: typeof fetch = (...a) => fetch(...a),
    private readonly apiOrigin = "https://api.zotero.org",
  ) {}

  /** The annotations, plus the PDF attachment each paper's annotations hang off. */
  async pull(): Promise<ZoteroAnnotationPull> {
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
      fetchAllZoteroItems<ZoteroItemRow>({
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
    // A paper's main PDF is where a write-back would put a new annotation.
    const attachToPaper = new Map<string, string>();
    const pdfsByPaper = new Map<string, ZoteroItemRow[]>();
    for (const it of attachments) {
      const key = readyCore().zoteroItemKey(it);
      const paperKey = it.data?.parentItem;
      if (!key || !paperKey) continue;
      if (allowedPaperKeys && !allowedPaperKeys.has(paperKey)) continue;
      attachToPaper.set(key, paperKey);
      if (readyCore().zoteroIsPdfAttachment(it)) {
        pdfsByPaper.set(paperKey, [...(pdfsByPaper.get(paperKey) ?? []), it]);
      }
    }
    const paperPdf = new Map<string, string>();
    const choices: string[] = [];
    for (const [paperKey, pdfs] of pdfsByPaper) {
      const main = readyCore().zoteroPickMainPdf(pdfs);
      if (main) paperPdf.set(paperKey, main);
      if (pdfs.length > 1) {
        const keys = pdfs.map((p) => readyCore().zoteroItemKey(p));
        choices.push(`${paperKey}: ${main} of ${keys.join(", ")}`);
      }
    }
    if (choices.length) {
      logToApp({
        level: "info",
        source: "zotero.annotations",
        message: `Picked the main PDF for ${choices.length} paper(s) with several PDFs`,
        detail: choices.join("\n"),
      });
    }
    // But the PDF the reader already annotated in Zotero wins: that is the
    // file the existing marks are on, so new ones belong beside them.
    const annotatedPdf = new Map<string, string>();

    // Pass 2: annotations, resolved to their paper via the attachment map.
    const byPaper = new Map<string, ZoteroAnnotation[]>();
    for (const it of annotations) {
      const attKey = it.data?.parentItem;
      const paperKey = attKey ? attachToPaper.get(attKey) : undefined;
      if (!paperKey) continue;
      if (!annotatedPdf.has(paperKey)) annotatedPdf.set(paperKey, attKey!);
      const ann = annotationWithKeys(readyCore().zoteroAnnotationFromItem(it));
      const list = byPaper.get(paperKey);
      if (list) list.push(ann);
      else byPaper.set(paperKey, [ann]);
    }

    // Zotero notes are direct child items of a paper. Keep them separate from
    // highlights so AI access can be scoped to precisely selected note sources.
    for (const it of notes) {
      const paperKey = it.data?.parentItem;
      if (!paperKey || (allowedPaperKeys && !allowedPaperKeys.has(paperKey))) continue;
      const note = readyCore().zoteroNoteFromItem(it);
      if (!note) continue;
      const list = byPaper.get(paperKey);
      if (list) list.push(note);
      else byPaper.set(paperKey, [note]);
    }
    return { byPaper, attachments: new Map([...paperPdf, ...annotatedPdf]) };
  }
}
