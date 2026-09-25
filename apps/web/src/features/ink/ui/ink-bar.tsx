"use client";

/**
 * The ink bar: every tool, in one row, with the page and pen state at its end.
 *
 * One row: tools, the pen (colour and nib behind one swatch), undo, the page
 * and the zoom. Everything done less than once a page sits behind ⋯
 * (`ink-bar-more.tsx`). §6.1's tools, and the whole of §6.3's tool table as data. The bar owns no
 * document state — it is handed the tool in force and says what the user asked for
 * — so it can be rendered in a test with nothing behind it, and so the ink host
 * stays the only place that decides what a tool *means*.
 *
 * It is one bar for both surfaces that carry ink: the note hands it the whole
 * of its state, the PDF reader hands it the pen's, and a section whose props are
 * absent is simply not drawn. Its two drop-downs live in `ink-bar-menus.tsx`;
 * its glyphs in `ink-bar-glyphs.tsx`.
 *
 * The widths and colours are the plan's; the widths are the pen's, in 0.1 mm,
 * and a highlighter ignores them because its nib is the tool's (§6.3).
 */

import { useState } from "react";

import {
  INK_COLOURS,
  INK_MARKER_COLOURS,
  INK_THEME_COLOURS,
  INK_PEN_WIDTHS,
  INK_HIGHLIGHTER_WIDTH,
  type InkHand,
  type InkPaper,
} from "@weaveforge/core";

