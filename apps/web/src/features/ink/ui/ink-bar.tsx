"use client";

/**
 * The ink bar: every tool, in one row, with the page and pen state at its end.
 *
 * §6.1's layout, and the whole of §6.3's tool table as data. The bar owns no
 * document state — it is handed the tool in force and says what the user asked for
 * — so it can be rendered in a test with nothing behind it, and so the ink host
 * stays the only place that decides what a tool *means*.
 *
 * The three widths and three colours are the plan's "3 token colours, 3 widths";
 * the widths are the pen's, in 0.1 mm, and a highlighter ignores them because its
 * nib is the tool's (§6.3).
 */

import {
  INK_COLOURS,
  INK_PEN_WIDTHS,
  INK_HIGHLIGHTER_WIDTH,
  type InkHand,
} from "@weaveforge/core";

/** The tools the bar offers, in the order the plan's sketch draws them. */
export const INK_BAR_TOOLS = ["pen", "highlighter", "eraser", "lasso"] as const;
export type InkBarTool = (typeof INK_BAR_TOOLS)[number];

/** What the highlighter's width is, whatever the pen widths say. */
export const HIGHLIGHTER_NIB = INK_HIGHLIGHTER_WIDTH;

/**
 * The nib a tool draws with.
 *
 * A highlighter is 6 mm because its tool says so; the eraser and the lasso do not
 * draw at all, so their width is only ever read by a test or a status line.
 */
export function nibForTool(
  tool: InkBarTool | "shape",
  penWidth: number,
): number {
  if (tool === "highlighter") return HIGHLIGHTER_NIB;
  if (tool === "eraser") return 0;
  return penWidth;
}

export interface InkBarProps {
  tool: InkBarTool | "shape";
  colour: (typeof INK_COLOURS)[number];
  /** The pen's width, in 0.1 mm. */
  width: number;
  page: number;
  pages: number;
  strokes: number;
  /** Mean recognition confidence, 0 when the page has never been recognised. */
  recognised: number;
  penOnly: boolean;
  /** Which hand writes; the palm quadrant rule reads it (§3.3). */
  hand: InkHand;
  /** Whether the OS is drawing the wet tail (§6.2.6), for the readout. */
  delegating?: boolean;
  penSeen: boolean;
  /** The renderer actually drawing, for the readout at the end of the bar. */
  backend: string | null;
  /** A recognition run is on; the button says so and refuses a second. */
  busy?: boolean;
  /** "line 3 of 12" while a run is on. */
  progress?: string | null;
  canUndo?: boolean;
  canRedo?: boolean;
  /** How many strokes the lasso holds; the selection tools show only then. */
  selected?: number;
  showTextLayer?: boolean;
  onToggleTextLayer?: () => void;
  onTool: (tool: InkBarTool | "shape") => void;
  onColour: (colour: (typeof INK_COLOURS)[number]) => void;
  onWidth: (width: number) => void;
  onPenOnly: (value: boolean) => void;
  onHand: (value: InkHand) => void;
  onRecognise: () => void;
  onExport: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onAddPage: () => void;
  /** Add an image to the current page as background (§4.8). */
  onAddImage?: () => void;
  /** Whether the current page has a background image. */
  hasPageBackground?: boolean;
  /** Remove the background image from the current page. */
  onRemovePageBackground?: () => void;
  /** Insert a PDF page or an image as a new page's background (§4.8); absent, no button. */
  onInsertPage?: () => void;
  onPrevPage: () => void;
  onNextPage: () => void;
  onDeleteSelection?: () => void;
  onCopyAsText?: () => void;
}

/** The label a tool shows. `shape` is reachable by chord and by hold, not by tool. */
export function toolLabel(tool: InkBarTool | "shape"): string {
  switch (tool) {
    case "pen":
      return "Pen";
    case "highlighter":
      return "Highlighter";
    case "eraser":
      return "Eraser";
    case "lasso":
      return "Lasso";
    case "shape":
      return "Shape";
  }
}

function toolIcon(tool: InkBarTool) {
  switch (tool) {
    case "pen":
      return (
        <svg
          width="17"
          height="17"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
          <path d="m15 5 4 4" />
        </svg>
      );
    case "highlighter":
      return (
        <svg
          width="17"
          height="17"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m9 11-6 6v3h3l6-6" />
          <path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4" />
        </svg>
      );
    case "eraser":
      return (
        <svg
          width="17"
          height="17"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21" />
          <path d="M22 21H7" />
          <path d="m5 11 9 9" />
        </svg>
      );
    case "lasso":
      return (
        <svg
          width="17"
          height="17"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M7 22a5 5 0 0 1-2-4" />
          <path d="M3.3 14A6.8 6.8 0 0 1 2 10c0-4.4 4.5-8 10-8s10 3.6 10 8-4.5 8-10 8a12 12 0 0 1-5-1" />
          <path d="M5 18a2 2 0 1 0 0-4 2 2 0 0 0 0 4z" />
        </svg>
      );
  }
}

