"use client";

/**
 * The figures on a live page: images placed on the paper (§figure).
 *
 * A figure is not ink — it does not go through the worker, because it is not
 * a stroke and never rasterises into one. It is a placed image, drawn as one:
 * absolutely positioned in the sheet, in page units scaled the way the sheet
 * is, under the canvas so writing over a figure stays ink.
 *
 * The gestures are the canvas's, not the image's. The canvas is the drawing
 * surface and it sits over every figure, so the page routes the pointer
 * itself (§ink-page): a pen tip always draws — a pen over a photograph is a
 * note — while a mouse that lands inside a figure's box drags the figure,
 * and one that lands on a corner resizes it. A click selects, which opens
 * the editor here (§InkFigureEditor): handles above the canvas that any
 * pointer can use, and a toolbar for the crop, the stacking order and the
 * removal — the things a gesture cannot say.
 *
 * The placement is the note's text (§figure.ts in core): the layer reads it
 * as geometry and the host writes it back, so the text layer is the model
 * and never a shadow of it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  FIGURE_HANDLES,
  cropFigureTo,
  figureImageFrame,
  resizeFigureBox,
  uncroppedFigureBox,
  type FigureGeometry,
  type FigureHandle,
  type FigureOrderStep,
} from "@weaveforge/core";

export interface InkFiguresProps {
  /** The figures the page's text layer places. */
  figures: readonly FigureGeometry[];
  /** CSS pixels per 0.1 mm, the sheet's own scale. */
  scale: number;
  /** A blob URL per figure path, resolved by the host once. */
  imageUrls: ReadonlyMap<string, string>;
  /**
   * The figure the controls are open for, by its index in `figures` — an
   * outline while the controls are open, so the popover has a referent.
   */
  activeIndex?: number | null;
}

/**
 * The figures themselves — painted under the canvas, pointer-transparent
 * because the canvas owns the pointer (§ink-page).
 */
