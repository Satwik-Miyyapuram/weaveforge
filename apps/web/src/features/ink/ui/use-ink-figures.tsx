"use client";

import { useCallback, useRef, useState } from "react";
import { reorderFigures, withInkPageFigures, type FigureGeometry } from "@weaveforge/core";

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
    onFiguresChange,
    onFigureChange,
  };
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
}: {
  state: ReturnType<typeof useInkFigures>;
  scale: number;
  pageSize: { width: number; height: number };
  imageUrls: ReadonlyMap<string, string>;
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
    />
  );
}
