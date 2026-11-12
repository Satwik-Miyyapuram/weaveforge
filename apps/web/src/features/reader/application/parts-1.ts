import { getContainer } from "@/bootstrap";
import { activeWorkspaceFs } from "@/features/workspace/application/workspace-folder";
import { readyCore } from "@/lib/rust-core";
import type {
  OpenAccessCandidate,
  OpenAccessIds,
  OpenAccessLookup,
  OpenAccessSource,
} from "@weaveforge/core";
import type { CiteSpan, PageTextItem, PaperHtmlPage, TextSelectionRange } from "@weaveforge/wasm";
import { fetchPdfBytesForCache, getReaderPdfByteCache, resolvePaperPdfSource } from "./parts-3";

// --- citation-spans ---
/**
 * Citation underlines, painted *in* the text layer rather than over it.
 *
 * The previous approach measured a mention's geometry and absolutely
 * positioned a box above the page, which was wrong twice over: the box was a
 * guess at where the text was, and being a sibling it sat over the text rather
 * than in it.
 *
 * Here the text layer's own spans are rewritten: each item's span is split at
 * the mention boundaries that fall inside it and the covered pieces become
 * anchors. The text itself never moves, so the rule is under the glyphs by
 * construction. The segment planning is pure and lives in the Rust core
 * (`planCitationSegments`); this module only paints the DOM.
 */
/**
 * Rewrite the text layer's spans so each citation mention is an anchor.
 *
 * Returns how many anchors were made. Throws if rewriting a span changed its
 * text, which would mean the segments disagree with the item they came from —
 * worse than not decorating at all, since the page would then show something
 * other than the document.
 */
export function decorateCitationSpans(
  textDivs: readonly HTMLElement[],
  items: readonly PageTextItem[],
  mentions: readonly CiteSpan[],
): number {
  const plan = readyCore().planCitationSegments(items, mentions);
  const focused = new Set<string>();
  let count = 0;
  plan.forEach((segments, index) => {
    const span = textDivs[index];
    if (!span) return;
    const fragment = document.createDocumentFragment();
    for (const segment of segments) {
      if (!segment.mention) {
        fragment.append(document.createTextNode(segment.text));
        continue;
      }
      const anchor = document.createElement("a");
      const isUrl = segment.mention.kind === "url" || Boolean(segment.mention.url);
      const isFigure = segment.mention.kind === "figure";

      if (isUrl && segment.mention.url) {
        anchor.href = segment.mention.url;
        anchor.target = "_blank";
        anchor.rel = "noopener noreferrer";
        anchor.className = "pdf-reader-cite pdf-reader-external-link";
        anchor.title = `Open ${segment.mention.url}`;
        anchor.setAttribute("aria-label", `Link: ${segment.mention.url}`);
      } else {
        anchor.href = "#citation-details";
        anchor.className = `pdf-reader-cite${isFigure ? " is-figure-jump" : ""}`;
        anchor.title = segment.mention.label || segment.mention.text || segment.text;
        anchor.setAttribute(
          "aria-label",
          isFigure
            ? `Jump to: ${segment.mention.label || segment.text}`
            : `Reference: ${segment.mention.label || segment.text}`,
        );
      }
      anchor.dataset.mentionKey = segment.mention.key;
      anchor.dataset.from = String(segment.from);
      anchor.dataset.to = String(segment.to);
      anchor.textContent = segment.text;
      anchor.tabIndex = focused.has(segment.mention.key) ? -1 : 0;
      focused.add(segment.mention.key);
      fragment.append(anchor);
      count++;
    }
    // Only the contents change. PDF.js's own font, ascent and transform live on
    // the span, so replacing them would move the text.
    span.replaceChildren(fragment);
    if (span.textContent !== items[index]!.str) {
      throw new Error(`Text changed while linking item ${index}`);
    }
  });
  return count;
}

/** Mark which mention is open or hovered, for the highlight. */
export function setActiveCitation(container: HTMLElement, key: string | null, hover = false): void {
  for (const anchor of Array.from(container.querySelectorAll<HTMLAnchorElement>("a[data-mention-key]"))) {
    anchor.classList.toggle(hover ? "is-hovered" : "is-open", anchor.dataset.mentionKey === key);
  }
}

// --- dom-selection-range ---
export interface ItemTextOffset {
  itemIndex: number;
  offset: number;
}