export function InkBar({
  tool,
  colour,
  width,
  page,
  pages,
  strokes,
  recognised,
  penOnly,
  hand,
  delegating,
  penSeen,
  backend,
  busy,
  progress,
  canUndo = true,
  canRedo = true,
  selected = 0,
  showTextLayer = false,
  onToggleTextLayer,
  onTool,
  onColour,
  onWidth,
  onPenOnly,
  onHand,
  onRecognise,
  onExport,
  onUndo,
  onRedo,
  onAddPage,
  onAddImage,
  hasPageBackground = false,
  onRemovePageBackground,
  onInsertPage,
  onPrevPage,
  onNextPage,
  onDeleteSelection,
  onCopyAsText,
}: InkBarProps) {
  return (
    <div className="ink-bar" role="toolbar" aria-label="Ink tools">
      {/* 1. Drawing Tools Segmented Pill */}
      <div
        className="ink-bar-group ink-bar-tools"
        role="radiogroup"
        aria-label="Drawing tools"
      >
        {INK_BAR_TOOLS.map((entry) => (
          <button
            key={entry}
            type="button"
            className="ink-tool ink-tool-icon-only"
            aria-pressed={tool === entry}
            aria-label={`${toolLabel(entry)} (${entry[0]!.toUpperCase()})`}
            title={`${toolLabel(entry)} (${entry[0]!.toUpperCase()})`}
            onClick={() => onTool(entry)}
          >
            {toolIcon(entry)}
          </button>
        ))}
      </div>

      <span className="ink-sep" aria-hidden="true" />

      {/* 2. Full 6-Color Swatches Palette */}
      <div className="ink-swatches" role="radiogroup" aria-label="Ink color">
        {INK_COLOURS.map((entry) => (
          <button
            key={entry}
            type="button"
            className={`ink-swatch ink-swatch-${entry}`}
            aria-pressed={colour === entry}
            aria-label={`Ink colour: ${entry}`}
            title={`Ink colour: ${entry}`}
            onClick={() => onColour(entry)}
          />
        ))}
      </div>

      <span className="ink-sep" aria-hidden="true" />

      {/* 3. Nib Width Dots */}
      <div
        className="ink-bar-group ink-bar-widths"
        title="Pen nib width"
        style={{ opacity: tool === "pen" ? 1 : 0.45 }}
      >
        {INK_PEN_WIDTHS.map((entry) => {
          const dotSize = entry <= 3 ? 4 : entry <= 6 ? 7 : 10;
          return (
            <button
              key={entry}
              type="button"
              className="ink-tool ink-tool-icon-only ink-tool-nib"
              aria-pressed={width === entry && tool === "pen"}
              aria-label={`Nib ${(entry / 10).toFixed(1)} mm`}
              title={`Nib ${(entry / 10).toFixed(1)} mm`}
              onClick={() => onWidth(entry)}
            >
              <span
                className="ink-nib-dot"
                style={{ width: `${dotSize}px`, height: `${dotSize}px` }}
              />
            </button>
          );
        })}
      </div>

      <span className="ink-sep" aria-hidden="true" />

      {/* 4. Undo / Redo */}
      <div className="ink-bar-group">
        <button
          type="button"
          className="ink-tool ink-tool-icon-only"
          onClick={onUndo}
          disabled={!canUndo}
          title="Undo (⌘Z)"
          aria-label="Undo"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M3 7v6h6" />
            <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
          </svg>
        </button>
        <button
          type="button"
          className="ink-tool ink-tool-icon-only"
          onClick={onRedo}
          disabled={!canRedo}
          title="Redo (⌘⇧Z)"
          aria-label="Redo"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M21 7v6h-6" />
            <path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7" />
          </svg>
        </button>
      </div>

      {/* Lasso Selection Actions */}
      {selected > 0 ? (
        <>
          <span className="ink-sep" aria-hidden="true" />
          <div className="ink-bar-group">
            <button
              type="button"
              className="ink-tool"
              onClick={onCopyAsText}
              title="Copy the selected strokes' recognised text"
            >
              Copy as text
            </button>
            <button
              type="button"
              className="ink-tool"
              onClick={onDeleteSelection}
              title="Delete the selected strokes (Delete)"
            >
              Delete ({selected})
            </button>
          </div>
        </>
      ) : null}

      <span className="ink-sep" aria-hidden="true" />

      {/* 5. Page Switcher & Add Page */}
      <div className="ink-page-pill">
        <button
          type="button"
          className="ink-tool ink-tool-icon-only"
          onClick={onPrevPage}
          disabled={page <= 1}
          title="Previous page"
          aria-label="Previous page"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>
        <span className="ink-page-count">
          {page} / {pages}
        </span>
        <button
          type="button"
          className="ink-tool ink-tool-icon-only"
          onClick={onNextPage}
          disabled={page >= pages}
          title="Next page"
          aria-label="Next page"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="m9 18 6-6-6-6" />
          </svg>
        </button>
      </div>

      <button
        type="button"
        className="ink-tool ink-tool-icon-only"
        onClick={onAddPage}
        title="Add new page"
        aria-label="Add new page"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>

      {onAddImage ? (
        <button
          type="button"
          className="ink-tool ink-tool-icon-only"
          onClick={onAddImage}
          title={
            hasPageBackground
              ? "Change page image (or paste / drop)"
              : "Add image to page (or paste / drop)"
          }
          aria-label={
            hasPageBackground ? "Change page image" : "Add image to page"
          }
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
            <circle cx="9" cy="9" r="2" />
            <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
          </svg>
        </button>
      ) : null}

      {hasPageBackground && onRemovePageBackground ? (
        <button
          type="button"
          className="ink-tool ink-tool-icon-only"
          onClick={onRemovePageBackground}
          title="Remove page image"
          aria-label="Remove page image"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="m3 3 18 18" />
            <path d="M15 9h.01" />
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L12 15" />
          </svg>
        </button>
      ) : null}

      {onInsertPage ? (
        <button
          type="button"
          className="ink-tool ink-tool-icon-only"
          onClick={onInsertPage}
          title="Insert page from PDF or image"
          aria-label="Insert page from PDF or image"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <path d="M14 2v6h6" />
            <path d="M12 18v-6M9 15h6" />
          </svg>
        </button>
      ) : null}

      <span className="ink-sep" aria-hidden="true" />

      {/* 6. OCR Recognise */}
      <button
        type="button"
        className="ink-tool ink-action-recognise"
        onClick={onRecognise}
        disabled={busy}
        title="Recognise this page (⌘⇧R)"
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z" />
        </svg>
        <span>{busy ? (progress ?? "Recognising…") : "Recognise"}</span>
      </button>

      {/* 7. Export PNG */}
      <button
        type="button"
        className="ink-tool ink-tool-icon-only"
        onClick={onExport}
        title="Export page PNG (⌘⇧E)"
        aria-label="Export page PNG"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect width="18" height="18" x="3" y="3" rx="2" />
          <circle cx="9" cy="9" r="2" />
          <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
        </svg>
      </button>

      {/* 8. Text Layer Toggle */}
      {onToggleTextLayer ? (
        <button
          type="button"
          className="ink-tool ink-tool-icon-only"
          onClick={onToggleTextLayer}
          aria-pressed={showTextLayer}
          title={
            showTextLayer ? "Hide recognized text" : "Show recognized text"
          }
          aria-label={
            showTextLayer ? "Hide recognized text" : "Show recognized text"
          }
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect width="18" height="18" x="3" y="3" rx="2" />
            <path d="M15 3v18" />
            <path d="M7 8h4M7 12h4M7 16h2" />
          </svg>
        </button>
      ) : null}

      <span className="ink-sep" aria-hidden="true" />

      {/* 9. Wrist Guard & Handedness */}
      <label
        className="ink-pen-only"
        title="Ignore touch entirely; the wrist guard"
      >
        <input
          type="checkbox"
          className="themed-check"
          checked={penOnly}
          onChange={(event) => onPenOnly(event.target.checked)}
        />
        <span>Pen only</span>
      </label>

      <button
        type="button"
        className="ink-tool ink-tool-hand"
        onClick={() => onHand(hand === "right" ? "left" : "right")}
        title="Which hand writes: the resting palm is expected on that side"
        aria-label={`Writing hand: ${hand}`}
      >
        {hand === "right" ? "Right hand" : "Left hand"}
      </button>

      <span className="ink-bar-spacer" />

      {/* 10. End Readout */}
      <span className="ink-readout" data-backend={backend ?? "starting"}>
        p.{page}/{pages} · {strokes} {strokes === 1 ? "stroke" : "strokes"} ·{" "}
        {penSeen ? "pen" : "pointer"} · {Math.round(recognised * 100)}%
        {backend && backend !== "webgl2" ? ` · ${backend}` : ""}
        {delegating ? " · delegated" : ""}
      </span>
    </div>
  );
}
