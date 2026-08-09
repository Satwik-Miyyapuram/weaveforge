"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import {
  isEditableReaderTarget,
  readerKeyboardCommand,
  resolveTextAnchor,
  canJoinInkGroup,
  inkPathsHitTest,
  pdfPointToScreen,
  pdfRectToScreenBox,
  inkWidthForPressure,
  meanPressure,
  screenPointToPdf,
  shouldAppendInkPoint,
  translateInkPaths,
  HIGHLIGHTER_WIDTH,
  INK_DEFAULT_WIDTH,
  type InkGroupCandidate,
  type PageProjection,
  type PageTextGeometry,
  type PdfLocus,
  type AnchorConfidence,
  type ReaderContainerSize,
  type ReaderPageSize,
  type DocumentPageText,
  type ReaderAnnotationType,
} from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { savePdfText } from "@/features/search/infrastructure/pdf-text-store";
import {
  sanitizePdfUrl,
  originalUrlFromProxy,
  isAllowedPdfProxyUrl,
  isReaderObjectUrl,
} from "../application/sanitize-reader-url";
import {
  pageNumberFromSelection,
  selectionRangeFromDom,
} from "../application/dom-selection-range";
import {
  appendInkStroke,
  draftFromTextSelection,
  draftImageRegion,
  draftInkAnnotation,
  draftTextBox,
} from "../application/draft-local-annotation";
import {
  annotationPinKey,
  applyAnnotationPatch,
  isInkTool,
  optimisticAnnotationFromDraft,
  PENDING_ANNOTATION_PREFIX,
  READER_ANNOTATION_COLORS,
  type ReaderCreateTool,
} from "../application/reader-annotation-helpers";
import { useReaderViewport } from "./use-reader-viewport";
import { ReaderToolbar } from "./reader-toolbar";
import { ReaderSearchBar } from "./reader-search-bar";
import { ReaderOutline, type ReaderOutlineItem } from "./reader-outline";
import { AnnotationOverlay } from "./annotation-overlay";
import { bucketAnnotationsByPage } from "../application/project-annotation-geometry";
import { AnnotationSidebar, type ReportSectionOption } from "./annotation-sidebar";
import { SelectionCreateBar } from "./selection-create-bar";
import type { QuotationType, ReaderAnnotation } from "@weaveforge/core";
import {
  darkPdfCanvasFilter,
  shouldUseDarkPdfRendering,
} from "../application/reader-pdf-theme";
import {
  backlinksForAnnotation,
  findAnnotationBacklinks,
  type AnnotationBacklinkHit,
} from "../application/annotation-backlinks";
import { Select } from "@/components/select";
import { Modal } from "@/components/modal";

/**
 * pdf.js render surface. Dynamically imports pdf.js so no bytes reach first
 * paint on non-reader routes. Viewport defaults to fit-width; anchors stay in
 * PDF user space and are projected through viewport.transform at render time.
 */

type PdfLib = typeof import("pdfjs-dist");
type PdfDocument = Awaited<ReturnType<PdfLib["getDocument"]>["promise"]>;
type RenderTask = ReturnType<Awaited<ReturnType<PdfDocument["getPage"]>>["render"]>;

/** Per-page resolve must ignore document-scoped position offsets. */
function pageScopedLocus(locus: PdfLocus): PdfLocus {
  return { quote: locus.quote };
}

/**
 * A mark being drawn right now, in PDF coordinates — either a freehand path
 * (flat x,y pairs, as `inkPath` holds them) or a dragged region.
 */
type DraftShape =
  | { kind: "ink"; pageNumber: number; path: number[]; width: number; highlighter: boolean }
  | { kind: "rect"; pageNumber: number; x0: number; y0: number; x1: number; y1: number };

/** An ink annotation being extended stroke by stroke, so one mark is one row. */
interface InkGroup extends InkGroupCandidate {
  annotationId: string;
}

/** A selected ink annotation being dragged to a new place on its page. */
interface InkMove {
  annotationId: string;
  pointerId: number;
  pageNumber: number;
  /** Where the drag started, in PDF user space. */
  fromX: number;
  fromY: number;
  dx: number;
  dy: number;
}

/** A drawn text-annotation region waiting for the user to type its contents. */
interface PendingTextBox {
  pageIndex: number;
  pageHeight: number;
  x: number;
  y: number;
  width?: number;
  height?: number;
}

interface TextItemGeometry {
  str: string;
  hasEOL?: boolean;
  transform: number[];
  width: number;
  height: number;
}

interface PageText {
  text: string;
  items: { start: number; end: number; index: number }[];
}

export interface PdfReaderProps {
  url: string;
  originalUrl?: string;
  locus?: PdfLocus;
  /** 0-based page hint; when present the jump resolves there first. */
  page?: number;
  /** Projected reader annotations (Zotero and/or local). */
  annotations?: import("@weaveforge/core").ReaderAnnotation[];
  /**
   * Hash of the PDF being rendered, when the source ladder knows it. Stored
   * annotation rects are only trusted against a matching hash; empty on both
   * sides means "unnamed local file", which is trusted.
   */
  contentHash?: string;
  paperTitle?: string;
  quotationTypes?: Map<string, QuotationType>;
  /** When set, selection can create local annotations (R3 sink). */
  paperId?: string;
  onAnnotationsChange?: (
    next: ReaderAnnotation[] | ((prev: ReaderAnnotation[]) => ReaderAnnotation[]),
  ) => void;
  onActivity?: (kind: string, message: string) => void;
  /**
   * Called instead of showing an error when a locally cached copy fails to
   * open, so the owner can evict it and retry from the network.
   */
  onSourceFailure?: (failedUrl: string) => void;
}

interface JumpState {
  status: "idle" | "searching" | "found" | "low" | "missed";
  pageNumber?: number;
  confidence?: AnchorConfidence;
}

/**
 * Below this (PDF user-space units, ≈ points) a text-box drag is treated as a
 * tap and the default box size is used instead — dragging a few pixels by
 * accident should not produce an invisible annotation.
 */
const MIN_TEXT_BOX_PDF_SIZE = 8;

/**
 * What the armed tool will do on release. "Clip a region" and "Write a note"
 * are both a dragged rectangle and look the same mid-drag, so the difference
 * has to be stated rather than inferred.
 */
const CREATE_TOOL_HINTS: Record<ReaderCreateTool, string> = {
  select: "Drag across text to highlight it. Drag a selected ink mark to move it.",
  ink: "Draw freehand. Strokes drawn together stay one annotation.",
  highlighter: "Sweep over the page with a broad translucent nib.",
  erase: "Drag over ink to delete it.",
  image: "Drag a box to clip that part of the page as a picture.",
  text: "Drag a box, then type a note to sit there.",
};

/** How close, in PDF units, the eraser must pass to a stroke to remove it. */
const ERASER_RADIUS = 6;

/**
 * How far a drag must travel before it counts as moving an ink mark rather than
 * a click that selects it.
 */
const INK_MOVE_THRESHOLD = 2;

/** Stable empty array — a fresh `[]` per page would defeat memoisation. */
const EMPTY_ANNOTATIONS: ReaderAnnotation[] = [];

let pdfLibPromise: Promise<PdfLib> | null = null;

async function loadPdfLib(): Promise<PdfLib> {
  if (!pdfLibPromise) {
    pdfLibPromise = import("pdfjs-dist").then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      return lib;
    });
  }
  return pdfLibPromise;
}

function buildPageText(items: readonly { str: string; hasEOL?: boolean }[]): PageText {
  let text = "";
  const ranges: PageText["items"] = [];
  items.forEach((item, index) => {
    const start = text.length;
    text += item.str;
    ranges.push({ start, end: text.length, index });
    if (item.hasEOL) text += "\n";
  });
  return { text, items: ranges };
}

function textItemsFromContent(content: { items: readonly unknown[] }): TextItemGeometry[] {
  return content.items.flatMap((raw): TextItemGeometry[] => {
    const it = raw as Partial<TextItemGeometry>;
    if (typeof it.str !== "string" || !Array.isArray(it.transform)) return [];
    return [
      {
        str: it.str,
        hasEOL: Boolean((raw as { hasEOL?: boolean }).hasEOL),
        transform: it.transform,
        width: typeof it.width === "number" ? it.width : 0,
        height: typeof it.height === "number" ? it.height : 0,
      },
    ];
  });
}

