"use client";

/**
 * The ink host: what `document-host.tsx` mounts for `kind === "ink_page"`.
 *
 * Everything the ink view is, in one component that the kind table can point at
 * (§6.1). It owns the tool state, the canvas, the pen hook and the worker's
 * non-pen traffic; {@link InkBar} and {@link InkPage} are the two presentational
 * halves, and the text-layer column is where step 5 puts recognition.
 *
 * Three things about *this* layer are load-bearing:
 *
 * - **Stacking.** The canvas is the topmost element of the page area and the bar
 *   and the text column are siblings *outside* the page container. A translucent
 *   `desynchronized` canvas with DOM above it silently loses the low-latency path
 *   (§6.1, §6.2.8); the CSS and this markup are the two halves of that rule.
 * - **The live stroke is not in React.** The hook hands samples straight to the
 *   worker; the only state that changes during a stroke is the committed count,
 *   which the worker reports once per stroke.
 * - **One worker, one door.** Loading a page, resizing, the viewport transform,
 *   erase, undo and export all go through `pen.send`, because the pen path owns
 *   the worker and a second one would double the geometry.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  INK_A4_HEIGHT,
  INK_A4_WIDTH,
  INK_PEN_WIDTH,
  joinInkTextLayer,
  splitInkTextLayer,
  type InkColour,
} from "@weaveforge/core";

import { usePenCapture } from "../application/use-pen-capture";
import type { InkStrokeHeader } from "../application/capture-protocol";
import { InkBar, nibForTool, type InkBarTool } from "./ink-bar";
import { InkPage } from "./ink-page";

/** A page as the host is given it: its bytes, and the paper it is drawn on. */
export interface InkHostPage {
  /** The chunk exactly as the sidecar holds it, or `null` for a page never written. */
  chunk: Uint8Array | null;
  paper: string;
}

export interface InkHostProps {
  /** The note's pages, in order. */
  pages: readonly InkHostPage[];
  /** The note's body: the recognised text layer, one paragraph per line. */
  body: string;
  /** The page the note opens on, 0-based. */
  initialPage?: number;
  /** Where a committed page's bytes come from when it is saved. */
  onSave?: (body: string) => Promise<void>;
  /** The tools the ink bar should show as unavailable. */
  busy?: boolean;
}

/**
 * The fit: how many CSS pixels one 0.1 mm unit is worth.
 *
 * A page is A4 at 0.1 mm and the pane is whatever width it is, so the default view
 * is fit-width and vertical scrolling is the vertical navigation — a page, not an
 * infinite canvas (§1). Zoom is a multiplier on that fit, which keeps "reset" a
 * number rather than a rect, and the worker's transform is one `postMessage` away
 * (§6.2.1: pan and zoom are uniform updates, so neither needs machinery).
 */
export function fitScale(containerWidth: number, pageWidth = INK_A4_WIDTH): number {
  if (!(containerWidth > 0)) return 1;
  return containerWidth / pageWidth;
}

