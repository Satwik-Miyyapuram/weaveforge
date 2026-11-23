"use client";

/**
 * The notes' pen on one PDF page: the same capture, worker and wet ink the
 * Notes sheet writes with (`useInkPen`), laid over the page box. Its page is
 * the page box (`clientToPenUnits`), and a committed stroke is handed to the
 * reader's own save (`persistInkStroke`), so what is stored is unchanged.
 *
 * Once the save lands the worker's page is cleared: the saved mark is drawn by
 * the annotation layer from then on, and the wet copy would sit on top of it.
 */

import { useEffect, useRef, type PointerEvent } from "react";
import type { InkColour, PageProjection } from "@weaveforge/core";
import { readyCore } from "@/lib/rust-core";
import type { InkWorkerEvent } from "@/features/ink/application/capture-protocol";
import { inkWetDpr, readInkTuning } from "@/features/ink/application/ink-tuning";
import { backingRatio, type InkPalette } from "@/features/ink/render/parts-1";
import { useInkPen } from "@/features/ink/ui/use-ink-pen";
import { cachedRect } from "@/features/ink/ui/rect-cache";
import { clientToPenUnits, penPointsToPdfPath, penViewportScale } from "../../application/pdf-ink-pen";

export interface PdfInkPenProps {
  pageNumber: number;
  /** CSS px per PDF point. */
  scale: number;
  projection: PageProjection;
  pageHeight: number;
  tool: "pen" | "highlighter";
  /** The bar's widths, in 0.1 mm, as the notes' pen takes them. */
  width: number;
  highlighterWidth: number;
  colour: InkColour;
  palette: InkPalette;
  /** The nib in PDF points, as the reader stores it. */
  nibPoints: number;
  persistInkStroke: (input: { pageNumber: number; pageHeight: number; path: number[]; width: number }) => Promise<void>;
}

export function PdfInkPen(props: PdfInkPenProps) {
  const { pageNumber, scale, tool, width, highlighterWidth, colour, palette } = props;
  const pageIndex = pageNumber - 1;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  // The latest props, for a stroke committed after a re-render.
  const latest = useRef(props);
  latest.current = props;
  // Saves run in order, so a stroke joining the mark in hand finds it saved.
  const saves = useRef<Promise<void>>(Promise.resolve());

  const onEvent = (event: InkWorkerEvent) => {
    if (event.type !== "stroke-committed") return;
    const p = latest.current;
    const path = penPointsToPdfPath(event.points, p.scale, (x, y) =>
      readyCore().screenPointToPdf(x, y, p.projection),
    );
    if (path.length < 4) return;
    saves.current = saves.current
      .then(() => p.persistInkStroke({ pageNumber: p.pageNumber, pageHeight: p.pageHeight, path, width: p.nibPoints }))
      .catch(() => undefined)
      .then(() => {
        // A stroke still in flight keeps its wet ink; the next commit clears both.
        if (!pen.session.active) pen.send({ type: "load-page", pageIndex, chunk: null });
      });
  };

  const { pen, penHandlers } = useInkPen({
    canvasRef,
    sheetRef,
    project: (clientX, clientY) =>
      canvasRef.current ? clientToPenUnits(clientX, clientY, cachedRect(canvasRef.current), latest.current.scale) : null,
    pageIndex,
    tool,
    width,
    highlighterWidth,
    colour,
    hand: "right",
    palette,
    onEvent,
    onStrokeEnd: () => {},
  });
  const { send, backend } = pen;

  /** The page and the paper's palette, again for a renderer that came up late. */
  useEffect(() => {
    send({ type: "palette", colours: palette });
    send({ type: "load-page", pageIndex, chunk: null });
  }, [backend, send, palette, pageIndex]);

  /** The canvas is the page box, so the camera sits at its corner. */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const box = canvas.getBoundingClientRect();
    const dpr = backingRatio(box.width, box.height, inkWetDpr(readInkTuning().wetDpr, window.devicePixelRatio || 1));
    send({ type: "resize", width: box.width, height: box.height, dpr });
    send({
      type: "viewport",
      transform: { scale: penViewportScale(scale), offsetX: 0, offsetY: 0, devicePixelRatio: dpr },
    });
    // The page box's own size, not the projection object, which is new each render.
  }, [backend, send, scale, props.projection.pageWidth, props.projection.pageHeight, props.projection.rotation]);

  // The eraser end and the barrel button belong to the page (its eraser and
  // lasso), not to the pen: they fall through to the row's handlers.
  const notThePen = (e: PointerEvent<HTMLCanvasElement>) =>
    readyCore().isPenEraserPointer(e.pointerType, e.button, e.buttons) ||
    readyCore().isPenBarrelPointer(e.pointerType, e.button, e.buttons);

  return (
    <div ref={sheetRef} className="pdf-reader-ink-pen" style={{ position: "absolute", inset: 0, zIndex: 2 }}>
      <canvas
        ref={canvasRef}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", touchAction: "none" }}
        {...penHandlers}
        onPointerDown={(e) => {
          if (notThePen(e)) return;
          penHandlers.onPointerDown(e);
        }}
      />
    </div>
  );
}
