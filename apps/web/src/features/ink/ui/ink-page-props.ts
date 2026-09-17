/** What {@link InkPage} is handed: the host's state and the pen's handlers. */

import type { FigureGeometry } from "@weaveforge/core";
import type { InkBarTool } from "./ink-bar";

export interface InkPageProps {
  pageIndex: number;
  /** Page size in 0.1 mm. */
  pageSize: { width: number; height: number };
  /** CSS pixels per 0.1 mm, from the host's fit. */
  scale: number;
  paper: string;
  tool: InkBarTool | "shape";
  /** Client coordinates to page units in 0.1 mm, `null` off the page. */
  project: (
    clientX: number,
    clientY: number,
  ) => { x: number; y: number } | null;
  /** The pen's own handlers, from `usePenCapture`. */
  penHandlers: {
    onPointerDown: (event: React.PointerEvent<HTMLCanvasElement>) => void;
    onPointerMove: (event: React.PointerEvent<HTMLCanvasElement>) => void;
    onPointerUp: (event: React.PointerEvent<HTMLCanvasElement>) => void;
    onPointerCancel: (event: React.PointerEvent<HTMLCanvasElement>) => void;
  };
  /** The canvas, for the host to measure and to transfer. */
  canvasRef: React.RefObject<HTMLCanvasElement>;
  /** The sheet — the page's full box — for the host to project against. */
  sheetRef: React.RefObject<HTMLDivElement>;
  /**
   * The canvas's size in CSS pixels: the part of the sheet the scroller can
   * show. The canvas is a window onto the sheet, not the sheet itself, so a
   * deep zoom does not ask the compositor for a page-sized surface and a pan
   * moves the window rather than re-tiling the page (§6.2.14).
   */
  view: { width: number; height: number };
  /** One erase sweep, in page units. */
  onErase: (
    from: { x: number; y: number },
    to: { x: number; y: number },
  ) => void;
  /** A lasso is a region rather than a stroke; the host decides what it means. */
  onLasso?: (path: readonly number[]) => void;
  /**
   * The current selection's box in page units, `null` when nothing is selected.
   * A lasso pointer-down inside it drags the selection instead of drawing a
   * new loop.
   */
  selectionBounds?: readonly [number, number, number, number] | null;
  /** The drag ended: the selection moved by `dx, dy` page units. */
  onMoveSelection?: (dx: number, dy: number) => void;
  /** A drag in progress: the selection is shown `dx, dy` page units from where it is. */
  onDragSelection?: (dx: number, dy: number) => void;
  /** Whether touch may draw at all, which is what `touch-action` follows. */
  penOnly: boolean;
  penSeen: boolean;
  /** One finger moved the page by `dx, dy` CSS pixels: scroll by that. */
  onPan?: (dx: number, dy: number) => void;
  /** Two fingers moved apart or together: zoom by factor about clientX, clientY */
  onPinch?: (factor: number, clientX: number, clientY: number) => void;
  /**
   * A file (image or PDF) dropped directly onto the page surface, with where
   * it landed in page units — an image becomes a figure *there*, rather than
   * the middle its button lands on. `null` when the point is off the page.
   */
  onDropFile?: (file: File, at: { x: number; y: number } | null) => void;
  /**
   * Content under the canvas and over the paper: the page's figures, placed
   * images the writing goes over (§figure). The canvas is transparent except
   * for its strokes, so what this draws shows through wherever there is no
   * ink — a figure is a photograph pasted in, not a layer of the page.
   */
  below?: React.ReactNode;
  /**
   * The page's figures' boxes, in page units — the same array the `below`
   * layer renders, as geometry for this surface's own hit-testing. The
   * canvas is the pointer's surface, so figures are reached through it: a
   * mouse down inside a box is a figure drag, on its corner a resize, and a
   * double-click opens the figure's controls. The pen draws over a figure
   * as over any paper — a pen over a photograph is a note.
   */
  figures?: readonly FigureGeometry[];
  /**
   * The figure whose editor is open, if any. Its frame sits over the canvas
   * and owns every pointer on it, so the canvas leaves that figure alone: a
   * drag that slipped past the frame must not move the picture under the
   * tool that is editing it.
   */
  editingFigure?: number | null;
  /** A figure drag moved or resized figure `index`: write it to the note. */
  onFigureChange?: (
    index: number,
    geometry: Pick<FigureGeometry, "x" | "y" | "w" | "h">,
  ) => void;
  /**
   * A click inside figure `index` selects it: open its editor. A pointer
   * down anywhere else on the page is `null`: whatever was selected is not.
   */
  onFigureActivate?: (index: number | null) => void;
  /**
   * Content over the canvas: the selected figure's editor (§ink-figures),
   * which takes its own pointer events from any pointer.
   */
  above?: React.ReactNode;
  /**
   * The canvas covers the whole pane, not just the live sheet, so a pointer
   * can land on a neighbouring page's visible part. Called first on every
   * down: the host makes the page under `clientX, clientY` the live one —
   * synchronously, so the stroke that follows lands on it — and answers
   * whether it did. A pen that comes down between pages keeps the live page.
   */
  ensurePage?: (clientX: number, clientY: number) => boolean;
  /** Whether a pen stroke is in flight, for the boundary split below. */
  penActive?: () => boolean;
}
