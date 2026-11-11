import { loadCore, readyCore, typedCore } from "@/lib/rust-core";
import {
  type AddPaperResult,
  MetadataResolutionError,
  type NewPaperInput,
  type Paper,
  type PaperRef,
  type ReaderAnnotation,
  type WorkspaceAnnotation,
} from "@weaveforge/core";
import type {
  BibImportPaper,
  BibImportPlan,
  DigestMark,
  PaperPreview,
  PdfDropEntry,
  ReadingMark,
  ReadingPaper,
} from "@weaveforge/wasm";

// --- paper-from-bib ---
/**
 * Papers from a `.bib` file (Zotero, Mendeley, Google Scholar, Paperpile exports).
 *
 * The Rust core reads the file and leaves out entries the library already has
 * by DOI or citation key; this saves the rest one by one. The add itself still
 * dedupes (arXiv id, DOI, then a long title), so a paper it hands back unmade is
 * reported as skipped, not added. Everything outside is injected, so the rules
 * here run in a plain test.
 */
/** The part of a `File` this needs. */
export interface BibFileLike {
  readonly name: string;
  text(): Promise<string>;
}

export interface BibImportDeps {
  plan(fileName: string, text: string, existingDois: string[], existingKeys: string[]): BibImportPlan | Promise<BibImportPlan>;
  listPapers(): Promise<Paper[]>;
  add(input: NewPaperInput): Promise<AddPaperResult>;
  /** Runs once for each paper that was made (note scaffold, Zotero push). */
  afterCreate(paper: Paper): Promise<void>;
}

/** One entry not imported, with the line of its `@` and why. */
export interface BibImportIssue {
  readonly key: string;
  readonly line: number;
  readonly reason: string;
}

export interface BibImportOutcome {
  readonly added: Paper[];
  readonly skipped: BibImportIssue[];
  readonly problems: BibImportIssue[];
}

/** A planned entry as the fields a new paper takes; the field rules are in Rust (`bib_import`). */
export function bibPaperInput(entry: BibImportPaper): NewPaperInput {
  // Rust sends absent fields as null; the input type and the old TS have them undefined.
  const input = typedCore().bibPaperInput(entry);
  // Through unknown: the entries are re-keyed to undefined, which the record type does not model.
  return Object.fromEntries(Object.entries(input).map(([k, v]) => [k, v ?? undefined])) as unknown as NewPaperInput;
}

/** Adds every new entry of a `.bib` file; one failed save does not stop the rest. */
export async function importBibFile(file: BibFileLike, deps: BibImportDeps): Promise<BibImportOutcome> {
  const library = await deps.listPapers();
  const dois = library.flatMap((p) => (p.doi ? [p.doi] : []));
  const keys = library.flatMap((p) => typedCore().citeKeyOf(p.metadata) ?? []);
  const plan = await deps.plan(file.name, await file.text(), dois, keys);

  const added: Paper[] = [];
  const skipped: BibImportIssue[] = plan.skipped.map((s) => ({ key: s.key, line: s.line, reason: s.reason }));
  const problems: BibImportIssue[] = plan.problems.map((p) => ({ key: "", line: p.line, reason: p.message }));
  for (const entry of plan.papers) {
    const line = entry.line ?? 0;
    try {
      const { paper, created } = await deps.add(bibPaperInput(entry));
      if (!created) {
        skipped.push({ key: entry.citationKey ?? "", line, reason: `Already in the library as "${paper.title}".` });
        continue;
      }
      await deps.afterCreate(paper);
      added.push(paper);
    } catch (err) {
      problems.push({ key: entry.citationKey ?? "", line, reason: err instanceof Error ? err.message : String(err) });
    }
  }
  return { added, skipped, problems };
}

/** One line for a toast: what was added and what was not. */
export function bibImportMessage(outcome: BibImportOutcome): string {
  return readyCore().bibImportMessage(outcome.added.length, outcome.skipped.length, outcome.problems.length);
}

/** A drop on Papers: `.bib` files are imported, everything else goes the PDF way (which skips non-PDFs). */
export function splitPaperDrop<F extends { readonly name: string }>(files: readonly F[]): { pdfs: F[]; bibs: F[] } {
  const split = readyCore().splitPaperDrop(files.map((f) => f.name));
  const pick = (indices: readonly number[]): F[] =>
    indices.flatMap((i) => {
      const file = files[i];
      return file ? [file] : [];
    });
  return { pdfs: pick(split.pdfIndices), bibs: pick(split.bibIndices) };
}

