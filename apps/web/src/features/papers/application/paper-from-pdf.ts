/**
 * A paper from a PDF file (design D-21).
 *
 * The DOI printed on the first page is the surest key; without one, the PDF's
 * own title is looked up. Without a match, or offline, the paper still takes
 * the PDF's title (its metadata title, else the first line that reads like a
 * title) and the DOI it prints; only a PDF with neither, a scan, is named after
 * the file, and the toast says so. The file itself is kept as the paper's PDF,
 * and on a duplicate too when that paper has none yet. Everything that touches
 * pdf.js, the container or the byte cache is injected, so the rules here run in
 * a plain test.
 */

import { MetadataResolutionError, extractDoi, type AddPaperResult, type Paper, type PaperRef } from "@weaveforge/core";

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
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}

const HEADER_NOISE = /arxiv|doi|preprint|under review|journal|proceedings|conference|https?:|©|copyright/i;

/** The first of the opening lines that reads like a title, if any. */
export function guessTitle(text: string): string | undefined {
  return text
    .split("\n")
    .slice(0, 8)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .find((line) => line.length >= 12 && line.length <= 250 && line.split(" ").length >= 3 && /[a-z]/i.test(line) && !HEADER_NOISE.test(line));
}

// What writing tools leave in the Title field when the author set none.
const PLACEHOLDER_TITLE = /^(microsoft (word|powerpoint)\b|untitled\b)|\.(pdf|docx?|tex|dvi|ps|rtf|odt)$/i;

/** The metadata title, unless it is a tool's placeholder or a file name. */
export function metadataTitle(raw: string | undefined): string | undefined {
  const title = raw?.replace(/\s+/g, " ").trim();
  if (!title || title.length < 6 || title.split(" ").length < 2 || PLACEHOLDER_TITLE.test(title)) return undefined;
  return title;
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
  const doi = extractDoi(pdf.text) ?? undefined;
  const title = metadataTitle(pdf.title) ?? guessTitle(pdf.text);
  let found: AddPaperResult | null = null;
  if (!offline) {
    if (doi) found = await tryRef({ kind: "doi", value: doi }, deps);
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

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** One toast for the whole drop, and the paper to open when there was just one. */
export function summarizePdfDrop(outcomes: readonly PdfDropOutcome[]): { message: string; open?: Paper } {
  const added = outcomes.filter((o) => o.kind === "added");
  const created = added.filter((o) => o.created);
  const dupes = added.length - created.length;
  const byPdf = created.filter((o) => o.titledBy === "pdf");
  const byName = created.filter((o) => o.titledBy === "file");
  const offline = byPdf.some((o) => o.offline);
  const skipped = outcomes.length - added.length;

  const only = added[0];
  if (outcomes.length === 1 && only) {
    if (!only.created) return { message: only.keptPdf ? "Already in library — PDF attached" : "Already in library", open: only.paper };
    if (only.titledBy === "lookup") return { message: "Paper added", open: only.paper };
    if (only.titledBy === "pdf") {
      return {
        message: only.offline
          ? "Paper added with the PDF's own title — offline, so details were not looked up"
          : "Paper added with the PDF's own title — no match found online",
        open: only.paper,
      };
    }
    return { message: "Paper added, titled from the file name — the PDF has no readable title", open: only.paper };
  }
  const parts = [
    created.length > 0 && plural(created.length, "paper added", "papers added"),
    dupes > 0 && `${dupes} already in library`,
    byPdf.length > 0 && (offline ? `${byPdf.length} not looked up (offline)` : `${byPdf.length} not found online`),
    byName.length > 0 && `${byName.length} titled from the file name`,
    skipped > 0 && `${skipped} skipped`,
  ].filter(Boolean);
  return { message: parts.length > 0 ? parts.join(" · ") : "No PDFs to add" };
}