import { toolIcon, toolLabel } from "./ink-bar-glyphs";
import { MoreMenu, type InkPageGap } from "./ink-bar-more";
import { PaletteDockButton, PaletteFoldButton, usePaletteDock } from "@/components/palette-dock";
import { Popover } from "@/components/popover";

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
  /**
   * Everything below is optional, and a section whose props are absent is not
   * drawn. That is what makes this one bar rather than two: the ink note hands
   * it the whole of its state — pages, paper, recognition, export — while the
   * PDF reader, whose ink is a page of a document it does not own, hands it the
   * pen's state alone. The tools, the colours, the nibs, undo, the fold and the
   * move handle are then the same code on both surfaces.
   */
  page?: number;
  pages?: number;
  strokes?: number;
  /** Mean recognition confidence, 0 when the page has never been recognised. */
  recognised?: number;
  penOnly?: boolean;
  /** Which hand writes; the palm quadrant rule reads it (§3.3). */
  hand?: InkHand;
  /** The note's paper (§6.2.12); the layout menu shows and sets it. */
  paper?: InkPaper;
  /** Whether the OS is drawing the wet tail (§6.2.6), for the readout. */
  delegating?: boolean;
  penSeen?: boolean;
  /** The renderer actually drawing, for the readout at the end of the bar. */
  backend?: string | null;
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
  onPenOnly?: (value: boolean) => void;
  onHand?: (value: InkHand) => void;
  onPaper?: (value: InkPaper) => void;
  onRecognise?: () => void;
  /**
   * The three ways out of a page, behind one button: the browser's own print
   * dialog (which is also "save as PDF"), the page as a high-resolution PNG,
   * and the page as vector SVG.
   *
   * There is no screenshot button: the operating system already takes
   * screenshots, and what a page of ink is for is being printed.
   */
  onPrint?: () => void;
  onExportPng?: () => void;
  onExportSvg?: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onAddPage?: () => void;
  /** Add an image to the current page as background (§4.8). */
  onAddImage?: () => void;
  /** Whether the current page has a background image. */
  hasPageBackground?: boolean;
  /** Remove the background image from the current page. */
  onRemovePageBackground?: () => void;
  /** Insert a PDF page or an image as a new page's background (§4.8); absent, no button. */
  onInsertPage?: () => void;
  onPrevPage?: () => void;
  onNextPage?: () => void;
  onDeleteSelection?: () => void;
  onCopyAsText?: () => void;
  /** The room between pages; absent, the ⋯ menu offers no spacing. */
  pageGap?: InkPageGap;
  onPageGap?: (gap: InkPageGap) => void;
  /** The note's zoom, 1 = fit width; absent, no zoom pill. */
  zoom?: number;
  onZoom?: (zoom: number) => void;
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
  pageGap,
  onPageGap,
  zoom,
  onZoom,
}: InkBarProps) {
  /**
   * Folded, in focus mode: the palette shrinks to the tools and its own
   * handle, OneNote's way, so the paper is all there is until a hand wants
   * more. Outside focus the handle is hidden and the flag does nothing. The
   * dock — which edge or corner the palette floats at — is the same story, and
   * is shared with the reader, because it is the same palette
   * (`palette-dock.tsx`).
   */
  const [collapsed, setCollapsed] = useState(false);
  const [dock, setDock] = usePaletteDock();

  return (
    <div
      className="ink-bar ink-palette"
      role="toolbar"
      aria-label="Ink tools"
      data-collapsed={collapsed || undefined}
      data-dock={dock}
    >
      {/* 0. Handles, focus mode only (CSS): move the palette, fold it */}
      <div className="ink-palette-handles">
        <PaletteDockButton dock={dock} onDock={setDock} />
        <PaletteFoldButton collapsed={collapsed} onToggle={() => setCollapsed((was) => !was)} />
      </div>

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

      <span className="ink-sep" aria-hidden="true" />

      {/* 2. The pen: colour and nib behind one swatch. The trigger shows both —
          the colour as the swatch, the nib as the dot on it — so what the next
          stroke will look like is readable without opening anything. The class
          stays `ink-swatches` so the docked focus palette keeps it. */}
      <div className="ink-swatches ink-pen-pick">
        <Popover
          iconOnly
          ariaLabel="Pen colour and nib"
          triggerClassName="colour-menu-trigger ink-pen-trigger"
          label={
            <span className={`ink-swatch colour-menu-current ink-swatch-${colour}`} aria-hidden>
              {tool === "pen" ? (
                <span
                  className="ink-pen-trigger-nib"
                  style={{ width: `${3 + width}px`, height: `${3 + width}px` }}
                />
              ) : null}
            </span>
          }
        >
          {(close) => (
            <div className="colour-menu ink-pen-menu">
              {[INK_THEME_COLOURS, INK_MARKER_COLOURS].map((row, i) => (
                <div
                  key={i}
                  className="colour-menu-row"
                  role="group"
                  aria-label={i === 0 ? "Theme colours" : "Marker colours"}
                >
                  {row.map((entry) => (
                    <button
                      key={entry}
                      type="button"
                      className={`ink-swatch ink-swatch-${entry}`}
                      aria-pressed={colour === entry}
                      aria-label={`Ink colour: ${entry}`}
                      title={`Ink colour: ${entry}`}
                      onClick={() => {
                        onColour(entry);
                        close();
                      }}
                    />
                  ))}
                </div>
              ))}
              <div className="colour-menu-row ink-bar-widths" role="group" aria-label="Pen nib width">
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
            </div>
          )}
        </Popover>
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

      {/* Lasso Selection Actions. Each button is drawn only when its surface
          can do that thing: recognising a page's handwriting is the note's
          (`onCopyAsText`), deleting marks is both surfaces'. */}
      {selected > 0 && (onCopyAsText || onDeleteSelection) ? (
        <>
          <span className="ink-sep" aria-hidden="true" />
          <div className="ink-bar-group">
            {onCopyAsText ? (
              <button
                type="button"
                className="ink-tool"
                onClick={onCopyAsText}
                title="Copy the selected strokes' recognised text"
              >
                Copy as text
              </button>
            ) : null}
            {onDeleteSelection ? (
              <button
                type="button"
                className="ink-tool"
                onClick={onDeleteSelection}
                title="Delete the selected strokes (Delete)"
              >
                Delete ({selected})
              </button>
            ) : null}
          </div>
        </>
      ) : null}

      {page !== undefined && pages !== undefined && onPrevPage && onNextPage ? (
        <>
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
        </>
      ) : null}

      {zoom !== undefined && onZoom ? (
        <>
          {/* 5b. Zoom: out, the level (click to fit), in */}
          <div className="ink-page-pill ink-zoom-pill">
            <button
              type="button"
              className="ink-tool ink-tool-icon-only"
              onClick={() => onZoom(Math.max(0.5, zoom / 1.2))}
              disabled={zoom <= 0.5}
              title="Zoom out"
              aria-label="Zoom out"
            >
              −
            </button>
            <button
              type="button"
              className="ink-page-count ink-zoom-level"
              onClick={() => onZoom(1)}
              title="Fit the page width"
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              type="button"
              className="ink-tool ink-tool-icon-only"
              onClick={() => onZoom(Math.min(4, zoom * 1.2))}
              disabled={zoom >= 4}
              title="Zoom in"
              aria-label="Zoom in"
            >
              +
            </button>
          </div>
        </>
      ) : null}

      {onRecognise ? (
        <>
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
        </>
      ) : null}

      <span className="ink-bar-spacer" />

      {/* 10. End Readout. Only the parts a surface actually has are printed, so
          the reader's page count and stroke count read the same way the note's
          do without inventing a recognition score it does not run. */}
      {page !== undefined || backend !== undefined ? (
        <span className="ink-readout" data-backend={backend ?? "starting"}>
          {page !== undefined && pages !== undefined ? `p.${page}/${pages}` : null}
          {page !== undefined && pages !== undefined && strokes !== undefined ? " · " : null}
          {strokes !== undefined
            ? `${strokes} ${strokes === 1 ? "stroke" : "strokes"}`
            : null}
          {penSeen !== undefined ? ` · ${penSeen ? "pen" : "pointer"}` : null}
          {recognised !== undefined ? ` · ${Math.round(recognised * 100)}%` : null}
          {backend && backend !== "webgl2" ? ` · ${backend}` : ""}
          {delegating ? " · delegated" : ""}
        </span>
      ) : null}

      {/* 11. Everything else: pages, paper, spacing, export, input */}
      <MoreMenu
        onAddPage={onAddPage}
        onAddImage={onAddImage}
        hasPageBackground={hasPageBackground}
        onRemovePageBackground={onRemovePageBackground}
        onInsertPage={onInsertPage}
        paper={paper}
        onPaper={onPaper}
        pageGap={pageGap}
        onPageGap={onPageGap}
        onPrint={onPrint}
        onExportPng={onExportPng}
        onExportSvg={onExportSvg}
        showTextLayer={showTextLayer}
        onToggleTextLayer={onToggleTextLayer}
        penOnly={penOnly}
        onPenOnly={onPenOnly}
        hand={hand}
        onHand={onHand}
      />
    </div>
  );
}