/**
 * Map a DOM Selection inside a `.pdf-reader-textlayer` to item/offset indices.
 * Spans must carry `data-item-index` matching PageTextGeometry.items order.
 *
 * The text layer's spans are decorated: a citation mention becomes an anchor,
 * so one span can hold several text nodes and the node's own offset no longer
 * says where in the item it starts. Every piece therefore carries `data-from`
 * / `data-to` — its item-local bounds — and the offset is read from those. The
 * reading is what keeps a selection that crosses a citation honest: the words
 * are the same text nodes they always were, so the browser selects them as
 * usual, and this maps the endpoints back onto the item.
 */
export function selectionRangeFromDom(
  selection: Selection | null,
  textLayer: Element,
): TextSelectionRange | null {
  if (!selection || selection.isCollapsed || selection.rangeCount < 1) return null;
  const range = selection.getRangeAt(0);
  if (!textLayer.contains(range.commonAncestorContainer)) return null;

  const start = offsetInTextLayer(range.startContainer, range.startOffset, textLayer, "start");
  const end = offsetInTextLayer(range.endContainer, range.endOffset, textLayer, "end");
  if (!start || !end) return null;
  return readyCore().textSelectionFromOffsets(start, end);
}

/** Map the start boundary of a DOM selection to an ItemTextOffset in this textLayer. */
export function startOffsetInTextLayer(
  selection: Selection | null,
  textLayer: Element,
): ItemTextOffset | null {
  if (!selection || selection.isCollapsed || selection.rangeCount < 1) return null;
  const range = selection.getRangeAt(0);
  return offsetInTextLayer(range.startContainer, range.startOffset, textLayer, "start");
}

/** Map the end boundary of a DOM selection to an ItemTextOffset in this textLayer. */
export function endOffsetInTextLayer(
  selection: Selection | null,
  textLayer: Element,
): ItemTextOffset | null {
  if (!selection || selection.isCollapsed || selection.rangeCount < 1) return null;
  const range = selection.getRangeAt(0);
  return offsetInTextLayer(range.endContainer, range.endOffset, textLayer, "end");
}

/** The decorated piece a node belongs to: its bounds and its item. */
function pieceOf(node: Node, textLayer: Element): { span: HTMLElement; from: number; to: number } | null {
  let cur: Node | null = node;
  while (cur && cur !== textLayer) {
    if (cur instanceof HTMLElement && cur.hasAttribute("data-item-index")) {
      const from = Number(cur.dataset.from);
      const to = Number(cur.dataset.to);
      return {
        span: cur,
        from: Number.isFinite(from) ? from : 0,
        to: Number.isFinite(to) ? to : (cur.textContent?.length ?? 0),
      };
    }
    cur = cur.parentElement;
  }
  return null;
}

function resolveTargetNode(
  node: Node,
  offset: number,
  textLayer: Element,
  edge: "start" | "end",
): { node: Node; offset: number } {
  if (node === textLayer) {
    const children = textLayer.querySelectorAll<HTMLElement>("span[data-item-index]");
    if (children.length === 0) return { node, offset };
    if (edge === "start") {
      const idx = Math.min(Math.max(0, offset), children.length - 1);
      const child = children[idx]!;
      return { node: child, offset: 0 };
    } else {
      const idx = Math.max(0, Math.min(offset > 0 ? offset - 1 : 0, children.length - 1));
      const child = children[idx]!;
      return { node: child, offset: child.childNodes.length };
    }
  }
  return { node, offset };
}

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