export function InkFigures({
  figures,
  scale,
  imageUrls,
  activeIndex = null,
}: InkFiguresProps) {
  return (
    <div className="ink-figures" aria-hidden="true">
      {figures.map((one, index) => {
        const url = imageUrls.get(one.path);
        // A crop hides part of the image without touching the box: the
        // frame keeps its place and size, and the picture inside it is
        // enlarged so the cropped-out edges fall outside the frame — the
        // wrapper clips (§figureImageFrame).
        const frame = figureImageFrame(one);
        const active = activeIndex === index;
        return (
          <div
            key={`${one.path}:${index}`}
            className={`ink-figure${active ? " is-active" : ""}`}
            data-figure={index}
            style={{
              position: "absolute",
              left: `${one.x * scale}px`,
              top: `${one.y * scale}px`,
              width: `${one.w * scale}px`,
              height: `${one.h * scale}px`,
            }}
          >
            {url ? (
              <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
                {/* A plain `<img>`, in all three places this file draws one.
                    `next/image` cannot serve these: the `src` is a `blob:` URL
                    this app created itself (`use-ink-figure-urls.ts`) and
                    revokes itself, and the image optimizer has no route for one
                    — it would 400 on a URL that only exists in this tab's
                    memory. The element is also placed and scaled in ink space
                    by the style beside it, which the wrapper `next/image` adds
                    would sit between it and the sheet. Same reasoning as
                    `components/card-thumbs.tsx`. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt=""
                  draggable={false}
                  style={{
                    position: "absolute",
                    width: `${frame.width.toFixed(3)}%`,
                    height: `${frame.height.toFixed(3)}%`,
                    left: `${frame.left.toFixed(3)}%`,
                    top: `${frame.top.toFixed(3)}%`,
                    objectFit: "fill",
                  }}
                />
              </div>
            ) : (
              <div className="ink-figure-pending" />
            )}
          </div>
        );
      })}
    </div>
  );
}

export interface InkFigureEditorProps {
  /** The figure the editor is about. */
  figure: FigureGeometry;
  /** Its index in the page's figures, and how many there are: for the order buttons. */
  index: number;
  count: number;
  /** CSS pixels per 0.1 mm, the sheet's own scale. */
  scale: number;
  /** The page, in page units, so a move parks against its edges. */
  pageSize: { width: number; height: number };
  /** The figure's image, for the crop tool to show the whole of. */
  imageUrl: string | undefined;
  /** The figure's geometry changed: its box, its crop, or both. */
  onChange: (next: Pick<FigureGeometry, "x" | "y" | "w" | "h" | "crop">) => void;
  /** The figure moved in the stacking order. */
  onReorder: (step: FigureOrderStep) => void;
  /** The figure removed from the page. */
  onRemove: () => void;
  /** The editor closed without doing anything more. */
  onClose: () => void;
}

/** A pointer drag in progress on the selected figure. */
interface EditorDrag {
  pointerId: number;
  handle: FigureHandle | "move";
  from: { x: number; y: number };
  box: { x: number; y: number; w: number; h: number };
}

const CURSORS: Record<FigureHandle, string> = {
  nw: "nwse-resize",
  se: "nwse-resize",
  ne: "nesw-resize",
  sw: "nesw-resize",
  n: "ns-resize",
  s: "ns-resize",
  e: "ew-resize",
  w: "ew-resize",
};

/** Where a handle sits on its box, as CSS. */
function handleStyle(handle: FigureHandle): React.CSSProperties {
  const style: React.CSSProperties = { cursor: CURSORS[handle] };
  if (handle.includes("n")) style.top = 0;
  if (handle.includes("s")) style.bottom = 0;
  if (handle.includes("w")) style.left = 0;
  if (handle.includes("e")) style.right = 0;
  if (handle === "n" || handle === "s") style.left = "50%";
  if (handle === "e" || handle === "w") style.top = "50%";
  return style;
}

/** The eight resize handles on a frame, wired to one drag lifecycle. */
function FrameHandles({
  begin,
  move,
  end,
}: {
  begin: (event: React.PointerEvent, handle: FigureHandle) => void;
  move: (event: React.PointerEvent) => void;
  end: (event: React.PointerEvent) => void;
}) {
  return FIGURE_HANDLES.map((handle) => (
    <span
      key={handle}
      className="ink-figure-handle"
      data-handle={handle}
      style={handleStyle(handle)}
      onPointerDown={(event) => begin(event, handle)}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
    />
  ));
}

/** A pointer drag's lifecycle on a frame or a handle, shared by both tools. */
function useFrameDrag(
  scale: number,
  onDrag: (held: EditorDrag, dx: number, dy: number, event: React.PointerEvent) => void,
  box: () => { x: number; y: number; w: number; h: number },
) {
  const drag = useRef<EditorDrag | null>(null);
  const begin = useCallback(
    (event: React.PointerEvent, handle: FigureHandle | "move") => {
      if (event.button !== 0 && event.pointerType === "mouse") return;
      event.preventDefault();
      event.stopPropagation();
      // A pointer that is already gone (a pen lifted between the down and
      // this handler, a synthetic event) has no capture to take; the drag
      // still starts, it just ends at the first up that reaches the frame.
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // see above
      }
      drag.current = {
        pointerId: event.pointerId,
        handle,
        from: { x: event.clientX, y: event.clientY },
        box: box(),
      };
    },
    [box],
  );
  const move = useCallback(
    (event: React.PointerEvent) => {
      const held = drag.current;
      if (!held || held.pointerId !== event.pointerId) return;
      event.preventDefault();
      onDrag(held, (event.clientX - held.from.x) / scale, (event.clientY - held.from.y) / scale, event);
    },
    [onDrag, scale],
  );
  const end = useCallback((event: React.PointerEvent) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);
  return { begin, move, end };
}

/** The slice of an element that is on screen, in its own pixels. */
interface VisibleWindow {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/**
 * Where the eye can see: the editor's on-screen slice, in the editor's own
 * pixels, kept current as the sheet scrolls under it. A figure is often
 * taller than the viewport, and a toolbar pinned above its box is then off
 * the top of the screen — the toolbar must follow the visible part instead.
 */
function useVisibleWindow(ref: React.RefObject<HTMLElement | null>): VisibleWindow | null {
  const [window_, setWindow] = useState<VisibleWindow | null>(null);
  useEffect(() => {
    if (typeof document === "undefined") return;
    const measure = () => {
      const el = ref.current;
      if (!el || typeof el.getBoundingClientRect !== "function") return;
      const rect = el.getBoundingClientRect();
      // What can be seen is the viewport cut down by every scrolling
      // ancestor: the sheet scrolls inside a pane that sits under the bar.
      let seenTop = 0;
      let seenBottom = window.innerHeight;
      let seenLeft = 0;
      let seenRight = window.innerWidth;
      for (let node = el.parentElement; node; node = node.parentElement) {
        const { overflowX, overflowY } = getComputedStyle(node);
        const clips = (o: string) => o === "auto" || o === "scroll" || o === "hidden";
        if (!clips(overflowX) && !clips(overflowY)) continue;
        const box = node.getBoundingClientRect();
        seenTop = Math.max(seenTop, box.top);
        seenBottom = Math.min(seenBottom, box.bottom);
        seenLeft = Math.max(seenLeft, box.left);
        seenRight = Math.min(seenRight, box.right);
      }
      const next = {
        top: Math.max(0, seenTop - rect.top),
        bottom: Math.min(rect.height, seenBottom - rect.top),
        left: Math.max(0, seenLeft - rect.left),
        right: Math.min(rect.width, seenRight - rect.left),
      };
      setWindow((current) =>
        current &&
        current.top === next.top &&
        current.bottom === next.bottom &&
        current.left === next.left &&
        current.right === next.right
          ? current
          : next,
      );
    };
    measure();
    // Capture, so a scroll of any ancestor — the sheet's, not the page's — is seen.
    document.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      document.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, [ref]);
  return window_;
}

const BAR_H = 40;

/**
 * The toolbar's place: above the box, under it when the box is at the top of
 * the sheet, and — when neither is on screen — inside the box, at the top
 * of what can be seen, so a tall figure's bar is never scrolled away.
 */
function popoverStyle(
  px: { left: number; top: number; height: number },
  visible: VisibleWindow | null,
  width: number,
): React.CSSProperties {
  let top = px.top >= BAR_H + 4 ? px.top - BAR_H : px.top + px.height + 8;
  let left = Math.max(8, px.left);
  if (visible) {
    const seen = (y: number) => y >= visible.top && y + BAR_H <= visible.bottom;
    if (!seen(top)) {
      const below = px.top + px.height + 8;
      top = seen(below) ? below : Math.max(visible.top + 8, px.top + 8);
    }
    // Sideways the bar is pulled back in whole: a figure at the right edge
    // of the pane must not have its buttons cut off by it.
    left = Math.max(visible.left + 8, Math.min(left, visible.right - width - 8));
  }
  return { left: `${left}px`, top: `${top}px` };
}

/** The bar's own width, once drawn, so it can be kept inside the pane. */
function usePopoverWidth(): [React.RefCallback<HTMLDivElement>, number] {
  const [width, setWidth] = useState(0);
  const ref = useCallback((node: HTMLDivElement | null) => {
    if (node && typeof node.getBoundingClientRect === "function") {
      setWidth(node.getBoundingClientRect().width);
    }
  }, []);
  return [ref, width];
}

/**
 * The selected figure's editor — the one part of a figure above the canvas,
 * because it is the one part that takes its own pointer events, from any
 * pointer: once a figure is selected a pen, a finger and a mouse all move it
 * by its body and resize it by its handles. Corners keep the aspect; Shift
 * frees them; edges move one side. Arrow keys nudge a millimetre, ten with
 * Shift; Delete removes; Escape is done.
 *
 * The toolbar above it holds what a gesture cannot say: the crop, which
 * opens the crop tool in place, the stacking order, and the removal.
 */
export function InkFigureEditor({
  figure,
  index,
  count,
  scale,
  pageSize,
  imageUrl,
  onChange,
  onReorder,
  onRemove,
  onClose,
}: InkFigureEditorProps) {
  const [cropping, setCropping] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<HTMLDivElement | null>(null);
  const visible = useVisibleWindow(editorRef);
  const [popoverRef, popoverWidth] = usePopoverWidth();

  // Focus the frame on open so the keys work without a click.
  useEffect(() => {
    if (!cropping) rootRef.current?.focus({ preventScroll: true });
  }, [index, cropping]);

  const { begin, move, end } = useFrameDrag(
    scale,
    useCallback(
      (held, dx, dy, event) => {
        if (held.handle === "move") {
          // A move keeps the box and goes where the pointer goes, clamped so
          // at least half of it stays on the paper.
          onChange({
            x: Math.round(
              Math.min(Math.max(held.box.x + dx, -held.box.w / 2), pageSize.width - held.box.w / 2),
            ),
            y: Math.round(
              Math.min(Math.max(held.box.y + dy, -held.box.h / 2), pageSize.height - held.box.h / 2),
            ),
            w: held.box.w,
            h: held.box.h,
            crop: figure.crop,
          });
          return;
        }
        onChange({
          ...resizeFigureBox(held.box, held.handle, dx, dy, { free: event.shiftKey }),
          crop: figure.crop,
        });
      },
      [figure.crop, onChange, pageSize.height, pageSize.width],
    ),
    useCallback(
      () => ({ x: figure.x, y: figure.y, w: figure.w, h: figure.h }),
      [figure.h, figure.w, figure.x, figure.y],
    ),
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      const step = event.shiftKey ? 100 : 10;
      const nudge = (dx: number, dy: number) => {
        event.preventDefault();
        onChange({ x: figure.x + dx, y: figure.y + dy, w: figure.w, h: figure.h, crop: figure.crop });
      };
      if (event.key === "ArrowLeft") nudge(-step, 0);
      else if (event.key === "ArrowRight") nudge(step, 0);
      else if (event.key === "ArrowUp") nudge(0, -step);
      else if (event.key === "ArrowDown") nudge(0, step);
      else if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        onRemove();
      } else if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      } else if (event.key === "]" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        onReorder(event.shiftKey ? "front" : "forward");
      } else if (event.key === "[" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        onReorder(event.shiftKey ? "back" : "backward");
      }
    },
    [figure, onChange, onClose, onRemove, onReorder],
  );

  if (cropping) {
    return (
      <InkFigureCropTool
        figure={figure}
        scale={scale}
        imageUrl={imageUrl}
        onApply={(next) => {
          onChange(next);
          setCropping(false);
        }}
        onCancel={() => setCropping(false)}
      />
    );
  }

  const px = {
    left: figure.x * scale,
    top: figure.y * scale,
    width: figure.w * scale,
    height: figure.h * scale,
  };
  const cropped = figure.crop !== undefined && figure.crop.some((n) => n > 0);
  const atTop = index >= count - 1;
  const atBottom = index <= 0;
  return (
    <div className="ink-figure-editor" ref={editorRef}>
      <div
        ref={rootRef}
        className="ink-figure-frame"
        role="group"
        aria-label={`Image ${index + 1} of ${count}, selected`}
        tabIndex={0}
        style={px}
        onPointerDown={(event) => begin(event, "move")}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onKeyDown={onKeyDown}
        onDoubleClick={() => setCropping(true)}
      >
        <FrameHandles begin={begin} move={move} end={end} />
      </div>
      <div
        ref={popoverRef}
        className="ink-figure-popover"
        role="toolbar"
        aria-label="This image"
        style={popoverStyle(px, visible, popoverWidth)}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <button type="button" className="ink-figure-button" title="Crop (double-click)" onClick={() => setCropping(true)}>
          Crop
        </button>
        {cropped ? (
          <button
            type="button"
            className="ink-figure-button"
            title="Show the whole image again"
            onClick={() => onChange({ ...uncroppedFigureBox(figure), crop: undefined })}
          >
            Uncrop
          </button>
        ) : null}
        <span className="ink-figure-sep" />
        <button
          type="button"
          className="ink-figure-button"
          title="Bring forward (Ctrl+])"
          disabled={atTop}
          onClick={() => onReorder("forward")}
        >
          Forward
        </button>
        <button
          type="button"
          className="ink-figure-button"
          title="Send backward (Ctrl+[)"
          disabled={atBottom}
          onClick={() => onReorder("backward")}
        >
          Backward
        </button>
        <button
          type="button"
          className="ink-figure-button"
          title="Bring to front (Ctrl+Shift+])"
          disabled={atTop}
          onClick={() => onReorder("front")}
        >
          Front
        </button>
        <button
          type="button"
          className="ink-figure-button"
          title="Send to back (Ctrl+Shift+[)"
          disabled={atBottom}
          onClick={() => onReorder("back")}
        >
          Back
        </button>
        <span className="ink-figure-sep" />
        <button
          type="button"
          className="ink-figure-button ink-figure-button-remove"
          title="Remove (Delete)"
          onClick={onRemove}
        >
          Remove
        </button>
        <button type="button" className="ink-figure-button" title="Done (Esc)" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}

/**
 * The crop tool, in place: the whole picture is shown where it would sit
 * with the crop lifted, dimmed, and the kept rectangle is drawn over it with
 * its own handles. Apply makes the kept rectangle the figure's box — what
 * was visible stays where it was — and writes the rest as insets. The file
 * is never touched.
 */
function InkFigureCropTool({
  figure,
  scale,
  imageUrl,
  onApply,
  onCancel,
}: {
  figure: FigureGeometry;
  scale: number;
  imageUrl: string | undefined;
  onApply: (next: Pick<FigureGeometry, "x" | "y" | "w" | "h" | "crop">) => void;
  onCancel: () => void;
}) {
  const full = useMemo(() => uncroppedFigureBox(figure), [figure]);
  const [kept, setKept] = useState({ x: figure.x, y: figure.y, w: figure.w, h: figure.h });
  const rootRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<HTMLDivElement | null>(null);
  const visible = useVisibleWindow(editorRef);
  const [popoverRef, popoverWidth] = usePopoverWidth();
  useEffect(() => {
    rootRef.current?.focus({ preventScroll: true });
  }, []);

  const clampKept = useCallback(
    (box: { x: number; y: number; w: number; h: number }) => {
      // The kept rectangle stays inside the picture: there is nothing to keep
      // outside it.
      const w = Math.min(box.w, full.w);
      const h = Math.min(box.h, full.h);
      const x = Math.min(Math.max(box.x, full.x), full.x + full.w - w);
      const y = Math.min(Math.max(box.y, full.y), full.y + full.h - h);
      return { x, y, w, h };
    },
    [full],
  );

  const { begin, move, end } = useFrameDrag(
    scale,
    useCallback(
      (held, dx, dy) => {
        if (held.handle === "move") {
          setKept(clampKept({ ...held.box, x: held.box.x + dx, y: held.box.y + dy }));
          return;
        }
        // Crop handles are always free: a crop chooses a region, not a size.
        setKept(clampKept(resizeFigureBox(held.box, held.handle, dx, dy, { free: true, min: 20 })));
      },
      [clampKept],
    ),
    useCallback(() => kept, [kept]),
  );

  const apply = () => onApply(cropFigureTo(full, kept));
  const fullPx = { left: full.x * scale, top: full.y * scale, width: full.w * scale, height: full.h * scale };
  const keptPx = { left: kept.x * scale, top: kept.y * scale, width: kept.w * scale, height: kept.h * scale };
  return (
    <div
      className="ink-figure-editor is-cropping"
      ref={editorRef}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onCancel();
        } else if (event.key === "Enter") {
          event.preventDefault();
          apply();
        }
      }}
    >
      {/* The whole picture, dimmed, where it would sit uncropped. */}
      <div className="ink-figure-crop-full" style={fullPx}>
        {imageUrl ? (
          // A `blob:` URL of our own making — see the note at the first `<img>`.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt="" draggable={false} />
        ) : (
          <div className="ink-figure-pending" />
        )}
      </div>
      {/* The kept rectangle, at full brightness: the picture again, clipped. */}
      <div
        ref={rootRef}
        className="ink-figure-frame ink-figure-crop-kept"
        role="group"
        aria-label="Crop: the part of the image to keep"
        tabIndex={0}
        style={keptPx}
        onPointerDown={(event) => begin(event, "move")}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      >
        {/* The clip is its own box so the handles on the edges are not cut. */}
        <div className="ink-figure-crop-clip">
          {imageUrl ? (
            // A `blob:` URL of our own making — see the note at the first `<img>`.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageUrl}
              alt=""
              draggable={false}
              style={{
                left: fullPx.left - keptPx.left,
                top: fullPx.top - keptPx.top,
                width: fullPx.width,
                height: fullPx.height,
              }}
            />
          ) : null}
        </div>
        <FrameHandles begin={begin} move={move} end={end} />
      </div>
      <div
        ref={popoverRef}
        className="ink-figure-popover"
        role="toolbar"
        aria-label="Crop this image"
        style={popoverStyle(keptPx, visible, popoverWidth)}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <span className="ink-figure-hint">Drag the handles to choose what stays</span>
        <button
          type="button"
          className="ink-figure-button"
          title="Keep the whole image"
          onClick={() => setKept({ x: full.x, y: full.y, w: full.w, h: full.h })}
        >
          All
        </button>
        <button type="button" className="ink-figure-button" title="Apply (Enter)" onClick={apply}>
          Apply
        </button>
        <button type="button" className="ink-figure-button" title="Cancel (Esc)" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/**
 * A default box for a figure whose first placement is a drop: the image's own
 * aspect on a half-width of the page, centred where the drop landed and then
 * clamped onto the paper — a drop at an edge lands the figure against that
 * edge rather than half off the page.
 */
export function figureBoxForAspect(
  aspect: number,
  at: { x: number; y: number },
  pageSize: { width: number; height: number },
): { x: number; y: number; w: number; h: number } {
  const w = Math.round(Math.min(pageSize.width * 0.5, pageSize.width));
  const h = Math.round(w / Math.max(aspect, 0.01));
  const clamp = (value: number, low: number, high: number) =>
    Math.min(high, Math.max(low, value));
  return {
    x: Math.round(clamp(at.x - w / 2, 0, Math.max(0, pageSize.width - w))),
    y: Math.round(clamp(at.y - h / 2, 0, Math.max(0, pageSize.height - h))),
    w,
    h,
  };
}
