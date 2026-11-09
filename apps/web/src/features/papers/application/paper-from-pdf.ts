/**
 * A paper from a PDF file (design D-21).
 *
 * The DOI printed on the first page is the surest key, then the arXiv id it is
 * stamped with; without either, the PDF's own title is looked up. Without a
 * match, or offline, the paper still takes the PDF's title (its metadata title,
 * else the first line that reads like a title) and the DOI it prints; only a
 * PDF with neither, a scan, is named after
 * the file, and the toast says so. The file itself is kept as the paper's PDF,
 * and on a duplicate too when that paper has none yet. Everything that touches
 * pdf.js, the container or the byte cache is injected, so the rules here run in
 * a plain test.
 */

import { MetadataResolutionError, type AddPaperResult, type Paper, type PaperRef } from "@weaveforge/core";
import type { PdfDropEntry } from "@weaveforge/wasm";
import { loadCore, readyCore } from "@/lib/rust-core";

/** Past this a PDF is more likely a scanned book than a paper; the byte cache is not meant for it. */
export const MAX_PDF_BYTES = 200 * 1024 * 1024;

/** The part of a `File` this needs. */
export interface PdfFileLike {
  readonly name: string;
  readonly size: number;
  readonly type: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** What pdf.js reads off a PDF: the first page's text (empty for a scan) and the metadata title. */
export interface PdfText {
  readonly text: string;
  readonly title?: string;
}

export interface PdfDropDeps {
  online(): boolean;
  readPdf(bytes: ArrayBuffer): Promise<PdfText>;
  importRef(ref: PaperRef): Promise<AddPaperResult>;
  addByTitle(title: string, doi?: string): Promise<AddPaperResult>;
  hasPdf(paperId: string): Promise<boolean>;
  keepPdf(paperId: string, bytes: ArrayBuffer): Promise<void>;
  /** Note scaffold and Zotero push, as the add form does for a new paper. */
  afterCreate(paper: Paper): Promise<void>;
}

/** Where the title came from: a lookup's record, the PDF itself, or the file name. */
export type TitledBy = "lookup" | "pdf" | "file";

export type PdfDropOutcome =
  | {
      kind: "added";
      file: string;
      paper: Paper;
      created: boolean;
      matched: boolean;
      titledBy: TitledBy;
      keptPdf: boolean;
      offline: boolean;
    }
  | { kind: "skipped"; file: string; reason: "not a PDF" | "too large" };

export function isPdfFile(file: Pick<PdfFileLike, "name" | "type">): boolean {
  return readyCore().isPdfFile(file.name, file.type);
}

/** An `arXiv:` id in running text, new style (`2301.12345`) or old (`hep-th/9711200`). */
const ARXIV_STAMP = /\barxiv:\s*(?:[a-z-]+(?:\.[a-z]{2})?\/\d{7}|\d{4}\.\d{4,5})(?:v\d+)?/i;

/** The first of the opening lines that reads like a title, if any. */
export function guessTitle(text: string): string | undefined {
  return readyCore().guessTitle(text);
}

/** The metadata title, unless it is a tool's placeholder or a file name. */
export function metadataTitle(raw: string | undefined): string | undefined {
  return readyCore().metadataTitle(raw);
}

/** Try one lookup; "no source knows it" is a miss, anything else is a fault. */
async function tryRef(ref: PaperRef, deps: PdfDropDeps): Promise<AddPaperResult | null> {
  try {
    return await deps.importRef(ref);
  } catch (err) {
    if (err instanceof MetadataResolutionError) return null;
    throw err;
  }
}

async function readPdf(bytes: ArrayBuffer, deps: PdfDropDeps): Promise<PdfText> {
  try {
    return await deps.readPdf(bytes);
  } catch {
    // A PDF pdf.js cannot parse is still the user's file: keep it by its name.
    return { text: "" };
  }
}

export async function addPaperFromPdf(file: PdfFileLike, deps: PdfDropDeps): Promise<PdfDropOutcome> {
  if (!isPdfFile(file)) return { kind: "skipped", file: file.name, reason: "not a PDF" };
  if (file.size > MAX_PDF_BYTES) return { kind: "skipped", file: file.name, reason: "too large" };

  const bytes = await file.arrayBuffer();
  const offline = !deps.online();
  // pdf.js runs here, so the PDF is read offline too; only the lookups need the network.
  const pdf = await readPdf(bytes, deps);
  const core = await loadCore();
  // The Rust parser takes at most maxIndexTextUtf16() units; a DOI sits near the start.
  const doi = core.extractDoi(pdf.text.slice(0, core.maxIndexTextUtf16()));
  const title = metadataTitle(pdf.title) ?? guessTitle(pdf.text);
  let found: AddPaperResult | null = null;
  if (!offline) {
    if (doi) found = await tryRef({ kind: "doi", value: doi }, deps);
    // arXiv stamps its id down the first page's margin: `arXiv:2301.12345v2 [cs.LG]`.
    const arxiv = core.normalizeArxivId(ARXIV_STAMP.exec(pdf.text)?.[0]);
    if (!found && arxiv) found = await tryRef({ kind: "arxiv", value: arxiv }, deps);
    if (!found && title) found = await tryRef({ kind: "bibliographic", value: title, hints: { title } }, deps);
  }
  const result = found ?? (await deps.addByTitle(title ?? file.name.replace(/\.pdf$/i, ""), doi));
  // A duplicate keeps its own PDF and note; it takes the dropped file only when it has none.
  const keptPdf = result.created || !(await deps.hasPdf(result.paper.id));
  if (keptPdf) await deps.keepPdf(result.paper.id, bytes);
  if (result.created) await deps.afterCreate(result.paper);
  return {
    kind: "added",
    file: file.name,
    paper: result.paper,
    created: result.created,
    matched: found !== null,
    titledBy: found ? "lookup" : title ? "pdf" : "file",
    keptPdf,
    offline,
  };
}

/** One toast for the whole drop, and the paper to open when there was just one. */
export function summarizePdfDrop(outcomes: readonly PdfDropOutcome[]): { message: string; open?: Paper } {
  const { message, opensPaper } = readyCore().summarizePdfDrop(outcomes.map(toDropEntry));
  const only = outcomes[0];
  return opensPaper && only?.kind === "added" ? { message, open: only.paper } : { message };
}

function toDropEntry(o: PdfDropOutcome): PdfDropEntry {
  return o.kind === "added"
    ? { added: true, created: o.created, keptPdf: o.keptPdf, titledBy: o.titledBy, offline: o.offline }
    : { added: false, created: false, keptPdf: false, offline: false };
}