function offsetInTextLayer(
  rawNode: Node,
  rawOffset: number,
  textLayer: Element,
  edge: "start" | "end",
): ItemTextOffset | null {
  const { node, offset } = resolveTargetNode(rawNode, rawOffset, textLayer, edge);
  const piece = pieceOf(node, textLayer);
  if (!piece) return null;
  const raw = piece.span.getAttribute("data-item-index");
  if (raw == null) return null;
  const itemIndex = Number(raw);
  if (!Number.isInteger(itemIndex) || itemIndex < 0) return null;

  // 1. Exact measurement using DOM Range in browser environments
  if (typeof document !== "undefined" && typeof document.createRange === "function") {
    try {
      const subRange = document.createRange();
      subRange.selectNodeContents(piece.span);
      const maxOffset =
        node.nodeType === TEXT_NODE
          ? (node.textContent?.length ?? 0)
          : node.childNodes.length;
      subRange.setEnd(node, Math.min(Math.max(0, offset), maxOffset));
      const charOffset = subRange.toString().length;
      const base = piece.span.dataset.from ? piece.from : 0;
      return { itemIndex, offset: base + charOffset };
    } catch {
      // Fall through to manual offset calculation if Range throws
    }
  }

  // 2. Tree-traversal fallback: sum preceding text node lengths inside piece.span
  let offsetInSpan = 0;
  function traverse(n: Node): boolean {
    if (n === node) {
      if (n.nodeType === TEXT_NODE) {
        offsetInSpan += Math.min(Math.max(0, offset), n.textContent?.length ?? 0);
      } else {
        const children = Array.from(n.childNodes);
        for (let i = 0; i < offset && i < children.length; i++) {
          offsetInSpan += children[i]!.textContent?.length ?? 0;
        }
      }
      return true;
    }
    if (n.nodeType === TEXT_NODE) {
      offsetInSpan += n.textContent?.length ?? 0;
      return false;
    }
    for (const child of Array.from(n.childNodes)) {
      if (traverse(child)) return true;
    }
    return false;
  }

  if (traverse(piece.span)) {
    const base = piece.span.dataset.from ? piece.from : 0;
    return { itemIndex, offset: base + offsetInSpan };
  }

  return { itemIndex, offset: edge === "end" ? piece.to : piece.from };
}

export interface PageSelectionSpan {
  startPage: number;
  endPage: number;
}

/**
 * Resolve which page host(s) own the selection (1-based page numbers).
 * Returns { startPage, endPage } where startPage <= endPage.
 */
export function pageSpanFromSelection(
  selection: Selection | null,
  scrollRoot: Element,
): PageSelectionSpan | null {
  if (!selection || selection.rangeCount < 1) return null;
  const range = selection.getRangeAt(0);

  function resolvePage(node: Node | null, offset: number, edge: "start" | "end"): number | null {
    if (!node) return null;
    let cur: Node | null = node;
    if (cur.nodeType === ELEMENT_NODE && (cur === scrollRoot || (cur as Element).classList?.contains?.("pdf-reader-pages"))) {
      const el = cur as Element;
      if (el.childNodes.length > 0) {
        const idx =
          edge === "start"
            ? Math.min(Math.max(0, offset), el.childNodes.length - 1)
            : Math.max(0, Math.min(offset > 0 ? offset - 1 : 0, el.childNodes.length - 1));
        cur = el.childNodes[idx] ?? cur;
      }
    }
    const el = cur.nodeType === ELEMENT_NODE ? (cur as Element) : cur.parentElement;
    const host = el?.closest?.("[data-page]");
    if (!host || !scrollRoot.contains(host)) return null;
    const n = Number((host as HTMLElement).dataset.page);
    return Number.isInteger(n) && n > 0 ? n : null;
  }

  const startPage = resolvePage(range.startContainer, range.startOffset, "start");
  const endPage = resolvePage(range.endContainer, range.endOffset, "end");

  return readyCore().pageSpanOf(startPage ?? undefined, endPage ?? undefined);
}

/** Resolve which page host owns the selection (1-based page number). Returns null if cross-page. */
export function pageNumberFromSelection(
  selection: Selection | null,
  scrollRoot: Element,
): number | null {
  const span = pageSpanFromSelection(selection, scrollRoot);
  if (!span) return null;
  return span.startPage === span.endPage ? span.startPage : null;
}

// --- download-library-pdfs ---
/**
 * Every paper's PDF into the folder (the "download at setup" of the explorer
 * plan, §8): walks the library, and for each paper whose bytes the store
 * does not hold, resolves the source the reader would and keeps what it
 * fetches. With a workspace folder open the store is the folder, so this is
 * what fills `papers/pdf/` after a fresh install — and then costs nothing on
 * the next launch, since everything is already there.
 *
 * One paper at a time with a courtesy pause between fetches, the same as
 * the search index takes: the sources are other people's servers.
 */
export const DOWNLOAD_PAUSE_MS = 3_000;

export interface DownloadProgress {
  done: number;
  total: number;
  fetched: number;
  skipped: number;
}

