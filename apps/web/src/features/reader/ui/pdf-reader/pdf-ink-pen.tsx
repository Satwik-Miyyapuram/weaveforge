"use client";

/**
 * The notes' pen on one PDF page: the same capture, worker and wet ink the
 * Notes sheet writes with (`useInkPen`), laid over the page's row. Its page is
 * the page box (`clientToPenUnits`), and a committed stroke is handed to the
 * reader's own save (`persistInkStroke`), so what is stored is unchanged.
 *
 * Once every save lands and no stroke is in flight the worker's page is
 * cleared (`WetInkClear`): the saved mark is drawn by the annotation layer
 * from then on, and the wet copy would sit on top of it.
 *
 * It covers the whole row, so the margin strip beside the page takes ink too;
 * points are still measured from the page box's corner. A finger, the eraser
 * end and the barrel button are not the pen's: they fall through to the row
 * (pan and pinch, the eraser, the lasso). The row's cancel (a second finger,
 * a pinch) ends the pen's stroke through `registerCancel`.
 *
 * Wet ink is drawn flat (pressure 0.5): the reader stores no pressure yet, so
 * a pressure-shaped wet stroke would change width when the saved mark
 * replaces it.
 */

import { useEffect, useRef, type PointerEvent } from "react";
import type { InkColour, PageProjection } from "@weaveforge/core";
import { readyCore } from "@/lib/rust-core";
import type { InkWorkerEvent } from "@/features/ink/application/capture-protocol";
import { inkWetDpr, readInkTuning } from "@/features/ink/application/ink-tuning";
import { backingRatio, type InkPalette } from "@/features/ink/render/parts-1";
import { useInkPen } from "@/features/ink/ui/use-ink-pen";
import { cachedRect } from "@/features/ink/ui/rect-cache";
import { WetInkClear, clientToPenUnits, penPointsToPdfPath, penViewportScale } from "../../application/pdf-ink-pen";

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
  /** Resolves true once the stroke is stored; false or a rejection keeps its wet ink. */
  persistInkStroke: (input: { pageNumber: number; pageHeight: number; path: number[]; width: number }) => Promise<boolean>;
  /** Hand the row a way to end this pen's stroke (a second finger, a pinch); returns the undo. */
  registerCancel: (cancel: () => void) => () => void;
}

/** The page box inside the pen's row (`.pdf-reader-page`), or the row itself. */
function pageBoxIn(sheet: HTMLElement | null): HTMLElement | null {
  const row = sheet?.parentElement ?? null;
  return row?.querySelector<HTMLElement>(".pdf-reader-page") ?? row;
}

/** A pointer sample with the pressure the stored mark has: none, so flat. */
function flatSample(e: globalThis.PointerEvent) {
  return {
    pointerId: e.pointerId,
    pointerType: e.pointerType,
    clientX: e.clientX,
    clientY: e.clientY,
    timeStamp: e.timeStamp,
    width: e.width,
    height: e.height,
    tiltX: e.tiltX,
    tiltY: e.tiltY,
    buttons: e.buttons,
    pressure: 0.5,
  };
}

/** The event with flat pressure, its coalesced and predicted samples too. */
function flat<E extends PointerEvent<HTMLCanvasElement>>(e: E): E {
  const native = e.nativeEvent as globalThis.PointerEvent & { wfFlat?: true };
  if (!native.wfFlat) {
    const coalesced = native.getCoalescedEvents?.bind(native);
    const predicted = native.getPredictedEvents?.bind(native);
    Object.defineProperty(native, "wfFlat", { value: true });
    if (coalesced) Object.defineProperty(native, "getCoalescedEvents", { value: () => coalesced().map(flatSample) });
    if (predicted) Object.defineProperty(native, "getPredictedEvents", { value: () => predicted().map(flatSample) });
  }
  return Object.create(e, { pressure: { value: 0.5 } }) as E;
}