function SafeExternalLink({ href, children }: { href: string; children: ReactNode }) {
  const safe = sanitizePdfUrl(href);
  if (!safe) return null;
  return (
    <a className="btn-secondary" href={safe} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return isEditableReaderTarget(target);
}

async function mapOutline(
  doc: PdfDocument,
  nodes: readonly { title?: string; dest?: unknown; items?: unknown[] }[],
): Promise<ReaderOutlineItem[]> {
  const out: ReaderOutlineItem[] = [];
  for (const node of nodes) {
    let pageNumber: number | null = null;
    try {
      if (node.dest) {
        const dest =
          typeof node.dest === "string" ? await doc.getDestination(node.dest) : node.dest;
        if (Array.isArray(dest) && dest[0]) {
          const idx = await doc.getPageIndex(dest[0] as Parameters<PdfDocument["getPageIndex"]>[0]);
          pageNumber = idx + 1;
        }
      }
    } catch {
      pageNumber = null;
    }
    const children = Array.isArray(node.items)
      ? await mapOutline(doc, node.items as { title?: string; dest?: unknown; items?: unknown[] }[])
      : undefined;
    out.push({
      title: node.title?.trim() || "Untitled",
      pageNumber,
      ...(children?.length ? { items: children } : {}),
    });
  }
  return out;
}

export function PdfReader({
  url,
  originalUrl,
  locus,
  page,
  annotations = [],
  contentHash = "",
  paperTitle = "Paper",
  quotationTypes,
  paperId,
  onAnnotationsChange,
  onActivity,
  onSourceFailure,
}: PdfReaderProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [pdf, setPdf] = useState<PdfDocument | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [jump, setJump] = useState<JumpState>({ status: locus ? "searching" : "idle" });
  const [pageSize, setPageSize] = useState<ReaderPageSize | null>(null);
  const [containerSize, setContainerSize] = useState<ReaderContainerSize | null>(null);
  const [pageTexts, setPageTexts] = useState<DocumentPageText[]>([]);
  const [outline, setOutline] = useState<ReaderOutlineItem[]>([]);
  const [showOutline, setShowOutline] = useState(false);
  const [spread, setSpread] = useState(false);
  const [selectedAnnId, setSelectedAnnId] = useState<string | null>(null);
  const [createTool, setCreateTool] = useState<ReaderCreateTool>("select");
  const [createColor, setCreateColor] = useState<string>(READER_ANNOTATION_COLORS[0]);
  const [pendingCreate, setPendingCreate] = useState<{
    pageNumber: number;
    quote: string;
    selection: import("@weaveforge/core").TextSelectionRange;
  } | null>(null);
  const [createBusy, setCreateBusy] = useState(false);
  const [reportSections, setReportSections] = useState<ReportSectionOption[]>([]);
  const [pinsByKey, setPinsByKey] = useState<Map<string, string | null>>(new Map());
  const [pinsList, setPinsList] = useState<
    { annotationKey: string; reportSectionId: string; paperId: string }[]
  >([]);
  const [backlinkHits, setBacklinkHits] = useState<AnnotationBacklinkHit[]>([]);
  const [darkPdf, setDarkPdf] = useState(false);
  const [annError, setAnnError] = useState<string | null>(null);
  const [vaultBacklinkPages, setVaultBacklinkPages] = useState<
    { id: string; title: string; body: string }[]
  >([]);
  const pageGeometries = useRef(new Map<number, PageTextGeometry>());
  const suppressPageScroll = useRef(false);
  const inkPath = useRef<number[]>([]);
  /** Pressure reported for the stroke being drawn; one width is derived on release. */
  const inkPressures = useRef<number[]>([]);
  /** Pointer that owns the stroke in progress, so a second contact cannot join it. */
  const inkPointerId = useRef<number | null>(null);
  /**
   * Whether a stylus has ever touched this reader.
   *
   * Palm rejection, without a device API for it: a tablet reports the hand
   * resting on the glass as an ordinary `touch` pointer, indistinguishable from
   * a fingertip, so drawing turned every resting palm into a stroke. Once a pen
   * has been seen, touch stops drawing and goes back to scrolling — which is
   * also what a pen user wants their finger to do. On a device with no pen this
   * never trips, and finger drawing keeps working.
   */
  const sawPen = useRef(false);
  /**
   * Mirrors `sawPen` into render, so the page can hand touch scrolling back
   * once a pen is in use. A drawing tool otherwise pins `touch-action: none`
   * on every page and the document cannot be scrolled by finger at all.
   */
  const [penSeen, setPenSeen] = useState(false);
  /** The ink annotation the last stroke went into, for stroke grouping. */
  const inkGroup = useRef<InkGroup | null>(null);
  const inkMove = useRef<InkMove | null>(null);
  /** Ink deleted by the current eraser drag, so one pass deletes each mark once. */
  const erasedIds = useRef<Set<string>>(new Set());
  const dragRect = useRef<{
    pageNumber: number;
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  } | null>(null);
  /**
   * The stroke or region currently under the pointer, in PDF coordinates.
   *
   * `inkPath` and `dragRect` are refs, so mutating them during a drag never
   * re-rendered anything — the mark only appeared once pointer-up persisted the
   * annotation, with no feedback while drawing. This mirrors them into state so
   * the in-progress shape is painted, and is cleared when the drag ends.
   */
  const [draftShape, setDraftShape] = useState<DraftShape | null>(null);
  /**
   * Live offset of the ink mark being dragged. Held here rather than pushed
   * through `onAnnotationsChange` so a move repaints without writing to the
   * annotation list (and the server) on every frame.
   */
  const [movePreview, setMovePreview] = useState<{ id: string; dx: number; dy: number } | null>(
    null,
  );
  const moveFrame = useRef<number | null>(null);
  const pendingMove = useRef<{ id: string; dx: number; dy: number } | null>(null);
  /** Region a text annotation was drawn over, awaiting its text. */
  const [pendingTextBox, setPendingTextBox] = useState<PendingTextBox | null>(null);
  /** Sticky note awaiting its comment, with the colour chosen for it. */
  const [pendingNote, setPendingNote] = useState<{ color: string } | null>(null);
  const pendingShape = useRef<DraftShape | null>(null);
  const shapeFrame = useRef<number | null>(null);

  /**
   * Publish the in-progress shape at most once per frame. Pointer-move fires far
   * more often than the display refreshes, and each publish re-renders a page.
   */
  const scheduleDraft = useCallback((shape: DraftShape | null) => {
    pendingShape.current = shape;
    if (shapeFrame.current != null) return;
    shapeFrame.current = window.requestAnimationFrame(() => {
      shapeFrame.current = null;
      setDraftShape(pendingShape.current);
    });
  }, []);

  const clearDraft = useCallback(() => {
    if (shapeFrame.current != null) {
      window.cancelAnimationFrame(shapeFrame.current);
      shapeFrame.current = null;
    }
    pendingShape.current = null;
    setDraftShape(null);
  }, []);

  /** Same frame budget for a move as for a stroke — see `scheduleDraft`. */
  const scheduleMove = useCallback((next: { id: string; dx: number; dy: number } | null) => {
    pendingMove.current = next;
    if (next == null) {
      if (moveFrame.current != null) {
        window.cancelAnimationFrame(moveFrame.current);
        moveFrame.current = null;
      }
      setMovePreview(null);
      return;
    }
    if (moveFrame.current != null) return;
    moveFrame.current = window.requestAnimationFrame(() => {
      moveFrame.current = null;
      setMovePreview(pendingMove.current);
    });
  }, []);

  useEffect(() => clearDraft, [clearDraft]);
  useEffect(
    () => () => {
      if (moveFrame.current != null) window.cancelAnimationFrame(moveFrame.current);
    },
    [],
  );

  /** Stable identity so a memoised page overlay is not re-rendered by a new closure. */
  const selectAnnotation = useCallback((id: string) => setSelectedAnnId(id), []);
  const renderedPages = useRef(new Set<number>());
  const renderingPages = useRef(new Map<number, Promise<void>>());
  const renderTasks = useRef(new Map<number, RenderTask>());
  const renderGeneration = useRef(0);
  const canCreate = Boolean(paperId && onAnnotationsChange);
  // Bucket once per annotation change rather than rescanning the whole list in
  // every page's overlay on every zoom, scroll, and rotation.
  const annotationsByPage = useMemo(() => bucketAnnotationsByPage(annotations), [annotations]);

  /**
   * The annotations to paint on one page, with the mark being dragged shifted
   * to where the pointer has it. Applying the offset at paint time keeps a move
   * at display rate without rewriting the annotation list on every frame.
   */
  function pageAnnotations(pageNumber: number): ReaderAnnotation[] {
    const list = annotationsByPage.get(pageNumber) ?? EMPTY_ANNOTATIONS;
    if (!movePreview) return list;
    return list.map((ann) => {
      if (ann.id !== movePreview.id) return ann;
      const position = ann.anchor.zoteroPosition;
      if (!position?.paths?.length) return ann;
      return {
        ...ann,
        anchor: {
          ...ann.anchor,
          zoteroPosition: {
            ...position,
            paths: translateInkPaths(position.paths, movePreview.dx, movePreview.dy),
          },
        },
      };
    });
  }

  const viewport = useReaderViewport({
    initialPage: typeof page === "number" ? page + 1 : 1,
    pageSize,
    containerSize,
    numPages,
  });
  const scale = viewport.renderScale;
  const rotation = viewport.rotation;

  const safeUrl = (() => {
    if (url.startsWith("/api/pdf-proxy?")) {
      const original = originalUrlFromProxy(url);
      return original && isAllowedPdfProxyUrl(original) ? url : null;
    }
    // Bytes this app already cached and materialised — see isReaderObjectUrl.
    if (isReaderObjectUrl(url)) return url;
    return sanitizePdfUrl(url);
  })();
  const openUrl = (() => {
    const direct = sanitizePdfUrl(originalUrl);
    if (direct) return direct;
    const fromProxy = originalUrlFromProxy(url);
    if (fromProxy && isAllowedPdfProxyUrl(fromProxy)) return fromProxy;
    return sanitizePdfUrl(url);
  })();

  const cancelRenderTasks = useCallback(() => {
    for (const task of renderTasks.current.values()) {
      try {
        task.cancel();
      } catch {
        /* ignore */
      }
    }
    renderTasks.current.clear();
  }, []);

  useEffect(() => {
    const host = containerRef.current;
    if (!host || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      setContainerSize({
        width: Math.max(1, host.clientWidth),
        height: Math.max(1, host.clientHeight),
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => observer.disconnect();
  }, [pdf]);

  useEffect(() => {
    let cancelled = false;
    let task: ReturnType<PdfLib["getDocument"]> | null = null;
    renderGeneration.current += 1;
    renderedPages.current.clear();
    renderingPages.current.clear();
    // Page geometry is per-document. Keeping the previous document's items
    // would let a selection on a not-yet-rendered page build an anchor from
    // the *old* paper's text. The route remounts on url change, so this is
    // belt-and-braces — but the component must honour its own url prop.
    pageGeometries.current.clear();
    // A pending "the observer moved the page, do not scroll" flag must not
    // survive into the next document and swallow its first deliberate jump.
    suppressPageScroll.current = false;
    cancelRenderTasks();
    setError(null);
    setPdf(null);
    setNumPages(0);
    setPageSize(null);
    setPageTexts([]);
    setOutline([]);
    setJump({ status: locus ? "searching" : "idle" });

    if (!safeUrl) {
      setError("That PDF link is not allowed — only https URLs can be opened.");
      return;
    }

    void (async () => {
      try {
        const lib = await loadPdfLib();
        if (cancelled) return;
        const httpHeaders: Record<string, string> = {};
        if (safeUrl.startsWith("/api/pdf-proxy?")) {
          const accessToken = await getContainer().auth.auth.getAccessToken();
          if (!accessToken) {
            if (!cancelled) setError("Sign in to open this PDF in the reader.");
            return;
          }
          httpHeaders.Authorization = `Bearer ${accessToken}`;
        }
        task = lib.getDocument({
          url: safeUrl,
          isEvalSupported: false,
          ...(Object.keys(httpHeaders).length ? { httpHeaders, withCredentials: false } : {}),
        });
        if (cancelled) {
          try {
            task.destroy();
          } catch {
            /* ignore */
          }
          return;
        }
        const doc = await task.promise;
        if (cancelled) return;
        const first = await doc.getPage(1);
        if (cancelled) return;
        const base = first.getViewport({ scale: 1, rotation: 0 });
        setPageSize({ width: base.width, height: base.height });
        setPdf(doc);
        setNumPages(doc.numPages);

        // Extract text for search + outline (best-effort; never blocks rendering).
        void (async () => {
          try {
            const texts: DocumentPageText[] = [];
            for (let n = 1; n <= doc.numPages; n++) {
              if (cancelled) return;
              const p = await doc.getPage(n);
              const content = await p.getTextContent();
              const items = textItemsFromContent(content);
              texts.push({ pageIndex: n - 1, text: buildPageText(items).text });
            }
            if (cancelled) return;
            setPageTexts(texts);
            // Keep the text so this document stays searchable after the reader
            // closes. Piggybacks on the pass above — no extra fetch or parse.
            if (paperId) {
              const source = {
                paperId,
                title: paperTitle ?? "PDF",
                pages: texts,
                extractedAt: new Date().toISOString(),
              };
              void savePdfText(getContainer().projects.context.projectId, source);
              // Findable now rather than after a reload: the text is already in
              // hand, and a reader who searches straight after reading is the
              // common case, not the edge one.
              getContainer().search.indexPdf(source);
            }
          } catch {
            if (!cancelled) setPageTexts([]);
          }
        })();
        void (async () => {
          try {
            const raw = await doc.getOutline();
            if (cancelled) return;
            setOutline(await mapOutline(doc, raw ?? []));
          } catch {
            if (!cancelled) setOutline([]);
          }
        })();
      } catch (err) {
        if (cancelled) return;
        // A cached copy that will not open is recoverable: the screen can drop
        // it and refetch from the network. Offer that before showing an error,
        // so a bad cache entry is not a dead end.
        if (isReaderObjectUrl(safeUrl) && onSourceFailure) {
          onSourceFailure(safeUrl);
          return;
        }
        setError(err instanceof Error ? err.message : "Could not load this PDF in the app.");
      }
    })();
    return () => {
      cancelled = true;
      cancelRenderTasks();
      try {
        task?.destroy();
      } catch {
        /* ignore */
      }
    };
    // locus intentionally omitted — jump effect owns locus changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safeUrl, cancelRenderTasks]);

  const clearHighlights = useCallback(() => {
    containerRef.current?.querySelectorAll(".pdf-reader-hl").forEach((el) => el.remove());
  }, []);

  useEffect(() => {
    renderGeneration.current += 1;
    renderedPages.current.clear();
    renderingPages.current.clear();
    cancelRenderTasks();
    clearHighlights();
  }, [scale, rotation, clearHighlights, cancelRenderTasks]);

  const renderPage = useCallback(
    async (pageNumber: number) => {
      if (!pdf || renderedPages.current.has(pageNumber)) return;
      const inflight = renderingPages.current.get(pageNumber);
      if (inflight) {
        await inflight;
        if (renderedPages.current.has(pageNumber) || !pdf) return;
      }
      const generation = renderGeneration.current;
      let work!: Promise<void>;
      work = (async () => {
        try {
          const host = containerRef.current?.querySelector<HTMLDivElement>(
            `[data-page="${pageNumber}"]`,
          );
          if (!host) return;
          const pdfPage = await pdf.getPage(pageNumber);
          if (generation !== renderGeneration.current) return;
          const viewport = pdfPage.getViewport({ scale, rotation });
          const canvas = host.querySelector("canvas");
          if (!(canvas instanceof HTMLCanvasElement)) return;
          const ctx = canvas.getContext("2d");
          if (!ctx) return;
          const ratio = window.devicePixelRatio || 1;
          canvas.width = Math.floor(viewport.width * ratio);
          canvas.height = Math.floor(viewport.height * ratio);
          canvas.style.width = `${Math.floor(viewport.width)}px`;
          canvas.style.height = `${Math.floor(viewport.height)}px`;
          host.style.width = `${Math.floor(viewport.width)}px`;
          host.style.height = `${Math.floor(viewport.height)}px`;
          ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
          const renderTask = pdfPage.render({ canvasContext: ctx, viewport });
          renderTasks.current.set(pageNumber, renderTask);
          try {
            await renderTask.promise;
          } finally {
            if (renderTasks.current.get(pageNumber) === renderTask) {
              renderTasks.current.delete(pageNumber);
            }
          }
          if (generation !== renderGeneration.current) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            return;
          }
          // Text layer — selectable / copyable; input device for future annotation (R3).
          let textLayer = host.querySelector<HTMLDivElement>(".pdf-reader-textlayer");
          if (!textLayer) {
            textLayer = document.createElement("div");
            textLayer.className = "pdf-reader-textlayer";
            host.appendChild(textLayer);
          }
          textLayer.replaceChildren();
          textLayer.style.width = `${Math.floor(viewport.width)}px`;
          textLayer.style.height = `${Math.floor(viewport.height)}px`;
          const content = await pdfPage.getTextContent();
          const lib = await loadPdfLib();
          const geometryItems: import("@weaveforge/core").PageTextItem[] = [];
          let itemIndex = 0;
          for (const raw of content.items) {
            const it = raw as {
              str?: string;
              transform?: number[];
              width?: number;
              height?: number;
              hasEOL?: boolean;
            };
            if (typeof it.str !== "string" || !Array.isArray(it.transform)) continue;
            geometryItems.push({
              str: it.str,
              transform: it.transform,
              width: typeof it.width === "number" ? it.width : 0,
              height: typeof it.height === "number" ? it.height : 0,
              hasEOL: Boolean(it.hasEOL),
            });
            const tx = lib.Util.transform(viewport.transform, it.transform);
            const fontHeight = Math.hypot(tx[2]!, tx[3]!) || (it.height ?? 0) * scale;
            const width = (it.width ?? 0) * scale;
            const span = document.createElement("span");
            span.textContent = it.str;
            span.setAttribute("data-item-index", String(itemIndex));
            span.style.position = "absolute";
            span.style.whiteSpace = "pre";
            span.style.left = `${tx[4]!}px`;
            span.style.top = `${tx[5]! - fontHeight}px`;
            span.style.fontSize = `${Math.max(fontHeight, 1)}px`;
            span.style.width = `${Math.max(width, 1)}px`;
            textLayer.appendChild(span);
            itemIndex += 1;
          }
          const base = pdfPage.getViewport({ scale: 1, rotation: 0 });
          pageGeometries.current.set(pageNumber, {
            pageIndex: pageNumber - 1,
            pageWidth: base.width,
            pageHeight: base.height,
            items: geometryItems,
            // Stamp new anchors with the file they were captured against, so
            // the overlay's trust check keeps working once hashes are real.
            ...(contentHash ? { contentHash } : {}),
          });
          renderedPages.current.add(pageNumber);
        } catch {
          /* a failed / cancelled page must not break the rest of the document */
        } finally {
          if (renderingPages.current.get(pageNumber) === work) {
            renderingPages.current.delete(pageNumber);
          }
        }
      })();
      renderingPages.current.set(pageNumber, work);
      await work;
    },
    [pdf, scale, rotation, contentHash],
  );

  const matchOnPage = useCallback(
    async (pageNumber: number): Promise<AnchorConfidence | null> => {
      if (!pdf || !locus) return null;
      const pdfPage = await pdf.getPage(pageNumber);
      const content = await pdfPage.getTextContent();
      const items = textItemsFromContent(content);
      const pageText = buildPageText(items);
      const anchor = resolveTextAnchor(pageText.text, pageScopedLocus(locus));
      return anchor?.confidence ?? null;
    },
    [pdf, locus],
  );

  const highlightOnPage = useCallback(
    async (pageNumber: number): Promise<void> => {
      if (!pdf || !locus) return;
      const lib = await loadPdfLib();
      const pdfPage = await pdf.getPage(pageNumber);
      const pageViewport = pdfPage.getViewport({ scale, rotation });
      const content = await pdfPage.getTextContent();
      const items = textItemsFromContent(content);
      const pageText = buildPageText(items);
      const anchor = resolveTextAnchor(pageText.text, pageScopedLocus(locus));
      if (!anchor) return;

      const host = containerRef.current?.querySelector<HTMLDivElement>(
        `[data-page="${pageNumber}"]`,
      );
      if (!host) return;

      for (const range of pageText.items) {
        if (range.end <= anchor.start || range.start >= anchor.end) continue;
        const item = items[range.index]!;
        const tx = lib.Util.transform(pageViewport.transform, item.transform);
        const fontHeight = Math.hypot(tx[2]!, tx[3]!) || item.height * scale;
        const width = (item.width || 0) * scale;
        const left = tx[4]!;
        const top = tx[5]! - fontHeight;
        const hl = document.createElement("div");
        hl.className = "pdf-reader-hl";
        hl.style.left = `${left}px`;
        hl.style.top = `${top}px`;
        hl.style.width = `${Math.max(width, 2)}px`;
        hl.style.height = `${Math.max(fontHeight, 2)}px`;
        host.appendChild(hl);
      }
    },
    [pdf, locus, scale, rotation],
  );

  useEffect(() => {
    if (!pdf || numPages === 0) return;
    const root = containerRef.current;
    if (!root) return;
    const ratios = new Map<number, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const n = Number((entry.target as HTMLElement).dataset.page);
          if (!n) continue;
          if (entry.isIntersecting) void renderPage(n);
          ratios.set(n, entry.intersectionRatio);
        }
        let bestPage = 0;
        let bestRatio = 0;
        for (const [n, ratio] of ratios) {
          if (ratio > bestRatio) {
            bestRatio = ratio;
            bestPage = n;
          }
        }
        if (bestPage > 0 && bestRatio >= 0.35 && bestPage !== viewport.page) {
          suppressPageScroll.current = true;
          viewport.setPage(bestPage);
        }
      },
      { root, rootMargin: "600px 0px", threshold: [0, 0.25, 0.35, 0.5, 0.75, 1] },
    );
    root.querySelectorAll("[data-page]").forEach((el) => observer.observe(el));
    return () => observer.disconnect();
    // viewport.page / setPage intentionally used inside; omit viewport object
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdf, numPages, renderPage, viewport.page, viewport.setPage]);

  // Scroll when the toolbar / keyboard changes the current page.
  useEffect(() => {
    if (!pdf || numPages === 0) return;
    if (suppressPageScroll.current) {
      suppressPageScroll.current = false;
      void renderPage(viewport.page);
      return;
    }
    const host = containerRef.current?.querySelector<HTMLElement>(
      `[data-page="${viewport.page}"]`,
    );
    host?.scrollIntoView({ behavior: "smooth", block: "start" });
    void renderPage(viewport.page);
  }, [viewport.page, pdf, numPages, renderPage]);

  useEffect(() => {
    if (!pdf || !locus) {
      clearHighlights();
      setJump({ status: "idle" });
      return;
    }
    let cancelled = false;
    clearHighlights();
    setJump({ status: "searching" });
    void (async () => {
      let firstMatch: { pageNumber: number; confidence: AnchorConfidence } | null = null;
      try {
        const order: number[] = [];
        const hinted = typeof page === "number" ? page + 1 : undefined;
        const hintedOk = hinted != null && hinted >= 1 && hinted <= pdf.numPages;
        if (hintedOk) order.push(hinted!);
        for (let n = 1; n <= pdf.numPages; n++) if (n !== hinted) order.push(n);

        let extraMatches = 0;
        let painted = false;

        const paintMatch = async (
          match: { pageNumber: number; confidence: AnchorConfidence },
          confidence: AnchorConfidence,
        ) => {
          await renderPage(match.pageNumber);
          if (cancelled) return;
          clearHighlights();
          await highlightOnPage(match.pageNumber);
          if (cancelled) {
            clearHighlights();
            return;
          }
          const host = containerRef.current?.querySelector<HTMLElement>(
            `[data-page="${match.pageNumber}"]`,
          );
          host?.scrollIntoView({ behavior: "smooth", block: "center" });
          viewport.setPage(match.pageNumber);
          setJump({
            status: confidence === "high" ? "found" : "low",
            pageNumber: match.pageNumber,
            confidence,
          });
        };

        for (const pageNumber of order) {
          if (cancelled) return;
          let confidence: AnchorConfidence | null = null;
          try {
            confidence = await matchOnPage(pageNumber);
          } catch {
            continue;
          }
          if (!confidence) continue;
          if (!firstMatch) {
            firstMatch = { pageNumber, confidence };
            await paintMatch(firstMatch, confidence);
            painted = true;
            continue;
          }
          extraMatches += 1;
          break;
        }

        if (cancelled) return;
        if (!firstMatch) {
          setJump({ status: "missed" });
          return;
        }

        const finalConfidence: AnchorConfidence =
          extraMatches > 0 || firstMatch.confidence === "low" ? "low" : firstMatch.confidence;

        if (!painted || finalConfidence !== firstMatch.confidence || extraMatches > 0) {
          await paintMatch(firstMatch, finalConfidence);
        }
      } catch {
        if (!cancelled && !firstMatch) setJump({ status: "missed" });
      }
    })();
    return () => {
      cancelled = true;
      clearHighlights();
    };
    // viewport.setPage is stable enough; omit viewport object to avoid re-jumps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdf, locus, page, matchOnPage, highlightOnPage, renderPage, clearHighlights]);

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    // Delete the selected annotation from the page itself. Deleting was only
    // reachable by finding the same annotation again in the sidebar list.
    if (
      (event.key === "Delete" || event.key === "Backspace") &&
      selectedAnnId &&
      canCreate &&
      !isEditableTarget(event.target)
    ) {
      const selected = annotations.find((a) => a.id === selectedAnnId);
      if (selected?.origin === "local") {
        event.preventDefault();
        void removeLocal(selectedAnnId);
        return;
      }
    }
    const command = readerKeyboardCommand({
      key: event.key,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      altKey: event.altKey,
      fromEditable: isEditableTarget(event.target),
    });
    if (!command) return;
    event.preventDefault();
    switch (command.type) {
      case "zoom_in":
        viewport.zoomIn();
        break;
      case "zoom_out":
        viewport.zoomOut();
        break;
      case "fit_width":
        viewport.fitWidth();
        break;
      case "rotate":
        viewport.rotateClockwise();
        break;
      case "page_home":
        viewport.setPage(1);
        break;
      case "page_end":
        viewport.setPage(numPages);
        break;
      case "page_delta":
        viewport.setPage(viewport.page + command.delta);
        break;
    }
  }

  useEffect(() => {
    if (!paperId) {
      setReportSections([]);
      setPinsByKey(new Map());
      setPinsList([]);
      setVaultBacklinkPages([]);
      setBacklinkHits([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const [sections, pins, vaultPages] = await Promise.all([
          getContainer().papers.listReportSections(),
          getContainer().papers.listAnnotationPinsForPaper(paperId),
          getContainer().vault.listPages().catch(() => []),
        ]);
        if (cancelled) return;
        setReportSections(
          sections.map((s) => ({ id: s.id, title: s.title || "Untitled section" })),
        );
        setPinsByKey(new Map(pins.map((p) => [p.annotationKey, p.reportSectionId])));
        setPinsList(
          pins.map((p) => ({
            annotationKey: p.annotationKey,
            reportSectionId: p.reportSectionId,
            paperId: p.paperId,
          })),
        );
        setVaultBacklinkPages(
          vaultPages.map((p) => ({
            id: p.id,
            title: p.title || "Untitled note",
            body: p.body ?? "",
          })),
        );
      } catch {
        if (!cancelled) {
          setReportSections([]);
          setPinsByKey(new Map());
          setPinsList([]);
          setVaultBacklinkPages([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [paperId]);

  useEffect(() => {
    if (!paperId) {
      setBacklinkHits([]);
      return;
    }
    setBacklinkHits(
      findAnnotationBacklinks({
        annotations,
        pins: pinsList,
        sections: reportSections,
        vaultPages: vaultBacklinkPages,
      }),
    );
  }, [paperId, annotations, pinsList, reportSections, vaultBacklinkPages]);

  useEffect(() => {
    const readTheme = () => {
      const root = document.documentElement;
      const theme = root.getAttribute("data-theme");
      const mode = root.getAttribute("data-mode");
      setDarkPdf(mode === "dark" || shouldUseDarkPdfRendering(theme, mode));
    };
    readTheme();
    const observer = new MutationObserver(readTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "data-mode"],
    });
    return () => observer.disconnect();
  }, []);

  /** The projection for one rendered page: its size, the zoom, and the rotation. */
  function pageProjection(pageNumber: number): PageProjection {
    const geometry = pageGeometries.current.get(pageNumber);
    return {
      pageWidth: geometry?.pageWidth ?? pageSize?.width ?? 0,
      pageHeight: geometry?.pageHeight ?? pageSize?.height ?? 0,
      scale,
      rotation,
    };
  }

  function screenToPdf(pageHost: HTMLElement, clientX: number, clientY: number) {
    const rect = pageHost.getBoundingClientRect();
    const pageNumber = Number(pageHost.dataset.page);
    // Rotation is part of the mapping, not a reason to refuse to draw: the
    // create tools used to switch off entirely at 90/180/270, which is exactly
    // the orientation a scanned landscape page is read in.
    return screenPointToPdf(clientX - rect.left, clientY - rect.top, pageProjection(pageNumber));
  }

  /**
   * Whether this pointer is allowed to draw. See `sawPen` — a palm resting on a
   * tablet arrives as a `touch` pointer and would otherwise scribble.
   */
  function pointerMayDraw(event: React.PointerEvent): boolean {
    if (event.pointerType === "pen") {
      if (!sawPen.current) {
        sawPen.current = true;
        setPenSeen(true);
      }
      return true;
    }
    if (event.pointerType === "touch") return !sawPen.current;
    return true;
  }

  /**
   * Ink annotations on this page whose stroke passes within `radius` of a point.
   *
   * Reads the page's bucket rather than the whole document: the eraser runs this
   * on every pointer move, and scanning every annotation in a heavily marked-up
   * paper to find the handful on the page under the pen is work for nothing.
   */
  function inkAnnotationsAt(pageNumber: number, x: number, y: number, radius: number) {
    const onPage = annotationsByPage.get(pageNumber) ?? EMPTY_ANNOTATIONS;
    return onPage.filter((ann) => {
      if (ann.type !== "ink") return false;
      const position = ann.anchor.zoteroPosition;
      if (!position?.paths?.length || position.pageIndex !== pageNumber - 1) return false;
      const nib = typeof position.width === "number" ? position.width : INK_DEFAULT_WIDTH;
      return inkPathsHitTest(position.paths, x, y, radius + nib / 2);
    });
  }

  function onSelectionMouseUp() {
    if (!canCreate || createTool !== "select") return;
    // A drag that moved an ink mark is not a text selection.
    if (inkMove.current) return;
    const root = containerRef.current;
    if (!root) return;
    const sel = window.getSelection();
    const pageNumber = pageNumberFromSelection(sel, root);
    if (!pageNumber) {
      setPendingCreate(null);
      return;
    }
    const layer = root.querySelector(`[data-page="${pageNumber}"] .pdf-reader-textlayer`);
    if (!layer) {
      setPendingCreate(null);
      return;
    }
    const range = selectionRangeFromDom(sel, layer);
    const geometry = pageGeometries.current.get(pageNumber);
    if (!range || !geometry) {
      setPendingCreate(null);
      return;
    }
    const draft = draftFromTextSelection({
      type: "highlight",
      color: createColor,
      selection: range,
      page: geometry,
    });
    if (!draft) {
      setPendingCreate(null);
      return;
    }
    setPendingCreate({
      pageNumber,
      quote: draft.text ?? "",
      selection: range,
    });
  }

  /** Returns the persisted annotation, or null when the write failed. */
  async function persistDraft(
    draft: import("@weaveforge/core").NewReaderAnnotation,
  ): Promise<ReaderAnnotation | null> {
    if (!paperId || !onAnnotationsChange) return null;

    // Paint first, persist second. The write is a network round-trip, and
    // waiting for it meant the highlight appeared hundreds of milliseconds
    // after the click — long enough to read as a dead button.
    const tempId = `${PENDING_ANNOTATION_PREFIX}${
      globalThis.crypto?.randomUUID?.() ?? String(Date.now())
    }`;
    const optimistic = optimisticAnnotationFromDraft(draft, tempId);
    onAnnotationsChange((prev) => [...prev, optimistic]);
    setSelectedAnnId(tempId);
    setPendingCreate(null);
    setAnnError(null);
    window.getSelection()?.removeAllRanges();

    setCreateBusy(true);
    try {
      const created = await getContainer().papers.createReaderAnnotation(paperId, draft);
      onAnnotationsChange((prev) => prev.map((a) => (a.id === tempId ? created : a)));
      setSelectedAnnId((prev) => (prev === tempId ? created.id : prev));
      onActivity?.("annotate", `Created ${created.type}`);
      return created;
    } catch (err) {
      // Roll the optimistic one back — leaving it would show a highlight that
      // vanishes on the next reload with no explanation.
      onAnnotationsChange((prev) => prev.filter((a) => a.id !== tempId));
      setSelectedAnnId((prev) => (prev === tempId ? null : prev));
      setAnnError(err instanceof Error ? err.message : "Could not save the annotation.");
      return null;
    } finally {
      setCreateBusy(false);
    }
  }

  async function createFromPending(
    type: Extract<ReaderAnnotationType, "highlight" | "underline" | "note">,
    color: string,
  ) {
    if (!pendingCreate) return;
    const geometry = pageGeometries.current.get(pendingCreate.pageNumber);
    if (!geometry) return;
    // A sticky note needs its text first. Collect it in the app rather than an
    // OS prompt, then finish through the same path.
    if (type === "note") {
      setPendingNote({ color });
      return;
    }
    const draft = draftFromTextSelection({
      type,
      color,
      selection: pendingCreate.selection,
      page: geometry,
      comment: "",
    });
    if (!draft) return;
    await persistDraft(draft);
  }

  async function createNoteWithComment(color: string, comment: string) {
    if (!pendingCreate) return;
    const geometry = pageGeometries.current.get(pendingCreate.pageNumber);
    if (!geometry) return;
    const draft = draftFromTextSelection({
      type: "note",
      color,
      selection: pendingCreate.selection,
      page: geometry,
      comment,
    });
    if (!draft) return;
    await persistDraft(draft);
  }

  async function updateLocal(
    id: string,
    patch: { comment?: string; tags?: string[]; color?: string },
  ) {
    if (!onAnnotationsChange) return;
    // A colour change repaints the highlight, so waiting for the write shows a
    // swatch that stays wrong until the network answers. Apply, then reconcile.
    let previous: ReaderAnnotation | undefined;
    onAnnotationsChange((prev) =>
      prev.map((a) => {
        if (a.id !== id) return a;
        previous = a;
        return applyAnnotationPatch(a, patch);
      }),
    );
    setAnnError(null);
    try {
      const updated = await getContainer().papers.updateReaderAnnotation(id, patch);
      onAnnotationsChange((prev) => prev.map((a) => (a.id === id ? updated : a)));
      onActivity?.("annotate", "Updated annotation");
    } catch (err) {
      if (previous) {
        const restore = previous;
        onAnnotationsChange((prev) => prev.map((a) => (a.id === id ? restore : a)));
      }
      setAnnError(err instanceof Error ? err.message : "Could not update the annotation.");
    }
  }

  async function removeLocal(id: string, options?: { confirm?: boolean }) {
    if (!onAnnotationsChange) return;
    // The eraser asks for no confirmation: a dialog per stroke would make
    // rubbing out a word unusable, and the gesture is already deliberate.
    if (options?.confirm !== false && !window.confirm("Delete this local annotation?")) return;
    // Remove on screen straight away, restore if the delete fails — the same
    // round-trip that delayed creation left a deleted highlight sitting there.
    let removed: ReaderAnnotation | undefined;
    onAnnotationsChange((prev) => {
      removed = prev.find((a) => a.id === id);
      return prev.filter((a) => a.id !== id);
    });
    if (selectedAnnId === id) setSelectedAnnId(null);
    setAnnError(null);
    try {
      await getContainer().papers.removeReaderAnnotation(id);
      onActivity?.("annotate", "Deleted annotation");
    } catch (err) {
      if (removed) {
        const restore = removed;
        onAnnotationsChange((prev) =>
          prev.some((a) => a.id === restore.id) ? prev : [...prev, restore],
        );
      }
      setAnnError(err instanceof Error ? err.message : "Could not delete the annotation.");
    }
  }

  async function pinLocal(ann: ReaderAnnotation, sectionId: string | null) {
    if (!paperId) return;
    const key = annotationPinKey(ann);
    try {
      await getContainer().papers.setAnnotationPin(paperId, key, sectionId);
      setPinsByKey((prev) => {
        const next = new Map(prev);
        if (sectionId) next.set(key, sectionId);
        else next.delete(key);
        return next;
      });
      setPinsList((prev) => {
        const without = prev.filter((p) => p.annotationKey !== key);
        if (!sectionId) return without;
        return [...without, { annotationKey: key, reportSectionId: sectionId, paperId }];
      });
      setAnnError(null);
    } catch (err) {
      setAnnError(err instanceof Error ? err.message : "Could not pin the annotation.");
    }
  }

  /** Delete every ink mark the eraser is touching, once per drag. */
  function eraseAt(pageNumber: number, x: number, y: number) {
    for (const ann of inkAnnotationsAt(pageNumber, x, y, ERASER_RADIUS)) {
      if (ann.origin !== "local") continue;
      if (erasedIds.current.has(ann.id)) continue;
      erasedIds.current.add(ann.id);
      // A stroke being erased must not also be the group the next stroke joins.
      if (inkGroup.current?.annotationId === ann.id) inkGroup.current = null;
      void removeLocal(ann.id, { confirm: false });
    }
  }

  /**
   * Save a finished stroke, joining the mark in progress when there is one.
   *
   * See `canJoinInkGroup`: strokes drawn in one breath, same nib, same colour,
   * same page are one annotation. That is what stops a handwritten sentence
   * becoming twenty rows in the table and twenty entries in the sidebar.
   */
  async function persistInkStroke(input: {
    pageNumber: number;
    pageHeight: number;
    path: number[];
    width: number;
  }) {
    const pageIndex = input.pageNumber - 1;
    const now = Date.now();
    const group = inkGroup.current;

    if (
      canJoinInkGroup(group, { pageIndex, color: createColor, width: input.width, at: now }) &&
      group
    ) {
      const existing = annotations.find((a) => a.id === group.annotationId);
      const merged = existing ? appendInkStroke(existing.anchor, input.path) : null;
      if (existing && merged) {
        inkGroup.current = {
          ...group,
          pathCount: merged.zoteroPosition?.paths?.length ?? group.pathCount + 1,
          lastAt: now,
        };
        await saveAnchor(existing, merged);
        return;
      }
      // The group's row is gone (erased, or still being created) — fall through
      // and start a fresh mark rather than dropping the stroke.
      inkGroup.current = null;
    }

    const draft = draftInkAnnotation({
      color: createColor,
      pageIndex,
      pageHeight: input.pageHeight,
      path: input.path,
      width: input.width,
    });
    if (!draft) return;
    const created = await persistDraft(draft);
    if (created) {
      inkGroup.current = {
        annotationId: created.id,
        pageIndex,
        color: createColor,
        width: input.width,
        pathCount: created.anchor.zoteroPosition?.paths?.length ?? 1,
        lastAt: Date.now(),
      };
    }
  }

  /** Persist a new anchor for an existing annotation, painting it immediately. */
  async function saveAnchor(ann: ReaderAnnotation, anchor: ReaderAnnotation["anchor"]) {
    if (!onAnnotationsChange) return;
    const previous = ann.anchor;
    onAnnotationsChange((prev) => prev.map((a) => (a.id === ann.id ? { ...a, anchor } : a)));
    setAnnError(null);
    try {
      const updated = await getContainer().papers.updateReaderAnnotation(ann.id, { anchor });
      onAnnotationsChange((prev) => prev.map((a) => (a.id === ann.id ? updated : a)));
    } catch (err) {
      onAnnotationsChange((prev) =>
        prev.map((a) => (a.id === ann.id ? { ...a, anchor: previous } : a)),
      );
      setAnnError(err instanceof Error ? err.message : "Could not move the annotation.");
    }
  }

  /** Write a finished move to the annotation's stored paths. */
  async function commitInkMove(move: InkMove) {
    if (Math.hypot(move.dx, move.dy) < INK_MOVE_THRESHOLD) return;
    const ann = annotations.find((a) => a.id === move.annotationId);
    const position = ann?.anchor.zoteroPosition;
    if (!ann || !position?.paths?.length) return;
    // A moved mark is no longer where the group left off; the next stroke is a
    // new mark rather than a jump back to the old position.
    if (inkGroup.current?.annotationId === ann.id) inkGroup.current = null;
    await saveAnchor(ann, {
      ...ann.anchor,
      zoteroPosition: {
        ...position,
        paths: translateInkPaths(position.paths, move.dx, move.dy),
      },
    });
  }

  /** Nib width for a fresh stroke: the tool's base, scaled by pen pressure. */
  function inkWidthForEvent(event: React.PointerEvent): number {
    const base = createTool === "highlighter" ? HIGHLIGHTER_WIDTH : INK_DEFAULT_WIDTH;
    return inkWidthForPressure(event.pressure, base);
  }

  function onPagePointerDown(pageNumber: number, event: React.PointerEvent<HTMLDivElement>) {
    if (!canCreate || !pageSize) return;
    const host = event.currentTarget;
    const pt = screenToPdf(host, event.clientX, event.clientY);

    // The select tool doubles as the move tool: pressing inside a selected ink
    // mark picks it up. Ink was previously fixed where it landed, so a stroke
    // drawn in the wrong place could only be deleted and redrawn.
    if (createTool === "select") {
      if (!selectedAnnId) return;
      const hit = inkAnnotationsAt(pageNumber, pt.x, pt.y, ERASER_RADIUS).some(
        (ann) => ann.id === selectedAnnId,
      );
      if (!hit) return;
      event.preventDefault();
      inkMove.current = {
        annotationId: selectedAnnId,
        pointerId: event.pointerId,
        pageNumber,
        fromX: pt.x,
        fromY: pt.y,
        dx: 0,
        dy: 0,
      };
      host.setPointerCapture(event.pointerId);
      return;
    }

    if (!pointerMayDraw(event)) return;
    event.preventDefault();

    if (createTool === "erase") {
      erasedIds.current = new Set();
      host.setPointerCapture(event.pointerId);
      eraseAt(pageNumber, pt.x, pt.y);
      return;
    }

    if (isInkTool(createTool)) {
      // One contact owns the stroke. Without this a palm landing mid-stroke on
      // a pen-less tablet would splice its own path into the same line.
      if (inkPointerId.current != null) return;
      inkPointerId.current = event.pointerId;
      inkPath.current = [pt.x, pt.y];
      inkPressures.current = [event.pressure];
      scheduleDraft({
        kind: "ink",
        pageNumber,
        path: [pt.x, pt.y],
        width: inkWidthForEvent(event),
        highlighter: createTool === "highlighter",
      });
      host.setPointerCapture(event.pointerId);
      return;
    }
    // Both tools drag out a region. Text used to place a fixed 120x24 box
    // wherever you clicked, with no way to say how big it should be.
    if (createTool === "image" || createTool === "text") {
      dragRect.current = {
        pageNumber,
        x0: pt.x,
        y0: pt.y,
        x1: pt.x,
        y1: pt.y,
      };
      scheduleDraft({ kind: "rect", pageNumber, x0: pt.x, y0: pt.y, x1: pt.x, y1: pt.y });
      host.setPointerCapture(event.pointerId);
    }
  }

  function onPagePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!canCreate) return;
    const host = event.currentTarget;
    const pageNumber = Number(host.dataset.page);
    const pt = screenToPdf(host, event.clientX, event.clientY);

    const move = inkMove.current;
    if (move && move.pointerId === event.pointerId) {
      move.dx = pt.x - move.fromX;
      move.dy = pt.y - move.fromY;
      scheduleMove({ id: move.annotationId, dx: move.dx, dy: move.dy });
      return;
    }

    if (createTool === "erase" && event.buttons !== 0) {
      eraseAt(pageNumber, pt.x, pt.y);
      return;
    }

    if (
      isInkTool(createTool) &&
      inkPointerId.current === event.pointerId &&
      inkPath.current.length >= 2
    ) {
      // Samples inside the pen's own jitter carry no shape and would be stored
      // forever; dropping them here also keeps the live preview cheap.
      if (!shouldAppendInkPoint(inkPath.current, pt.x, pt.y)) return;
      inkPath.current.push(pt.x, pt.y);
      inkPressures.current.push(event.pressure);
      scheduleDraft({
        kind: "ink",
        pageNumber,
        path: [...inkPath.current],
        width: inkWidthForEvent(event),
        highlighter: createTool === "highlighter",
      });
      return;
    }
    if ((createTool === "image" || createTool === "text") && dragRect.current) {
      dragRect.current.x1 = pt.x;
      dragRect.current.y1 = pt.y;
      scheduleDraft({ kind: "rect", ...dragRect.current });
    }
  }

  function onPagePointerUp(pageNumber: number, event: React.PointerEvent<HTMLDivElement>) {
    if (!canCreate || !pageSize) return;

    const move = inkMove.current;
    if (move && move.pointerId === event.pointerId) {
      inkMove.current = null;
      scheduleMove(null);
      void commitInkMove(move);
      return;
    }

    if (createTool === "erase") {
      erasedIds.current = new Set();
      return;
    }

    // The persisted annotation takes over from here; drop the live preview so
    // the two cannot both be painted for a frame.
    clearDraft();
    if (isInkTool(createTool) && inkPointerId.current === event.pointerId) {
      const path = [...inkPath.current];
      const pressures = [...inkPressures.current];
      inkPath.current = [];
      inkPressures.current = [];
      inkPointerId.current = null;
      if (path.length >= 4) {
        const pageHeight =
          pageGeometries.current.get(pageNumber)?.pageHeight ?? pageSize.height;
        void persistInkStroke({
          pageNumber,
          pageHeight,
          path,
          width: inkWidthForPressure(
            meanPressure(pressures),
            createTool === "highlighter" ? HIGHLIGHTER_WIDTH : INK_DEFAULT_WIDTH,
          ),
        });
      }
      return;
    }
    inkPath.current = [];
    inkPressures.current = [];
    inkPointerId.current = null;
    if (createTool === "text" && dragRect.current) {
      const d = dragRect.current;
      dragRect.current = null;
      if (d.pageNumber !== pageNumber) return;
      const pageHeight =
        pageGeometries.current.get(pageNumber)?.pageHeight ?? pageSize.height;
      const width = Math.abs(d.x1 - d.x0);
      const height = Math.abs(d.y1 - d.y0);
      // Hand off to the in-app composer rather than window.prompt, which is an
      // unstyled OS dialog and on mobile hides the page you are annotating.
      setPendingTextBox({
        pageIndex: pageNumber - 1,
        pageHeight,
        x: Math.min(d.x0, d.x1),
        y: Math.min(d.y0, d.y1),
        // A tap rather than a drag still works: fall back to the default box
        // size rather than creating something zero-sized and invisible.
        ...(width >= MIN_TEXT_BOX_PDF_SIZE && height >= MIN_TEXT_BOX_PDF_SIZE
          ? { width, height }
          : {}),
      });
      return;
    }
    if (createTool === "image" && dragRect.current) {
      const d = dragRect.current;
      dragRect.current = null;
      if (d.pageNumber !== pageNumber) return;
      const pageHeight =
        pageGeometries.current.get(pageNumber)?.pageHeight ?? pageSize.height;
      const draft = draftImageRegion({
        color: createColor,
        pageIndex: pageNumber - 1,
        pageHeight,
        rect: [
          Math.min(d.x0, d.x1),
          Math.min(d.y0, d.y1),
          Math.max(d.x0, d.x1),
          Math.max(d.y0, d.y1),
        ],
      });
      if (draft) void persistDraft(draft);
    }
    void event;
  }

  if (error) {
    return (
      <div className="pdf-reader-error card">
        <p>{error}</p>
        {openUrl && <SafeExternalLink href={openUrl}>Open the original PDF</SafeExternalLink>}
      </div>
    );
  }

  return (
    <div
      className={`pdf-reader${darkPdf ? " pdf-reader--dark" : ""}`}
      ref={rootRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      aria-label="PDF reader"
      style={
        {
          // Tint the live text selection with the colour the highlight will
          // actually be, so dragging over text previews the result instead of
          // showing the browser's default blue until you confirm.
          ["--reader-select-color" as string]: createColor,
          ...(darkPdf ? { ["--pdf-dark-filter" as string]: darkPdfCanvasFilter() } : {}),
        } as CSSProperties
      }
    >
      {locus && jump.status !== "idle" && (
        <div className={`pdf-reader-banner pdf-reader-banner--${jump.status}`} role="status">
          {jump.status === "searching" && "Locating the cited passage…"}
          {jump.status === "found" && `Jumped to the cited passage (page ${jump.pageNumber}).`}
          {jump.status === "low" &&
            `Best match on page ${jump.pageNumber} — the source may have changed, so verify the highlight.`}
          {jump.status === "missed" && (
            <>
              Could not locate the exact passage.{" "}
              {openUrl && <SafeExternalLink href={openUrl}>Open the original PDF</SafeExternalLink>}
              .
            </>
          )}
        </div>
      )}
      {/* One panel, two rows: viewport controls above, find/view/annotate below.
          Two free-floating wrapping bars read as scattered chrome. */}
      <div className="pdf-reader-chrome">
        <ReaderToolbar viewport={viewport} numPages={numPages} />
        <div className="pdf-reader-tools">
        <ReaderSearchBar
          pages={pageTexts}
          onJump={(match) => {
            viewport.setPage(match.pageIndex + 1);
          }}
        />
        <div className="pdf-reader-group">
          <button
            type="button"
            className={`btn-secondary btn-sm${showOutline ? " is-active" : ""}`}
            aria-pressed={showOutline}
            onClick={() => setShowOutline((v) => !v)}
          >
            Outline
          </button>
          <button
            type="button"
            className={`btn-secondary btn-sm${spread ? " is-active" : ""}`}
            aria-pressed={spread}
            onClick={() => setSpread((v) => !v)}
          >
            Two-page
          </button>
        </div>
        {canCreate && (
          <div className="pdf-reader-group">
            <Select
              className="pdf-reader-tool-select"
              aria-label="Annotation tool"
              value={createTool}
              onChange={(e) => {
                // Switching tool ends the mark in progress, so the next stroke
                // never merges into one drawn with a different nib.
                inkGroup.current = null;
                setCreateTool(e.target.value as ReaderCreateTool);
              }}
            >
              {/* Named by what each does, not by what it is. "Image region"
                  and "Text box" both drag out a rectangle, so the old labels
                  gave no way to tell them apart. */}
              <option value="select">Highlight text</option>
              <option value="ink">Draw freehand</option>
              <option value="highlighter">Highlighter pen</option>
              <option value="erase">Erase ink</option>
              <option value="image">Clip a region</option>
              <option value="text">Write a note</option>
            </Select>
            <input
              type="color"
              className="pdf-reader-color-input"
              aria-label="Annotation colour"
              value={createColor}
              onChange={(e) => {
                inkGroup.current = null;
                setCreateColor(e.target.value);
              }}
            />
          </div>
        )}
        </div>
      </div>
      {/* Both rectangle tools look identical while dragging, so say which one
          is armed and what releasing will do. */}
      {canCreate && CREATE_TOOL_HINTS[createTool] && (
        <p className="pdf-reader-tool-hint muted">{CREATE_TOOL_HINTS[createTool]}</p>
      )}
      {annError && (
        <div className="pdf-reader-banner pdf-reader-banner--low" role="alert">
          {annError}{" "}
          <button type="button" className="link-btn" onClick={() => setAnnError(null)}>
            Dismiss
          </button>
        </div>
      )}
      {pendingCreate && canCreate && (
        <SelectionCreateBar
          pending={pendingCreate}
          busy={createBusy}
          color={createColor}
          onCreate={(type, color) => {
            setCreateColor(color);
            void createFromPending(type, color);
          }}
          onCancel={() => setPendingCreate(null)}
        />
      )}
      <div
        className={`pdf-reader-body${
          showOutline || annotations.length > 0 || canCreate ? " pdf-reader-body--outline" : ""
        }`}
      >
        {(showOutline || annotations.length > 0 || canCreate) && (
          <div className="pdf-reader-side">
            {showOutline && (
              <ReaderOutline items={outline} onNavigate={(n) => viewport.setPage(n)} />
            )}
            {(annotations.length > 0 || canCreate) && (
              <AnnotationSidebar
                annotations={annotations}
                quotationTypes={quotationTypes}
                paperTitle={paperTitle}
                selectedId={selectedAnnId}
                canEditLocal={canCreate}
                reportSections={reportSections}
                pinsByKey={pinsByKey}
                backlinks={
                  selectedAnnId ? backlinksForAnnotation(backlinkHits, selectedAnnId) : []
                }
                onUpdateLocal={updateLocal}
                onRemoveLocal={removeLocal}
                onPinLocal={pinLocal}
                onSelect={(id) => {
                  setSelectedAnnId(id);
                  const ann = annotations.find((a) => a.id === id);
                  const pageIdx = ann?.anchor.zoteroPosition?.pageIndex;
                  if (typeof pageIdx === "number") viewport.setPage(pageIdx + 1);
                }}
              />
            )}
          </div>
        )}
        <div
          className={`pdf-reader-scroll${spread ? " pdf-reader-scroll--spread" : ""}`}
          ref={containerRef}
          onMouseUp={onSelectionMouseUp}
        >
          {!pdf && <div className="pdf-reader-loading">Loading PDF…</div>}
          {Array.from({ length: numPages }, (_, i) => i + 1).map((n) => (
            <div
              className={`pdf-reader-page${
                createTool !== "select" && canCreate ? " pdf-reader-page--draw" : ""
              }${createTool === "erase" && canCreate ? " pdf-reader-page--erase" : ""}${
                penSeen ? " pdf-reader-page--pen" : ""
              }`}
              data-page={n}
              key={n}
              onPointerDown={(e) => onPagePointerDown(n, e)}
              onPointerMove={onPagePointerMove}
              onPointerUp={(e) => onPagePointerUp(n, e)}
              onPointerCancel={(e) => onPagePointerUp(n, e)}
            >
              <canvas />
              {pageSize && (
                <AnnotationOverlay
                  annotations={pageAnnotations(n)}
                  contentHash={contentHash}
                  pageNumber={n}
                  scale={scale}
                  rotation={rotation}
                  pageHeight={pageGeometries.current.get(n)?.pageHeight ?? pageSize.height}
                  pageWidth={pageGeometries.current.get(n)?.pageWidth ?? pageSize.width}
                  selectedId={selectedAnnId}
                  onSelect={selectAnnotation}
                />
              )}
              {pageSize && draftShape?.pageNumber === n && (
                <DraftShapeOverlay
                  shape={draftShape}
                  color={createColor}
                  projection={pageProjection(n)}
                />
              )}
            </div>
          ))}
        </div>
      </div>
      {pendingNote && (
        <TextBoxComposer
          title="Sticky note"
          label="Comment"
          submitLabel="Add note"
          placeholder="What do you want to remember about this passage?"
          onCancel={() => setPendingNote(null)}
          onSubmit={(comment) => {
            const { color } = pendingNote;
            setPendingNote(null);
            void createNoteWithComment(color, comment);
          }}
        />
      )}
      {pendingTextBox && (
        <TextBoxComposer
          title="Text annotation"
          label="Note"
          submitLabel="Add note"
          placeholder="What does this part of the page say?"
          onCancel={() => setPendingTextBox(null)}
          onSubmit={(text) => {
            const { pageIndex, pageHeight, x, y, width, height } = pendingTextBox;
            setPendingTextBox(null);
            void persistDraft(
              draftTextBox({
                color: createColor,
                pageIndex,
                pageHeight,
                text,
                x,
                y,
                ...(width != null && height != null ? { width, height } : {}),
              }),
            );
          }}
        />
      )}
    </div>
  );
}

/**
 * Paints the mark currently under the pointer.
 *
 * Uses the same projection as the persisted overlay — `x * scale` and
 * `(pageHeight - y) * scale` — so the preview sits exactly where the saved
 * annotation lands, with no jump on release.
 */
function DraftShapeOverlay({
  shape,
  color,
  projection,
}: {
  shape: DraftShape;
  color: string;
  projection: PageProjection;
}) {
  const toScreen = (x: number, y: number) => {
    const point = pdfPointToScreen(x, y, projection);
    return `${point.x},${point.y}`;
  };

  return (
    <div className="pdf-reader-ann-layer" aria-hidden>
      <svg className="pdf-reader-ann-svg" width="100%" height="100%">
        {shape.kind === "ink" ? (
          <polyline
            className={
              shape.highlighter
                ? "pdf-reader-ink pdf-reader-ink--highlighter"
                : "pdf-reader-ink"
            }
            points={Array.from({ length: Math.floor(shape.path.length / 2) }, (_, i) =>
              toScreen(shape.path[i * 2]!, shape.path[i * 2 + 1]!),
            ).join(" ")}
            fill="none"
            stroke={color}
            // Same nib the saved stroke will have, so nothing changes thickness
            // on release.
            strokeWidth={Math.max(shape.width * projection.scale, 0.5)}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : (
          (() => {
            const box = pdfRectToScreenBox(
              [
                Math.min(shape.x0, shape.x1),
                Math.min(shape.y0, shape.y1),
                Math.max(shape.x0, shape.x1),
                Math.max(shape.y0, shape.y1),
              ],
              projection,
            );
            return (
              <rect
                x={box.left}
                y={box.top}
                width={box.width}
                height={box.height}
                fill="none"
                stroke={color}
                strokeWidth={1.5}
                strokeDasharray="4 3"
              />
            );
          })()
        )}
      </svg>
    </div>
  );
}

/**
 * In-app composer for a text annotation's contents.
 *
 * Replaces `window.prompt`, which is an unstyled OS dialog that ignores the
 * app's theme and, on a phone, covers the page being annotated.
 */
function TextBoxComposer({
  title,
  label,
  submitLabel,
  placeholder,
  onSubmit,
  onCancel,
}: {
  title: string;
  label: string;
  submitLabel: string;
  placeholder: string;
  onSubmit: (text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState("");
  const trimmed = text.trim();

  return (
    <Modal title={title} onClose={onCancel}>
      <div className="form-stack">
        <label className="field">
          {label}
          <textarea
            rows={4}
            value={text}
            autoFocus
            placeholder={placeholder}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
        <div className="screen-actions">
          <button
            type="button"
            className="btn-primary"
            disabled={!trimmed}
            onClick={() => onSubmit(trimmed)}
          >
            {submitLabel}
          </button>
          <button type="button" className="btn-secondary" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  );
}