export interface DownloadOptions {
  signal?: AbortSignal;
  onProgress?: (progress: DownloadProgress) => void;
  /** Injected for tests; defaults to the app's. */
  pauseMs?: number;
}

const pause = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    });
  });

export async function downloadLibraryPdfs(
  options: DownloadOptions = {},
): Promise<DownloadProgress> {
  const progress: DownloadProgress = {
    done: 0,
    total: 0,
    fetched: 0,
    skipped: 0,
  };
  // A folder is the whole reason this walk exists, so a session without one is
  // over before it costs anything: no container read, no cache, no network.
  // Online web mode fetches a paper's PDF when the paper is opened, and never
  // in the background — background bulk fetching is what exhausts a browser's
  // storage quota and somebody else's bandwidth for papers nobody opened.
  if (!activeWorkspaceFs()) return progress;
  const cache = getReaderPdfByteCache();
  if (!cache) return progress;
  const container = getContainer();
  const snapshot = await container.workspace.snapshot();
  const papers = snapshot.papers;
  progress.total = papers.length;
  const pauseMs = options.pauseMs ?? DOWNLOAD_PAUSE_MS;
  for (const paper of papers) {
    if (options.signal?.aborted) break;
    try {
      if (await cache.has(paper.id)) {
        progress.skipped += 1;
        continue;
      }
      // The ladder without the cache rung: what is wanted is the network.
      const resolution = await resolvePaperPdfSource(paper);
      if (!resolution.ok) {
        progress.skipped += 1;
        continue;
      }
      if (progress.fetched > 0) await pause(pauseMs, options.signal);
      if (options.signal?.aborted) break;
      const bytes = await fetchPdfBytesForCache(resolution.hit.url);
      if (!bytes) {
        progress.skipped += 1;
        continue;
      }
      await cache.set(paper.id, bytes);
      progress.fetched += 1;
    } catch {
      progress.skipped += 1;
    } finally {
      progress.done += 1;
      options.onProgress?.({ ...progress });
    }
  }
  return progress;
}

let started = false;

/**
 * The download once per session, in the background, after a desktop folder
 * is adopted. Idempotent: a second adoption in the same session — a folder
 * chosen over the remembered one — does not start a second walk.
 */
export function downloadLibraryPdfsOnce(): void {
  if (started) return;
  started = true;
  void downloadLibraryPdfs().catch(() => {
    // Best-effort: the reader fetches on open regardless.
  });
}

/**
 * One paper's PDF into the folder, awaited.
 *
 * The same rung of the ladder the bulk walk uses, for one paper: what the
 * store already holds is left alone, and what it does not is resolved and
 * fetched. Answers whether the folder now holds it — a paper whose source
 * cannot be resolved is a `false`, not an error, since the reader resolves it
 * again on open.
 */
export async function downloadPaperPdf(paperId: string): Promise<boolean> {
  if (!activeWorkspaceFs()) return false;
  const cache = getReaderPdfByteCache();
  if (!cache) return false;
  try {
    if (await cache.has(paperId)) return true;
    const container = getContainer();
    const paper = await container.papers.getPaper(paperId);
    if (!paper) return false;
    const resolution = await resolvePaperPdfSource(paper);
    if (!resolution.ok) return false;
    const bytes = await fetchPdfBytesForCache(resolution.hit.url);
    if (!bytes) return false;
    await cache.set(paper.id, bytes);
    return true;
  } catch {
    return false;
  }
}

/**
 * The same, for a caller that has a paper id and nothing to wait for.
 *
 * The bulk walk happens when a folder is adopted; a paper imported afterwards
 * — a local Zotero pull, a DOI resolved from the add form — would otherwise
 * wait for the next adoption to reach the disk. It is called from the add
 * use-case, so every path that creates a paper is covered. In a session with
 * no folder it is nothing at all, which is what keeps the web build on demand.
 */
export function queuePaperPdfDownload(paperId: string): void {
  void downloadPaperPdf(paperId).catch(() => {
    // Best-effort: the reader resolves the paper's source on open regardless.
  });
}

