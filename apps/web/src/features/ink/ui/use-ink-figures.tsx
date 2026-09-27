"use client";

import { useCallback, useRef, useState } from "react";
import {
  inkPageFigures,
  reorderFigures,
  withInkPageFigures,
  type FigureGeometry,
} from "@weaveforge/core";

import { figureClipText } from "../application/figure-clipboard";
import { InkFigureEditor } from "./ink-figures";

/**
 * The figures on the page being looked at (§figure): images placed on the
 * paper, as many as wanted, moved and resized by hand. The text layer is the
 * model — `withInkPageFigures` reads and writes the block — and this state is
 * only its mirror for rendering, kept in step on every page change and every
 * drag's end.
 *
 * Out of the host so the host is the wiring between hooks and not also the
 * arithmetic of one of them: every edit the surface or the editor reports
 * ends in one `onFiguresChange`, which writes the block back and saves.
 */
export function useInkFigures(deps: {
  textPagesRef: { current: string[] };
  pageIndexRef: { readonly current: number };
  scheduleSave: () => void;
}) {
  const { textPagesRef, pageIndexRef, scheduleSave } = deps;
  const [figures, setFigures] = useState<readonly FigureGeometry[]>([]);
  const figuresRef = useRef<readonly FigureGeometry[]>([]);
  figuresRef.current = figures;
  /**
   * The figure whose controls are open, by index into `figures` — `null`
   * when none are. The controls are the only figure DOM above the canvas,
   * because they are the only part that takes its own pointer events.
   */
  const [figureControls, setFigureControls] = useState<number | null>(null);
  /**
   * The figure to select once the next page loads: a figure dropped onto
   * another page stays selected there, the way it was while it was dragged.
   * Read once by the page change (§use-ink-page-lifecycle), then cleared.
   */
  const pendingControlsRef = useRef<number | null>(null);
  const takePendingControls = useCallback(() => {
    const index = pendingControlsRef.current;
    pendingControlsRef.current = null;
    return index;
  }, []);

  /** A figure's placement changed: write the block back and save. */
  const onFiguresChange = useCallback(
    (next: readonly FigureGeometry[]) => {
      setFigures(next);
      const text = textPagesRef.current[pageIndexRef.current] ?? "";
      textPagesRef.current[pageIndexRef.current] = withInkPageFigures(text, next);
      scheduleSave();
    },
    [pageIndexRef, scheduleSave, textPagesRef],
  );

  /** The surface reports a placement; the text layer is the model. */
  const onFigureChange = useCallback(
    (index: number, geometry: Partial<FigureGeometry>) => {
      onFiguresChange(
        figuresRef.current.map((one, i) => (i === index ? { ...one, ...geometry } : one)),
      );
    },
    [onFiguresChange],
  );

  return {
    figures,
    figuresRef,
    setFigures,
    figureControls,
    setFigureControls,
    pendingControlsRef,
    takePendingControls,
    onFiguresChange,
    onFigureChange,
  };
}

/** A figure's box, clamped so at least half of it stays on the paper. */
export function clampFigureToPage<T extends FigureGeometry>(
  one: T,
  pageSize: { width: number; height: number },
): T {
  const x = Math.round(Math.min(Math.max(one.x, -one.w / 2), pageSize.width - one.w / 2));
  const y = Math.round(Math.min(Math.max(one.y, -one.h / 2), pageSize.height - one.h / 2));
  return x === one.x && y === one.y ? one : { ...one, x, y };
}

/**
 * A figure let go of after a move (§figure). A drag may carry a figure past
 * its page's edge: when its middle ends up on another page, it moves there —
 * out of this page's block, into that page's, measured from that page's
 * corner so it stays exactly where it was dropped — and that page becomes the
 * live one with the figure still selected. Dropped anywhere else (the gap,
 * past the first or the last page) it parks against its own page's edge.
 */