export function InkHost({ pages, body, initialPage = 0, onSave, busy }: InkHostProps) {
  const [pageIndex, setPageIndex] = useState(initialPage);
  const [tool, setTool] = useState<InkBarTool | "shape">("pen");
  const [colour, setColour] = useState<InkColour>("text");
  const [width, setWidth] = useState<number>(INK_PEN_WIDTH);
  const [zoom, setZoom] = useState(1);
  const [strokes, setStrokes] = useState(0);
  const [recognised, setRecognised] = useState(0);
  const [containerWidth, setContainerWidth] = useState(0);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  /** The text layer's pages, for the right-hand column (§4.2). */
  const [textPages, setTextPages] = useState<string[]>(() => splitInkTextLayer(body));

  const scale = useMemo(() => fitScale(containerWidth) * zoom, [containerWidth, zoom]);
  const page = pages[pageIndex] ?? { chunk: null, paper: "blank" };

  /** Client coordinates to page units. The one projection everything shares. */
  const project = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const box = canvas.getBoundingClientRect();
      return {
        x: ((clientX - box.left) / Math.max(box.width, 1)) * INK_A4_WIDTH,
        y: ((clientY - box.top) / Math.max(box.height, 1)) * INK_A4_HEIGHT,
      };
    },
    [],
  );

  const nib = nibForTool(tool, width);

  const pen = usePenCapture({
    element: () => canvasRef.current,
    project,
    bounds: () => {
      const box = canvasRef.current?.getBoundingClientRect();
      return box ? { left: box.left, top: box.top, width: box.width, height: box.height } : undefined;
    },
    pageIndex,
    // The eraser and the lasso do not draw, so the pen's tool is the pen's: a
    // highlighter is the only other thing that puts ink down.
    tool: tool === "highlighter" ? "highlighter" : "pen",
    width: nib,
    colour,
    onStrokeEnd: () => {
      // One state change per stroke, which is the contract the hook's doc comment
      // makes: the live stroke never entered React, so there is nothing to batch.
      setStrokes((count) => count + 1);
    },
  });

  const { send } = pen;

  /** Tell the worker which page we are on, and hand it the bytes. */
  useEffect(() => {
    send({ type: "load-page", pageIndex, chunk: page.chunk });
    setStrokes(0);
  }, [page.chunk, pageIndex, send]);

  /** Keep the worker's viewport in step with the layout. */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const box = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    send({
      type: "viewport",
      transform: { scale, offsetX: 0, offsetY: 0, devicePixelRatio: dpr },
    });
    send({ type: "resize", width: box.width, height: box.height, dpr });
  }, [scale, send]);

  /** Measure the pane, so the fit is the container's and not a guess. */
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const measure = () => setContainerWidth(element.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  /** The keyboard, per §6.5: tools, undo, recognise, export. */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey) {
        if (event.key.toLowerCase() === "z") {
          event.preventDefault();
          send({ type: event.shiftKey ? "redo" : "undo" });
        }
        if (event.shiftKey && event.key.toLowerCase() === "r") {
          event.preventDefault();
          setRecognised(0); // step 5 replaces this with a real run
        }
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return;
      switch (event.key.toLowerCase()) {
        case "p":
          setTool("pen");
          break;
        case "h":
          setTool("highlighter");
          break;
        case "e":
          setTool("eraser");
          break;
        case "l":
          setTool("lasso");
          break;
        case "s":
          setTool("shape");
          break;
        case "1":
        case "2":
        case "3": {
          const palette: InkColour[] = ["text", "accent", "warn"];
          const chosen = palette[Number(event.key) - 1];
          if (chosen) setColour(chosen);
          break;
        }
        default:
          break;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [send]);

  /** Zoom without plumbing a gesture: ⌘/Ctrl and the wheel, or the buttons. */
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      setZoom((value) => Math.min(4, Math.max(0.5, value * (event.deltaY < 0 ? 1.1 : 0.9))));
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, []);

  const onErase = useCallback(
    (from: { x: number; y: number }, to: { x: number; y: number }) => {
      send({ type: "erase", from, to });
    },
    [send],
  );

  const onUndo = useCallback(() => send({ type: "undo" }), [send]);
  const onRedo = useCallback(() => send({ type: "redo" }), [send]);

  /**
   * Export the page as a PNG.
   *
   * The blob comes back from the worker's offscreen target, never from a readback
   * of the live canvas (§6.2.12). Nothing is downloaded here: the caller decides,
   * which is what lets step 8's "export for the report" land a file in the vault.
   */
  const onExport = useCallback(() => {
    const requestId = Date.now();
    send({ type: "export-page", requestId, scale: 2 });
    const listener = (event: MessageEvent) => {
      const data = event.data as { type?: string; requestId?: number; png?: Blob | null };
      if (data?.type !== "exported" || data.requestId !== requestId) return;
      window.removeEventListener("message", listener);
      if (data.png) void onSave?.(joinInkTextLayer(textPages));
    };
    // The worker's own events arrive through the hook, so this is a one-shot
    // listener on the window rather than a second channel; step 5's UI work moves
    // the result into a menu.
    window.addEventListener("message", listener);
  }, [onSave, send, textPages]);

  return (
    <div className="ink-wrap">
      <InkBar
        tool={tool}
        colour={colour}
        width={width}
        page={pageIndex + 1}
        pages={pages.length}
        strokes={strokes}
        recognised={recognised}
        penOnly={pen.penOnly}
        penSeen={pen.penSeen}
        backend={pen.backend}
        busy={busy}
        onTool={(next) => setTool(next)}
        onColour={setColour}
        onWidth={(next) => {
          setWidth(next);
          setTool("pen");
        }}
        onPenOnly={pen.setPenOnly}
        onRecognise={() => setRecognised(recognised)}
        onInsertPage={() => setTextPages((pages_) => pages_)}
        onExport={onExport}
        onUndo={onUndo}
        onRedo={onRedo}
        onAddPage={() => setPageIndex((index) => Math.min(index + 1, pages.length - 1))}
      />
      <div className="ink-page-scroll" ref={scrollRef}>
        <InkPage
          pageIndex={pageIndex}
          pageSize={{ width: INK_A4_WIDTH, height: INK_A4_HEIGHT }}
          scale={scale}
          paper={page.paper}
          tool={tool}
          project={project}
          penHandlers={pen.handlers}
          canvasRef={canvasRef}
          onErase={onErase}
          penOnly={pen.penOnly}
          penSeen={pen.penSeen}
        />
      </div>
      {/*
        The text-layer column, which is the recognised text and the reason the note
        is searchable at all (§4.2). Step 5 fills it with confidence, corrections and
        links; what it shows now is the body the note already has, which is what a
        note with no recognition is: readable text and no strokes' worth of index.
      */}
      <div className="ink-text" aria-label="Recognised text">
        <h4>
          Text layer{" "}
          <span className="ink-conf">{Math.round(recognised * 100)} %</span>
        </h4>
        {(textPages[pageIndex] ?? "").split("\n").filter(Boolean).length === 0 ? (
          <p className="ink-empty">
            Nothing recognised on this page yet. Recognise it to make the note
            searchable and linkable.
          </p>
        ) : (
          (textPages[pageIndex] ?? "").split("\n").map((line, index) => <p key={index}>{line}</p>)
        )}
      </div>
    </div>
  );
}

/** The stroke header a tool produces, so the host and the bar agree. */
export function headerForTool(
  tool: InkBarTool | "shape",
  width: number,
  colour: InkColour,
  pageIndex: number,
  strokeId: number,
): InkStrokeHeader {
  return {
    strokeId,
    pageIndex,
    width: nibForTool(tool, width),
    tool: tool === "highlighter" ? "highlighter" : tool === "shape" ? "shape" : "pen",
    colour,
  };
}