// --- find-free-copy ---
/**
 * "Find a free copy": ask the open-access indexes where a paper can be read,
 * then try what they list until one opens.
 *
 * PDFs first, because the reader's annotations, ink and citations work on a
 * PDF; then web pages, kept sanitised and shown in a sandboxed frame. A page
 * with only an abstract on it is not the paper and is passed over.
 *
 * Every step is injected, so the order and the bounds are tested without a
 * network. The messages and the ids are Rust (`reader::free_copy`); read them
 * through `readyCore()`.
 */
export type PdfAttempt = { ok: true } | { ok: false; reason: "no-cache" | "not-pdf" | "blocked" | "failed" };

export type HtmlFetchResult =
  | { ok: true; raw: string; finalUrl: string }
  | { ok: false; reason: "blocked" | "not-html" | "failed"; status?: number };

export interface FreeCopyDeps {
  lookup(ids: OpenAccessIds): Promise<OpenAccessLookup>;
  fetchPdf(paperId: string, url: string): Promise<PdfAttempt>;
  fetchHtml(url: string): Promise<HtmlFetchResult>;
  sanitize(raw: string, baseUrl: string): { html: string; text: string; title: string };
  saveHtml(page: PaperHtmlPage): Promise<void>;
  now?: () => Date;
}

/** Why a listed copy did not open, in words a reader can act on. */
export type AttemptReason = "not-pdf" | "not-html" | "blocked" | "failed" | "abstract-only" | "no-storage";

export interface FreeCopyAttempt {
  url: string;
  format: OpenAccessCandidate["format"];
  reason: AttemptReason;
}

export type FreeCopyOutcome =
  | { kind: "pdf"; candidate: OpenAccessCandidate }
  | { kind: "html"; candidate: OpenAccessCandidate; page: PaperHtmlPage }
  | {
      kind: "none";
      listed: number;
      attempts: FreeCopyAttempt[];
      /** Indexes asked that did not answer. */
      unreachable: OpenAccessSource[];
      /** Indexes asked at all. */
      asked: OpenAccessSource[];
    };

export async function findFreeCopy(
  paperId: string,
  ids: OpenAccessIds,
  deps: FreeCopyDeps,
): Promise<FreeCopyOutcome> {
  const lookup = await deps.lookup(ids);
  const attempts: FreeCopyAttempt[] = [];
  const core = readyCore();
  // At most a capped number of each format is tried (Rust `free_copy_attempts`).
  const picked = core.pickFreeCopyAttempts(lookup.candidates.map((c) => c.format));
  const pdfs = picked.pdf.map((i) => lookup.candidates[i]!);
  const pages = picked.html.map((i) => lookup.candidates[i]!);
  const webArticle = core.isWebArticle(ids);

  for (const candidate of pdfs) {
    let result: PdfAttempt;
    try {
      result = await deps.fetchPdf(paperId, candidate.url);
    } catch {
      result = { ok: false, reason: "failed" };
    }
    if (result.ok) return { kind: "pdf", candidate };
    attempts.push({ url: candidate.url, format: "pdf", reason: result.reason === "no-cache" ? "no-storage" : result.reason });
    // Nowhere to keep a PDF means nowhere to keep any of them.
    if (result.reason === "no-cache") break;
  }

  for (const candidate of pages) {
    let fetched: HtmlFetchResult;
    try {
      fetched = await deps.fetchHtml(candidate.url);
    } catch {
      fetched = { ok: false, reason: "failed" };
    }
    if (!fetched.ok) {
      attempts.push({ url: candidate.url, format: "html", reason: fetched.reason });
      continue;
    }
    const clean = deps.sanitize(fetched.raw, fetched.finalUrl);
    const minChars = webArticle && candidate.source === "paper" ? core.minArticleTextChars() : core.minPaperTextChars();
    if (!core.isSubstantialPaperText(clean.text, minChars)) {
      attempts.push({ url: candidate.url, format: "html", reason: "abstract-only" });
      continue;
    }
    const page: PaperHtmlPage = {
      paperId,
      url: fetched.finalUrl,
      title: clean.title,
      html: clean.html,
      savedAt: (deps.now?.() ?? new Date()).toISOString(),
    };
    try {
      await deps.saveHtml(page);
    } catch {
      attempts.push({ url: candidate.url, format: "html", reason: "no-storage" });
      continue;
    }
    return { kind: "html", candidate, page };
  }

  return {
    kind: "none",
    listed: lookup.candidates.length,
    attempts,
    unreachable: lookup.failed,
    asked: lookup.asked,
  };
}