// --- paper-from-pdf ---
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
  if (readyCore().isPdfTooLarge(file.size)) return { kind: "skipped", file: file.name, reason: "too large" };

  const bytes = await file.arrayBuffer();
  const offline = !deps.online();
  // pdf.js runs here, so the PDF is read offline too; only the lookups need the network.
  const pdf = await readPdf(bytes, deps);
  const core = await loadCore();
  // The Rust parser takes at most maxIndexTextUtf16() units; a DOI sits near the start.
  const doi = core.extractDoi(pdf.text.slice(0, core.maxIndexTextUtf16()));
  const title = readyCore().metadataTitle(pdf.title) ?? readyCore().guessTitle(pdf.text);
  let found: AddPaperResult | null = null;
  if (!offline) {
    if (doi) found = await tryRef({ kind: "doi", value: doi }, deps);
    // arXiv stamps its id down the first page's margin: `arXiv:2301.12345v2 [cs.LG]`.
    const arxiv = core.normalizeArxivId(core.arxivStamp(pdf.text));
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

// --- paper-preview ---
/**
 * What the paper page shows in its preview frame, and where the frame leads.
 *
 * The preview comes from what is on this device: the first page of a saved
 * PDF, or the title and site of a saved web page. Either one opens in the
 * reader, so the frame and the "PDF" button link there even when the paper
 * has no web link to a PDF — a PDF the person added from disk, or a paper
 * that is only a web page.
 */
export type { PaperPreview };

/**
 * Previews already made, by paper id, so a page drawn once is not drawn
 * again. Bounded: past `limit` the least recently used one is dropped and
 * its picture's object URL revoked, so browsing many papers does not keep
 * every first page in memory for the session.
 */
export class PreviewCache {
  private readonly entries = new Map<string, PaperPreview>();

  constructor(
    private readonly limit: number,
    private readonly revoke: (url: string) => void,
  ) {}

  get(paperId: string): PaperPreview | undefined {
    const hit = this.entries.get(paperId);
    if (hit) {
      this.entries.delete(paperId);
      this.entries.set(paperId, hit);
    }
    return hit;
  }

  /** Keep `preview`, or the one already kept for the paper; returns the kept one. */
  remember(paperId: string, preview: PaperPreview): PaperPreview {
    if (preview.kind === "none" || preview.kind === "loading") return preview;
    const known = this.get(paperId);
    if (known) {
      this.drop(preview);
      return known;
    }
    this.entries.set(paperId, preview);
    while (this.entries.size > this.limit) {
      const [oldest, dropped] = this.entries.entries().next().value!;
      this.entries.delete(oldest);
      this.drop(dropped);
    }
    return preview;
  }

  private drop(preview: PaperPreview): void {
    if (preview.kind === "pdf") this.revoke(preview.imageUrl);
  }
}

// --- paper-source-note-scaffold ---
/**
 * Light ZotFlow-style scaffold inserted when a paper note is first created.
 * Uses the Phase C1 default template engine so re-render can refresh metadata
 * without destroying researcher edits.
 */
export function paperSourceNoteScaffold(input: {
  title: string;
  authors?: readonly string[];
  year?: number;
  venue?: string;
  doi?: string;
  citeKey?: string;
}): string {
  const core = readyCore();
  return core.applyTemplate(null, core.defaultSourceNoteTemplate(), core.sourceNoteTemplateContext({ ...input, authors: input.authors && [...input.authors] }));
}

/** Explicit re-render — never call silently on load. */
export function reRenderPaperSourceNote(
  existing: string,
  input: {
    title: string;
    authors?: readonly string[];
    year?: number;
    venue?: string;
    doi?: string;
    citeKey?: string;
  },
): string {
  const core = readyCore();
  return core.applyTemplate(existing, core.defaultSourceNoteTemplate(), core.sourceNoteTemplateContext({ ...input, authors: input.authors && [...input.authors] }));
}

/**
 * Give a just-added paper its note scaffold, unless it already has a note.
 * Returns the paper as saved, so whatever runs next (the Zotero push) sees
 * the scaffolded note rather than the empty one.
 */
export async function scaffoldNewPaperNote(
  paper: Paper,
  papers: { setSummary(id: string, summary: string): Promise<Paper> },
): Promise<Paper> {
  if (!readyCore().isEmptyPaperSummary(paper.summary)) return paper;
  const scaffold = paperSourceNoteScaffold({
    title: paper.title,
    authors: paper.authors,
    year: paper.year,
    venue: paper.venue,
    doi: paper.doi,
    citeKey: readyCore().resolveCiteKey(paper),
  });
  return papers.setSummary(paper.id, scaffold);
}

// --- reading-digest ---
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
      href: readyCore().buildLocusLink({ paperId: opts.paperId, locus: a.anchor.locus, page }),
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
