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

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import {
  INK_COLOURS,
  INK_PEN_WIDTHS,
  INK_HIGHLIGHTER_WIDTH,
  type InkHand,
  INK_PAPERS,
  type InkPaper,
} from "@weaveforge/core";

import { paperLabel, toolIcon, toolLabel } from "./ink-bar-glyphs";

export { toolLabel } from "./ink-bar-glyphs";

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
  /** The note's paper (§6.2.12); the layout menu shows and sets it. */
  paper: InkPaper;
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
  onPaper: (value: InkPaper) => void;
  onRecognise: () => void;
  /**
   * The three ways out of a page, behind one button: the browser's own print
   * dialog (which is also "save as PDF"), the page as a high-resolution PNG,
   * and the page as vector SVG.
   *
   * There is no screenshot button: the operating system already takes
   * screenshots, and what a page of ink is for is being printed.
   */
  onPrint: () => void;
  onExportPng: () => void;
  onExportSvg?: () => void;
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
  paper,
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
  onPaper,
  onRecognise,
  onPrint,
  onExportPng,
  onExportSvg,
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
  /**
   * Which menu is open, print or paper — at most one. The bar's own state,
   * about the bar rather than the document: nothing behind it is read.
   */
  const [menu, setMenu] = useState<"print" | "paper" | null>(null);
  const printMenu = menu === "print";
  const paperMenu = menu === "paper";
  const printMenuRef = useRef<HTMLDivElement>(null);
  const printListRef = useRef<HTMLDivElement>(null);
  /**
   * Folded, in focus mode: the palette shrinks to the tools and its own
   * handle, OneNote's way, so the paper is all there is until a hand wants
   * more. Outside focus the handle is hidden and the flag does nothing.
   */
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    if (!menu) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!printMenuRef.current?.contains(event.target as Node)) setMenu(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(null);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menu]);

  /**
   * Keep the open menu inside the toolbar's own box.
   *
   * The bar wraps, so the print button is at the left end of a row on a narrow
   * pane and at the right end of one on a wide one — a fixed `left` or `right`
   * therefore hangs the list off the edge about half the time, and the pane
   * clips it (`overflow: hidden`, so a floating menu cannot escape it). Measured
   * rather than guessed, before the paint, and clamped to the bar rather than to
   * the window because the bar is what the clipping ancestor is sized to.
   */
  useLayoutEffect(() => {
    if (!menu) return;
    const list = printListRef.current;
    const bar = list?.closest(".ink-bar");
    if (!list || !bar) return;
    const box = list.getBoundingClientRect();
    const bounds = bar.getBoundingClientRect();
    const margin = 8;
    let shift = 0;
    if (box.left < bounds.left + margin) shift = bounds.left + margin - box.left;
    else if (box.right > bounds.right - margin) {
      shift = bounds.right - margin - box.right;
    }
    list.style.setProperty("--ink-menu-shift", `${Math.round(shift)}px`);
  }, [menu]);

  /** Close the menu, then run what was chosen. */
  const choose = (run: () => void) => () => {
    setMenu(null);
    run();
  };

  return (
    <div
      className="ink-bar"
      role="toolbar"
      aria-label="Ink tools"
      data-collapsed={collapsed || undefined}
    >
      {/* 0. Fold handle: focus mode only (CSS), the palette's own chevron */}
      <button
        type="button"
        className="ink-tool ink-tool-icon-only ink-bar-collapse"
        onClick={() => setCollapsed((was) => !was)}
        aria-expanded={!collapsed}
        title={collapsed ? "Show all tools" : "Fold the tools away"}
        aria-label={collapsed ? "Show all tools" : "Fold the tools away"}
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
          {collapsed ? <path d="M9 6l6 6-6 6" /> : <path d="M15 6l-6 6 6 6" />}
        </svg>
      </button>

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
          const dotSize = 3 + entry;
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
        <span className="ink-page-count" aria-label={`Page ${page} of ${pages}`}>
          <span className="ink-page-now">{page}</span>
          <span className="ink-page-sep" aria-hidden="true">/</span>
          <span className="ink-page-total">{pages}</span>
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
            {/* An image with a plus on its corner, so it cannot be mistaken
                for the print button, which used to share this picture. */}
            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7" />
            <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
            <circle cx="9" cy="9" r="2" />
            <path d="M16 5h6M19 2v6" />
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

      {/* 7. Print: the page on paper, as a PNG, or as SVG */}
      <div className="ink-menu" ref={printMenu ? printMenuRef : undefined}>
        <button
          type="button"
          className="ink-tool ink-tool-icon-only"
          onClick={() => setMenu((was) => (was === "print" ? null : "print"))}
          aria-haspopup="menu"
          aria-expanded={printMenu}
          title="Print or export this page (⌘⇧P)"
          aria-label="Print or export this page"
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
            <path d="M6 9V3h12v6" />
            <path d="M6 18H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2" />
            <rect x="6" y="14" width="12" height="8" rx="1" />
          </svg>
        </button>
        {printMenu ? (
          <div
            className="ink-menu-list"
            role="menu"
            aria-label="Print or export"
            ref={printListRef}
          >
            <button
              type="button"
              role="menuitem"
              className="ink-menu-item"
              onClick={choose(onPrint)}
            >
              Print or save as PDF
              <kbd>⌘⇧P</kbd>
            </button>
            <button
              type="button"
              role="menuitem"
              className="ink-menu-item"
              onClick={choose(onExportPng)}
            >
              Full-page PNG
              <kbd>⌘⇧E</kbd>
            </button>
            {onExportSvg ? (
              <button
                type="button"
                role="menuitem"
                className="ink-menu-item"
                onClick={choose(onExportSvg)}
              >
                Vector SVG
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* 7b. Page layout: the paper under the ink */}
      <div className="ink-menu ink-menu-paper" ref={paperMenu ? printMenuRef : undefined}>
        <button
          type="button"
          className="ink-tool ink-tool-icon-only"
          onClick={() => setMenu((was) => (was === "paper" ? null : "paper"))}
          aria-haspopup="menu"
          aria-expanded={paperMenu}
          title={`Page layout: ${paperLabel(paper)}`}
          aria-label={`Page layout: ${paperLabel(paper)}`}
        >
          <span className={`ink-paper-preview paper-${paper}`} aria-hidden="true" />
        </button>
        {paperMenu ? (
          <div
            className="ink-menu-list"
            role="menu"
            aria-label="Page layout"
            ref={printListRef}
          >
            {INK_PAPERS.map((entry) => (
              <button
                key={entry}
                type="button"
                role="menuitemradio"
                aria-checked={paper === entry}
                className="ink-menu-item"
                onClick={choose(() => onPaper(entry))}
              >
                <span className={`ink-paper-preview paper-${entry}`} aria-hidden="true" />
                {paperLabel(entry)}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {/* 8. Text Layer Toggle */}
      {onToggleTextLayer ? (
        <button
          type="button"
          className="ink-tool ink-tool-icon-only"
          onClick={onToggleTextLayer}
          aria-pressed={showTextLayer}
          title={
            showTextLayer ? "Hide text layer" : "Show text layer"
          }
          aria-label={
            showTextLayer ? "Hide text layer" : "Show text layer"
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