export function useFigureDrop(deps: {
  state: ReturnType<typeof useInkFigures>;
  textPagesRef: { current: string[] };
  sheetRef: { readonly current: HTMLElement | null };
  scale: number;
  pageSize: { width: number; height: number };
  pageIndex: number;
  pageSlotAt: (clientY: number) => { index: number; left: number; top: number } | null;
  goToPage: (target: number) => boolean;
}) {
  const { state, textPagesRef, sheetRef, scale, pageSize, pageIndex, pageSlotAt, goToPage } = deps;
  const { figuresRef, onFiguresChange, pendingControlsRef } = state;
  return useCallback(
    (index: number) => {
      const one = figuresRef.current[index];
      const sheet = sheetRef.current?.getBoundingClientRect();
      if (!one || !sheet) return;
      const middle = sheet.top + (one.y + one.h / 2) * scale;
      const slot = middle < sheet.top || middle > sheet.bottom ? pageSlotAt(middle) : null;
      if (!slot || slot.index === pageIndex) {
        const parked = clampFigureToPage(one, pageSize);
        if (parked !== one) {
          onFiguresChange(figuresRef.current.map((each, i) => (i === index ? parked : each)));
        }
        return;
      }
      const moved = clampFigureToPage(
        {
          ...one,
          x: Math.round((sheet.left + one.x * scale - slot.left) / scale),
          y: Math.round((sheet.top + one.y * scale - slot.top) / scale),
        },
        pageSize,
      );
      const there = textPagesRef.current[slot.index] ?? "";
      const landed = [...inkPageFigures(there), moved];
      textPagesRef.current[slot.index] = withInkPageFigures(there, landed);
      // Off this page, which also schedules the save that carries both pages.
      onFiguresChange(figuresRef.current.filter((_, i) => i !== index));
      pendingControlsRef.current = landed.length - 1;
      if (!goToPage(slot.index)) pendingControlsRef.current = null;
    },
    [
      figuresRef,
      goToPage,
      onFiguresChange,
      pageIndex,
      pageSize,
      pageSlotAt,
      pendingControlsRef,
      scale,
      sheetRef,
      textPagesRef,
    ],
  );
}

/**
 * A figure to the system clipboard: its picture as a PNG for any other app,
 * and the figure itself as text for a paste back into a note
 * (§figure-clipboard). The PNG is a promise so the write keeps the key
 * press's permission while the bytes are read; a clipboard that will not take
 * the picture still gets the text, which is all a note needs.
 */
export async function copyFigureToClipboard(
  noteId: string,
  figure: FigureGeometry,
  imageUrl: string | undefined,
): Promise<void> {
  const text = figureClipText({ noteId, figure });
  if (typeof navigator === "undefined" || !navigator.clipboard) return;
  if (imageUrl && typeof ClipboardItem !== "undefined") {
    // Read through an <img>, not fetch: the picture is a blob: URL, which the
    // page's img-src takes and its connect-src does not.
    const png = (async () => {
      const image = new Image();
      image.src = imageUrl;
      await image.decode();
      const canvas = new OffscreenCanvas(image.naturalWidth, image.naturalHeight);
      canvas.getContext("2d")?.drawImage(image, 0, 0);
      return canvas.convertToBlob({ type: "image/png" });
    })();
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/plain": new Blob([text], { type: "text/plain" }),
          "image/png": png,
        }),
      ]);
      return;
    } catch {
      // see above: the text alone
    }
  }
  await navigator.clipboard.writeText(text).catch(() => undefined);
}

/**
 * The editor over the figure whose controls are open, or nothing. Its edits
 * go through the same `onFiguresChange` as a drag on the surface.
 */
export function InkActiveFigureEditor({
  state,
  scale,
  pageSize,
  imageUrls,
  noteId,
  onDrop,
}: {
  state: ReturnType<typeof useInkFigures>;
  scale: number;
  pageSize: { width: number; height: number };
  imageUrls: ReadonlyMap<string, string>;
  /** The note that owns the figures' attachments, named on a copy. */
  noteId: string;
  /** A move of the figure ended (§useFigureDrop). */
  onDrop?: (index: number) => void;
}) {
  const { figures, figuresRef, figureControls, setFigureControls, onFiguresChange } = state;
  if (figureControls === null) return null;
  const figure = figures[figureControls];
  if (!figure) return null;
  return (
    <InkFigureEditor
      figure={figure}
      index={figureControls}
      count={figures.length}
      scale={scale}
      pageSize={pageSize}
      imageUrl={imageUrls.get(figure.path)}
      onChange={(next) => {
        onFiguresChange(
          figuresRef.current.map((one, i) => {
            if (i !== figureControls) return one;
            const { crop, ...box } = next;
            return crop ? { ...one, ...box, crop } : { path: one.path, ...box };
          }),
        );
      }}
      onReorder={(step) => {
        // The block's order is the paint order: moving the line moves the
        // picture, and the editor follows it to its new index.
        const next = reorderFigures(figuresRef.current, figureControls, step);
        const moved = next.indexOf(figuresRef.current[figureControls]!);
        onFiguresChange(next);
        setFigureControls(moved);
      }}
      onRemove={() => {
        onFiguresChange(figuresRef.current.filter((_, i) => i !== figureControls));
        setFigureControls(null);
      }}
      onClose={() => setFigureControls(null)}
      onDrop={onDrop ? () => onDrop(figureControls) : undefined}
      onCopy={() => void copyFigureToClipboard(noteId, figure, imageUrls.get(figure.path))}
      onCut={() => {
        void copyFigureToClipboard(noteId, figure, imageUrls.get(figure.path));
        onFiguresChange(figuresRef.current.filter((_, i) => i !== figureControls));
        setFigureControls(null);
      }}
    />
  );
}
