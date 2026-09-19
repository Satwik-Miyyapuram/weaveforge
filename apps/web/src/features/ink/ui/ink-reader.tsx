"use client";

/**
 * InkReader: dedicated Read mode viewer for ink notes.
 *
 * Renders all note pages continuously in a crisp, non-interactive reading
 * surface: vector SVG strokes, paper background, text underlay, and placed
 * figures. Mounts no WebGL canvas or web worker, giving maximum sharpness,
 * zero drawing latency, and text selection capability.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  INK_A4_HEIGHT,
  INK_A4_WIDTH,
  clampInkPageSize,
  inkPageFigures,
  readInkNoteBody,
  splitInkTextLayer,
} from "@weaveforge/core";
import { loadInkPages, type InkStoredPage } from "../application/ink-chunk-store";
import { awaitInkWrites } from "../application/ink-pending-writes";
import { INK_RENDER_COLOURS, readThemePalette, type InkPalette } from "../render/ink-palette";
import type { InkHostDeps } from "./ink-host-types";
import { fitScale } from "./ink-page-math";
import { InkPageStatic } from "./ink-page-static";
import { pureInkPageText } from "./ink-sheet-underlay";
import { useFlowedTextPages } from "./ink-text-flow";
import { useDecodedStrokes } from "./use-decoded-strokes";
import { useGhostImages } from "./use-ghost-images";
import { useInkFigureUrls } from "./use-ink-figure-urls";
import {
  inkSheetImageFetchBlob,
  useInkSheetImageUrls,
  useStableResolver,
} from "./use-ink-sheet-images";
import { OverlayScrollbar } from "@/components/overlay-scrollbar";

export interface InkReaderProps {
  noteId: string;
  body: string;
  deps: InkHostDeps;
  /**
   * The paper this note belongs to, when the sheet is a paper's Notes tab.
   * Its figures are `paperimg:` blobs behind the papers facade, and without
   * the id there is nothing those paths could resolve to.
   */
  paperId?: string | null;
}

export function InkReader({ noteId, body, deps, paperId = null }: InkReaderProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(800);
  const [zoom, setZoom] = useState(1);
  const [palette, setPalette] = useState<InkPalette>(INK_RENDER_COLOURS);
  const [pages, setPages] = useState<readonly InkStoredPage[] | null>(null);

  const parsed = useMemo(() => readInkNoteBody(body), [body]);
  const meta = parsed.meta;
  const textPages = useMemo(
    () => splitInkTextLayer(parsed.text),
    [parsed.text],
  );

  const pageSize = useMemo(
    () => clampInkPageSize(INK_A4_WIDTH, INK_A4_HEIGHT),
    [],
  );

  const scale = useMemo(
    () => fitScale(containerWidth, pageSize.width) * zoom,
    [containerWidth, pageSize.width, zoom],
  );

  // Load stored chunk pages for the note — after the host that may have just
  // unmounted has finished writing its last save.
  useEffect(() => {
    let live = true;
    void awaitInkWrites(noteId)
      .then(() => loadInkPages(deps.chunks, noteId, meta))
      .then((loaded) => {
        if (!live) return;
        setPages(loaded);
      });
    return () => {
      live = false;
    };
  }, [deps.chunks, noteId, meta]);

  // Decode strokes for all pages.
  const strokesMap = useDecodedStrokes({
    pages,
    activePageIndex: 0,
  });

  // Track text layers and background images for each page.
  const textPagesRef = useRef(textPages);
  textPagesRef.current = textPages;
  // Shown flowed, as the ink editor shows it (§ink-text-flow): what runs
  // past a page's foot continues on the next, and past the last, on new ones.
  const pureTextPages = useMemo(
    () => textPages.map((text) => pureInkPageText(text)),
    [textPages],
  );
  const flowedText = useFlowedTextPages(pureTextPages, pageSize, scale);
  const pageCount = Math.max(pages?.length ?? 1, textPages.length, flowedText.length);

  const ghosts = useGhostImages({
    fetchBlob: deps.assets.fetchBlob,
    textPagesRef,
    pageCount,
    pageIndex: -1,
  });

  // Collect and load figures across all pages.
  const allFigures = useMemo(
    () => textPages.flatMap((pageText) => inkPageFigures(pageText)),
    [textPages],
  );

  const figureUrls = useInkFigureUrls({
    fetchBlob: (path) => inkSheetImageFetchBlob(path, deps, paperId),
    figures: allFigures,
  });

  // Inline images in the underlay text: `vault:` and, on a paper's Notes tab,
  // `paperimg:`. The identity is stable so a landing fetch does not re-run the
  // underlay's markdown pass and throw its mermaid diagrams away.
  const sheetImages = useInkSheetImageUrls(parsed.text, paperId);
  const resolveImageSrc = useStableResolver(sheetImages.resolveImageSrc);

  // Measure container width for responsive scaling.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => {
      if (el.clientWidth > 0) setContainerWidth(el.clientWidth);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Sync theme palette.
  useEffect(() => {
    const refresh = () => setPalette(readThemePalette(document));
    refresh();
    const observer = new MutationObserver(refresh);
    observer.observe(document.documentElement, { attributes: true });
    return () => observer.disconnect();
  }, []);

  // Support Ctrl/Cmd + Wheel zoom.
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        setZoom((z) => Math.max(0.5, Math.min(3, z * (1 - e.deltaY * 0.002))));
      }
    };
    scroller.addEventListener("wheel", onWheel, { passive: false });
    return () => scroller.removeEventListener("wheel", onWheel);
  }, []);

  return (
    <div
      className="ink-reader"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        width: "100%",
        minHeight: 0,
        background: "var(--bg)",
      }}
    >
      <div
        className="ink-reader-bar"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "6px 16px",
          borderBottom: "1px solid var(--border)",
          background: "var(--surface)",
          fontSize: "12px",
          color: "var(--text-muted)",
          flexShrink: 0,
          userSelect: "none",
        }}
      >
        <div className="ink-reader-info">
          {pageCount} {pageCount === 1 ? "page" : "pages"}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setZoom((z) => Math.max(0.5, z - 0.15))}
            aria-label="Zoom out"
            style={{ padding: "2px 8px", minHeight: 0, height: "24px" }}
          >
            -
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setZoom(1)}
            aria-label="Reset zoom"
            style={{ padding: "2px 8px", minHeight: 0, height: "24px" }}
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setZoom((z) => Math.min(3, z + 0.15))}
            aria-label="Zoom in"
            style={{ padding: "2px 8px", minHeight: 0, height: "24px" }}
          >
            +
          </button>
        </div>
      </div>
      <div style={{ position: "relative", flex: 1, minHeight: 0, width: "100%", overflow: "hidden", display: "flex", flexDirection: "column" }}>
        <div
          className="ink-page-scroll"
          ref={scrollRef}
          style={{ flex: 1, minHeight: 0 }}
        >
          {Array.from({ length: pageCount }, (_, index) => {
            const pageFigures = inkPageFigures(textPages[index] ?? "");
            return (
              <InkPageStatic
                key={`read-page-${index}`}
                index={index}
                pageSize={pageSize}
                scale={scale}
                paper={pages?.[index]?.paper ?? meta.paper ?? "blank"}
                backgroundUrl={ghosts.get(index) ?? null}
                figures={pageFigures}
                figureUrls={figureUrls}
                pureText={flowedText[index] ?? ""}
                resolveImageSrc={resolveImageSrc}
                strokes={strokesMap.get(index)}
                palette={palette}
              />
            );
          })}
        </div>
        <OverlayScrollbar scrollRef={scrollRef} />
      </div>
    </div>
  );
}
