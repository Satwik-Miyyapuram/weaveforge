import { isLocalMode } from "@/backend/providers/local/local-identity";
import { desktop } from "@/lib/desktop/desktop-bridge";
import { type AppLogInput, logToApp } from "@/lib/error-report/app-log";
import { describeRejection } from "@/lib/format-error";
import { readStored, removeStored, writeStored } from "@/lib/safe-storage";

// --- batch-annotation-ops ---
export interface BatchImageRegion {
  annotationId: string;
  pageIndex: number;
  rect: number[];
  color: string;
}

export interface ActivityLogEntry {
  id: string;
  at: string;
  kind: string;
  message: string;
}

export function appendActivityLog(
  log: readonly ActivityLogEntry[],
  entry: Omit<ActivityLogEntry, "id" | "at"> & { id?: string; at?: string },
  cap = 100,
): ActivityLogEntry[] {
  const next: ActivityLogEntry = {
    id: entry.id ?? `act-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    at: entry.at ?? new Date().toISOString(),
    kind: entry.kind,
    message: entry.message,
  };
  return [next, ...log].slice(0, Math.max(1, cap));
}

// --- link-pdf-source ---
/**
 * Remember where a fetched PDF came from, so the paper can fetch it again.
 *
 * The bytes are already kept, so a failed link must not fail the fetch; the
 * link is a convenience for next time. It is logged rather than dropped.
 */
export async function linkPdfSource(
  setPdfSource: (paperId: string, url: string) => Promise<unknown>,
  paperId: string,
  url: string,
  log: (input: AppLogInput) => void = logToApp,
): Promise<void> {
  try {
    await setPdfSource(paperId, url);
  } catch (err) {
    log({
      level: "warn",
      source: "reader",
      message: "Could not link the fetched PDF to its paper",
      detail: `${paperId} ${url}: ${describeRejection(err)}`,
    });
  }
}

// --- object-url-bytes ---
/**
 * PDF bytes behind object URLs this page made, kept in memory.
 *
 * The desktop app's origin cannot fetch a `blob:` URL (status 0), so pdf.js
 * cannot read one either. A viewer that makes a PDF object URL registers its
 * blob here, and the reader hands pdf.js the bytes instead of the URL.
 */
const blobs = new Map<string, Blob>();

/** Makes an object URL for `blob` and remembers the blob until `revokePdfObjectUrl`. */
export function createPdfObjectUrl(blob: Blob, create: (blob: Blob) => string = (b) => URL.createObjectURL(b)): string {
  const url = create(blob);
  blobs.set(url, blob);
  return url;
}

export function revokePdfObjectUrl(url: string, revoke: (url: string) => void = (u) => URL.revokeObjectURL(u)): void {
  blobs.delete(url);
  revoke(url);
}

/** The bytes behind a registered object URL, or null if it was not made here. */
export async function pdfObjectUrlBytes(url: string): Promise<Uint8Array | null> {
  const blob = blobs.get(url);
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
}

// --- pdf-download-consent ---
/**
 * Whether the no-account copy may fetch a paper's PDF from its publisher.
 *
 * Online, with an account, a paper's PDF is fetched the moment it is opened
 * and nobody is asked: the proxy is the app's own server. The no-account copy
 * keeps everything on this computer, so the first reach out to arXiv or
 * OpenReview is something the person should choose — once, if they say so.
 * The answer is kept per browser, next to the other view preferences.
 */
const KEY = "thesis.reader.pdfDownload";

/** True when the reader should ask before fetching a PDF for this paper. */
export function pdfDownloadNeedsConsent(): boolean {
  if (!isLocalMode()) return false;
  return !pdfDownloadRemembered();
}

/**
 * True when the copy can fetch a publisher's PDF without an account: the
 * desktop shell serves the proxy itself, and a sign-in is neither needed nor
 * possible. A browser in local mode has no such route — its proxy is the web
 * server's, and that one asks for a token.
 */
export function pdfProxyNeedsToken(): boolean {
  return desktop() === null;
}

export function pdfDownloadRemembered(): boolean {
  return readStored(KEY) === "always";
}

/** A private window forgets; the prompt returns next time. */
export function rememberPdfDownload(always: boolean): void {
  if (always) writeStored(KEY, "always");
  else removeStored(KEY);
}

// --- reader-annotation-helpers ---
/**
 * Zotero's yellow: the colour a mark gets when none is given.
 * GAP: kept as a literal. READER_ANNOTATION_COLORS reads it at module scope, before wasm loads.
 * Rust source: `DEFAULT_ANNOTATION_COLOR` in `crates/wf-core/src/reader/zotero_projection.rs`.
 */
export const DEFAULT_ANNOTATION_COLOR = "#ffd400";

export const READER_ANNOTATION_COLORS = [
  DEFAULT_ANNOTATION_COLOR,
  "#ff6666",
  "#5fb236",
  "#2ea8e5",
  "#a28ae5",
  "#e56eee",
  "#f19837",
  "#aaaaaa",
] as const;

export interface PagePress {
  x: number;
  y: number;
  time: number;
}

/**
 * What a pointer drag on the page does.
 *
 * `ink` and `highlighter` both produce Zotero ink annotations and differ only
 * in nib width — see `HIGHLIGHTER_MIN_WIDTH` in core for why the distinction is
 * carried by the width rather than by a field Zotero would drop.
 *
 * `select` and `lasso` are two different jobs and were one tool until a loop
 * drawn round a paragraph selected the paragraph. `select` is the **reader's**:
 * it is the pointer a paper is read with — drag across text to highlight it,
 * fire a link, copy a sentence. `lasso` is the **writer's**: it picks ink up,
 * and with it armed the page's text is not a target at all, so a loop drawn over
 * a sentence takes the marks on it rather than the sentence. One tool cannot do
 * both, because a drag is a text selection *or* a loop and never both.
 */
export type ReaderCreateTool =
  | "select"
  | "lasso"
  | "ink"
  | "highlighter"
  | "erase"
  | "image"
  | "text";
