/**
 * A paper from a PDF file (design D-21).
 *
 * The DOI printed on the first page is the surest key; without one, the first
 * line that reads like a title is looked up; with neither, the paper is named
 * after the file and the toast says so. The file itself is kept as the paper's
 * PDF. Everything that touches pdf.js, the container or the byte cache is
 * injected, so the rules here run in a plain test.
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

export interface PdfDropDeps {
  online(): boolean;
  /** The first page's text; empty for a scan with no text layer. */
  readFirstPage(bytes: ArrayBuffer): Promise<string>;
  importRef(ref: PaperRef): Promise<AddPaperResult>;
  addByTitle(title: string): Promise<AddPaperResult>;
  keepPdf(paperId: string, bytes: ArrayBuffer): Promise<void>;
  /** Note scaffold and Zotero push, as the add form does for a new paper. */
  afterCreate(paper: Paper): Promise<void>;
}

export type PdfDropOutcome =
  | { kind: "added"; file: string; paper: Paper; created: boolean; matched: boolean; offline: boolean }
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

/** Try one lookup; "no source knows it" is a miss, anything else is a fault. */
async function tryRef(ref: PaperRef, deps: PdfDropDeps): Promise<AddPaperResult | null> {
  try {
    return await deps.importRef(ref);
  } catch (err) {
    if (err instanceof MetadataResolutionError) return null;
    throw err;
  }
}

async function firstPageText(bytes: ArrayBuffer, deps: PdfDropDeps): Promise<string> {
  try {
    return await deps.readFirstPage(bytes);
  } catch {
    // A PDF pdf.js cannot parse is still the user's file: keep it by its name.
    return "";
  }
}

export async function addPaperFromPdf(file: PdfFileLike, deps: PdfDropDeps): Promise<PdfDropOutcome> {
  if (!isPdfFile(file)) return { kind: "skipped", file: file.name, reason: "not a PDF" };
  if (file.size > MAX_PDF_BYTES) return { kind: "skipped", file: file.name, reason: "too large" };

  const bytes = await file.arrayBuffer();
  const offline = !deps.online();
  let found: AddPaperResult | null = null;
  if (!offline) {
    const text = await firstPageText(bytes, deps);
    const doi = extractDoi(text);
    if (doi) found = await tryRef({ kind: "doi", value: doi }, deps);
    const title = found ? undefined : guessTitle(text);
    if (title) found = await tryRef({ kind: "bibliographic", value: title, hints: { title } }, deps);
  }
  const result = found ?? (await deps.addByTitle(file.name.replace(/\.pdf$/i, "")));
  // A duplicate is the library's own paper, with its own PDF and note.
  if (result.created) {
    await deps.keepPdf(result.paper.id, bytes);
    await deps.afterCreate(result.paper);
  }
  return { kind: "added", file: file.name, paper: result.paper, created: result.created, matched: found !== null, offline };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** One toast for the whole drop, and the paper to open when there was just one. */
export function summarizePdfDrop(outcomes: readonly PdfDropOutcome[]): { message: string; open?: Paper } {
  const added = outcomes.filter((o) => o.kind === "added");
  const created = added.filter((o) => o.created);
  const dupes = added.length - created.length;
  const byName = created.filter((o) => !o.matched);
  const offline = byName.some((o) => o.offline);
  const skipped = outcomes.length - added.length;

  const only = added[0];
  if (outcomes.length === 1 && only) {
    if (!only.created) return { message: "Already in library", open: only.paper };
    if (only.matched) return { message: "Paper added", open: only.paper };
    return {
      message: only.offline
        ? "Paper added, titled from the file name — you are offline; look it up later"
        : "Paper added, titled from the file name — no match found",
      open: only.paper,
    };
  }
  const parts = [
    created.length > 0 && plural(created.length, "paper added", "papers added"),
    dupes > 0 && `${dupes} already in library`,
    byName.length > 0 && `${byName.length} titled from the file name${offline ? " (offline)" : ""}`,
    skipped > 0 && `${skipped} skipped`,
  ].filter(Boolean);
  return { message: parts.length > 0 ? parts.join(" · ") : "No PDFs to add" };
}