export function PdfInkPen(props: PdfInkPenProps) {
  const { pageNumber, scale, tool, width, highlighterWidth, colour, palette, registerCancel } = props;
  const pageIndex = pageNumber - 1;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  // The latest props, for a stroke committed after a re-render.
  const latest = useRef(props);
  latest.current = props;
  // Saves run in order: a stroke joining the mark in hand needs its id.
  const saves = useRef<Promise<void>>(Promise.resolve());
  // The pointer the pen holds, for the row's cancel.
  const penPointer = useRef<number | null>(null);
  const wet = useRef<WetInkClear | null>(null);

  const onEvent = (event: InkWorkerEvent) => {
    if (event.type !== "stroke-committed") return;
    const p = latest.current;
    const path = penPointsToPdfPath(event.points, p.scale, (x, y) =>
      readyCore().screenPointToPdf(x, y, p.projection),
    );
    if (path.length < 4) {
      wet.current?.settle();
      return;
    }
    wet.current?.saving();
    saves.current = saves.current
      .then(() => p.persistInkStroke({ pageNumber: p.pageNumber, pageHeight: p.pageHeight, path, width: p.nibPoints }))
      .then(
        (landed) => (landed ? wet.current?.saved() : wet.current?.failed()),
        () => wet.current?.failed(),
      );
  };

  const { pen, penHandlers } = useInkPen({
    canvasRef,
    sheetRef,
    project: (clientX, clientY) => {
      const canvas = canvasRef.current;
      const page = pageBoxIn(sheetRef.current);
      if (!canvas || !page) return null;
      return clientToPenUnits(clientX, clientY, cachedRect(page), latest.current.scale, cachedRect(canvas));
    },
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
  const { send, backend, session } = pen;
  wet.current ??= new WetInkClear(
    () => send({ type: "load-page", pageIndex, chunk: null }),
    () => session.active,
  );

  /** The row's cancel ends the stroke in hand; nothing of it is saved. */
  useEffect(
    () =>
      registerCancel(() => {
        const id = penPointer.current;
        if (id != null && session.active) session.cancel(id);
        penPointer.current = null;
        wet.current?.settle();
      }),
    [registerCancel, session],
  );

  /** The page and the paper's palette, again for a renderer that came up late. */
  useEffect(() => {
    send({ type: "palette", colours: palette });
    send({ type: "load-page", pageIndex, chunk: null });
  }, [backend, send, palette, pageIndex]);

  /** The canvas is the row (page and margin strip); the camera sits at the page box's corner. */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const box = canvas.getBoundingClientRect();
    const page = pageBoxIn(sheetRef.current)?.getBoundingClientRect() ?? box;
    const dpr = backingRatio(box.width, box.height, inkWetDpr(readInkTuning().wetDpr, window.devicePixelRatio || 1));
    send({ type: "resize", width: box.width, height: box.height, dpr });
    send({
      type: "viewport",
      transform: {
        scale: penViewportScale(scale),
        offsetX: page.left - box.left,
        offsetY: page.top - box.top,
        devicePixelRatio: dpr,
      },
    });
    // The page box's own size, not the projection object, which is new each render.
  }, [backend, send, scale, props.projection.pageWidth, props.projection.pageHeight, props.projection.rotation]);

  // A finger pans and pinches the paper; the eraser end and the barrel button
  // are the page's eraser and lasso. All fall through to the row's handlers.
  const notThePen = (e: PointerEvent<HTMLCanvasElement>) =>
    e.pointerType === "touch" ||
    readyCore().isPenEraserPointer(e.pointerType, e.button, e.buttons) ||
    readyCore().isPenBarrelPointer(e.pointerType, e.button, e.buttons);

  return (
    <div ref={sheetRef} className="pdf-reader-ink-pen" style={{ position: "absolute", inset: 0, zIndex: 2 }}>
      <canvas
        ref={canvasRef}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", touchAction: "none" }}
        onPointerDown={(e) => {
          if (notThePen(e)) return;
          penPointer.current = e.pointerId;
          penHandlers.onPointerDown(flat(e));
        }}
        onPointerMove={(e) => penHandlers.onPointerMove(flat(e))}
        onPointerUp={(e) => {
          if (penPointer.current === e.pointerId) penPointer.current = null;
          penHandlers.onPointerUp(flat(e));
        }}
        onPointerCancel={(e) => {
          if (penPointer.current === e.pointerId) penPointer.current = null;
          penHandlers.onPointerCancel(flat(e));
          wet.current?.settle();
        }}
      />
    </div>
  );
}
