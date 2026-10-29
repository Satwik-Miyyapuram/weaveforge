"use client";

/**
 * The ink bar: every tool, in one row, ⋯ at its end.
 *
 * One row: tools, five quick colours, the pen (every colour and the nib behind
 * one swatch), undo, the page, the zoom and Insert. Everything done less than
 * once a page sits behind ⋯
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

import { useState, type ReactNode } from "react";

import {
  INK_COLOURS,
  INK_MARKER_COLOURS,
  INK_THEME_COLOURS,
  INK_PEN_WIDTHS,
  INK_HIGHLIGHTER_WIDTH,
  INK_HIGHLIGHTER_WIDTHS,
  clampInkZoom,
  inkZoomIn,
  inkZoomOut,
  type InkHand,
  type InkPaper,
} from "@weaveforge/core";

import { toolIcon, toolLabel } from "./ink-bar-glyphs";
import { MoreMenu, type InkPageGap } from "./ink-bar-more";
import type { InkMenuAction, InkMenuSection } from "./ink-bar-menus";
import {
  InsertMenu,
  PagePill,
  PointerGlyph,
  ViewMenu,
  ZoomPill,
  hasInsertItems,
  type InkInsertTool,
  type ViewMenuProps,
} from "./ink-bar-view";
import { InkQuickColours } from "./ink-quick-colours";
import { INK_COLOUR_TOKENS } from "../render/ink-palette";
import { useQuickColours } from "./use-quick-colours";
import { PaletteDockButton, PaletteFoldButton, usePaletteDock } from "@/components/palette-dock";
import { Popover } from "@/components/popover";
import { shortcutLabel } from "@/lib/shortcut-label";
import { Button } from "@/components/button";
import { Swatch, ToolButton } from "@/components/controls";
import { useRovingToolbar } from "@/lib/hooks/use-roving-toolbar";

export { toolLabel } from "./ink-bar-glyphs";

/** The tools the bar offers, in the order the plan's sketch draws them. */
export const INK_BAR_TOOLS = ["pen", "highlighter", "eraser", "lasso"] as const;
export type InkBarTool = (typeof INK_BAR_TOOLS)[number];

/** What the highlighter's width is, whatever the pen widths say. */
export const HIGHLIGHTER_NIB = INK_HIGHLIGHTER_WIDTH;

/**
 * The nib a tool draws with.
 *
 * A highlighter draws with its own width (6 mm unless one of
 * `INK_HIGHLIGHTER_WIDTHS` is picked), never the pen's; the eraser and the lasso do not
 * draw at all, so their width is only ever read by a test or a status line.
 */
export function nibForTool(
  tool: InkBarTool | "shape",
  penWidth: number,
  highlighterWidth: number = HIGHLIGHTER_NIB,
): number {
  if (tool === "highlighter") return highlighterWidth;
  if (tool === "eraser") return 0;
  return penWidth;
}

export interface InkBarProps {
  tool: InkBarTool | "shape";
  colour: (typeof INK_COLOURS)[number];
  /** The pen's width, in 0.1 mm. */
  width: number;
  /** The highlighter's width, in 0.1 mm; the nib row shows its sizes while it is the tool. */
  highlighterWidth?: number;
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
  penOnly?: boolean;
  /** Which hand writes; the palm quadrant rule reads it (§3.3). */
  hand?: InkHand;
  /** The note's paper (§6.2.12); the layout menu shows and sets it. */
  paper?: InkPaper;
  /** The renderer actually drawing; kept on the bar as `data-backend` for probes. */
  backend?: string | null;
  /** A recognition run is on; the button says so and refuses a second. */
  busy?: boolean;
  /** "line 3 of 12" while a run is on. */
  progress?: string | null;
  canUndo?: boolean;
  canRedo?: boolean;
  showTextLayer?: boolean;
  onToggleTextLayer?: () => void;
  onTool: (tool: InkBarTool | "shape") => void;
  onColour: (colour: (typeof INK_COLOURS)[number]) => void;
  onWidth: (width: number) => void;
  /** Absent, the highlighter has the one fixed width and no size row. */
  onHighlighterWidth?: (width: number) => void;
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
  /** A paper's print, with or without its comments (the reader's ⋯). */
  onPrintPaper?: (withComments: boolean) => void;
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
  /** Lay a picture on the current page, over it rather than under it (the PDF reader). */
  onAddPicture?: () => void;
  /** The page takes a pasted or dropped picture; Insert says so. */
  takesPictureDrops?: boolean;
  onPrevPage?: () => void;
  onNextPage?: () => void;
  /** The room between pages; absent, the ⋯ menu offers no spacing. */
  pageGap?: InkPageGap;
  onPageGap?: (gap: InkPageGap) => void;
  /** The note's zoom, 1 = fit width; absent, no zoom pill. */
  zoom?: number;
  onZoom?: (zoom: number) => void;
  /**
   * The PDF reader's view: zoom, fits and rotation behind one drop-down that
   * shows the zoom. Handed over, it takes the zoom pill's place.
   */
  view?: ViewMenuProps;
  /** Type a page number; handed over, the page count becomes a field. */
  onGoToPage?: (page: number) => void;
  /**
   * Select — pick text to highlight, underline or comment on — as the first
   * tool. While it, or an Insert tool, is in force no ink tool shows pressed.
   */
  selectActive?: boolean;
  onSelect?: () => void;
  /** Mouse pointer instead of the text I-beam. */
  selectPointer?: boolean;
  /** Snip a region of the page (the reader's clip). */
  onClip?: () => void;
  /** Put a text box on the page. */
  onTextBox?: () => void;
  /** The armed Insert tool, if any. */
  insertTool?: InkInsertTool | null;
  /**
   * The five quick colours, when the surface keeps them itself (the reader
   * shares them with its mark popover); absent, the bar keeps its own.
   */
  quickColours?: readonly (typeof INK_COLOURS)[number][];
  onQuickColour?: (slot: number, colour: (typeof INK_COLOURS)[number]) => void;
  /** The surface's own find (the reader's search); absent, a greyed Find holds its place. */
  find?: ReactNode;
  /** The document's own Insert entries; they keep Insert live even when the page is read-only. */
  insertItems?: readonly InkMenuAction[];
  /** The document's own More sections; they keep More live even when the page is read-only. */
  moreSections?: readonly InkMenuSection[];
  /** The surface's own controls, at the bar's end (the reader's phone toggles). */
  children?: ReactNode;
  /**
   * A page the reader may look at but not mark (a read-only paper, a note in
   * Text): every tool, colour and undo is greyed, never dropped, so the bar
   * keeps one shape on every surface.
   */
  readOnly?: boolean;
}

export function InkBar({
  tool,
  colour,
  width,
  highlighterWidth = HIGHLIGHTER_NIB,
  page,
  pages,
  penOnly,
  hand,
  paper,
  backend,
  busy,
  progress,
  canUndo = true,
  canRedo = true,
  showTextLayer = false,
  onToggleTextLayer,
  onTool,
  onColour,
  onWidth,
  onHighlighterWidth,
  onPenOnly,
  onHand,
  onPaper,
  onRecognise,
  onPrint,
  onPrintPaper,
  onExportPng,
  onExportSvg,
  onUndo,
  onRedo,
  onAddPage,
  onAddImage,
  hasPageBackground = false,
  onRemovePageBackground,
  onInsertPage,
  onAddPicture,
  takesPictureDrops,
  onPrevPage,
  onNextPage,
  pageGap,
  onPageGap,
  zoom,
  onZoom,
  view,
  onGoToPage,
  selectActive = false,
  onSelect,
  selectPointer = false,
  onClip,
  onTextBox,
  insertTool = null,
  quickColours: givenQuickColours,
  onQuickColour,
  find,
  insertItems,
  moreSections,
  children,
  readOnly = false,
}: InkBarProps) {
  // The highlighter keeps its own five quick colours; every other tool uses the pen's.
  const [ownQuickColours, setOwnQuickColour] = useQuickColours(
    tool === "highlighter" ? "highlighter" : "pen",
  );
  const quickColours = givenQuickColours ?? ownQuickColours;
  const setQuickColour = onQuickColour ?? setOwnQuickColour;
  /** An ink tool is in force only while neither Select nor an Insert tool is. */
  const inking = !readOnly && !selectActive && insertTool === null;
  const insert = {
    active: insertTool,
    onAddPicture,
    onAddImage,
    hasPageBackground,
    onRemovePageBackground,
    onInsertPage,
    onClip,
    onTextBox,
    takesPictureDrops,
    items: insertItems,
  };
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
  // One tab stop for the whole bar; arrows walk the tools and swatches (DA-120).
  const roving = useRovingToolbar();

  const history = <UndoRedo onUndo={onUndo} onRedo={onRedo} undoOff={readOnly || !canUndo} redoOff={readOnly || !canRedo} />;
  const pagePill = (
    <PagePill
      page={page ?? 1}
      pages={pages ?? 1}
      onPrevPage={onPrevPage}
      onNextPage={onNextPage}
      onGoToPage={onGoToPage}
      onAddPage={readOnly ? undefined : onAddPage}
    />
  );
  // 5b. The note's zoom is the reader's own view menu, so both bars match;
  // 1 is the note's fit to the page width. Nothing to zoom: greyed.
  const zoomView: ViewMenuProps =
    view ??
    (zoom !== undefined && onZoom
      ? {
          zoomPercent: Math.round(zoom * 100),
          onZoomOut: () => onZoom(inkZoomOut(zoom)),
          onZoomIn: () => onZoom(inkZoomIn(zoom)),
          onZoomTo: (percent) => onZoom(clampInkZoom(percent / 100)),
          fit: zoom === 1 ? "width" : "custom",
          onFitWidth: () => onZoom(1),
        }
      : { zoomPercent: 100, onZoomIn: noop, onZoomOut: noop, disabled: true });
  const recogniseOff = readOnly || busy || !onRecognise;

  return (
    <div
      className="ink-bar ink-palette"
      role="toolbar"
      {...roving}
      aria-label={readOnly ? "Page controls" : "Ink tools"}
      data-collapsed={collapsed || undefined}
      data-dock={dock}
      data-backend={backend === undefined ? undefined : (backend ?? "starting")}
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
        <ToolButton label="Select (V)" pressed={!readOnly && selectActive}
          onClick={onSelect}
          disabled={readOnly || !onSelect}
        >
          <PointerGlyph />
        </ToolButton>
        {INK_BAR_TOOLS.map((entry) => (
          <ToolButton label={`${toolLabel(entry)} (${entry[0]!.toUpperCase()})`} pressed={inking && tool === entry}
            key={entry}
            onClick={() => onTool(entry)}
            disabled={readOnly}
          >
            {toolIcon(entry)}
          </ToolButton>
        ))}
      </div>


      {/* 2a. Quick colours: five, one tap each; the pen's palette changes the one in use */}
      <InkQuickColours colours={quickColours} colour={colour} onColour={onColour} disabled={readOnly} />

      {/* 2. The pen: colour and nib behind one swatch. The trigger shows both —
          the colour as the swatch, the nib as the dot on it — so what the next
          stroke will look like is readable without opening anything. The class
          stays `ink-swatches` so the docked focus palette keeps it. */}
      <div className="ink-swatches ink-pen-pick">
        <Popover
          trigger="swatch"
          colour={`var(${INK_COLOUR_TOKENS[colour]})`}
          portal
          disabled={readOnly}
          ariaLabel="Pen colour and nib"
          label={
            <span aria-hidden>
              {/* The nib shows whatever the tool, so the swatch reads as the pen's colour and size. */}
              <span
                className="ink-pen-trigger-nib"
                style={{ width: `${3 + width}px`, height: `${3 + width}px` }}
              />
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
                    <Swatch
                      key={entry}
                      label={`Ink colour: ${entry}`}
                      selected={colour === entry}
                      colour={`var(${INK_COLOUR_TOKENS[entry]})`}
                      onClick={() => {
                        // The quick colour in use takes the new colour, so the
                        // five are changed here rather than in a second palette.
                        const slot = quickColours.indexOf(colour);
                        if (slot >= 0 && !quickColours.includes(entry)) setQuickColour(slot, entry);
                        onColour(entry);
                        close();
                      }}
                    />
                  ))}
                </div>
              ))}
              <NibRow
                tool={tool}
                width={width}
                highlighterWidth={highlighterWidth}
                onWidth={onWidth}
                onHighlighterWidth={onHighlighterWidth}
              />
            </div>
          )}
        </Popover>
      </div>


      {/* 4. Undo / Redo */}
      {history}

      {/* 5. Page Switcher & Add Page */}
      {pagePill}

      <ViewMenu {...zoomView} />

      {/* 5b. Find: the reader's search, or its place held greyed */}
      {find ?? <FindPlaceholder />}

      {/* 5c. Insert: a picture, PDF pages, a snip, a text box (`ink-bar-view.tsx`) */}
      <InsertMenu {...insert} disabled={!hasInsertItems(insert)} />

      {/* 6. OCR Recognise */}
      <ToolButton label="Recognise"
        tip={busy ? (progress ?? "Recognising…") : `Recognise this page (${shortcutLabel("⌘⇧R")})`}
        onClick={onRecognise}
        disabled={recogniseOff}
      >
        <RecogniseGlyph />
      </ToolButton>

      <span className="ink-bar-spacer" />

      {/* 11. Everything else: pages, paper, spacing, export, input; and what the toolbar folded */}
      <MoreMenu
        paper={paper}
        onPaper={onPaper}
        pageGap={pageGap}
        onPageGap={onPageGap}
        onPrint={onPrint}
        onPrintPaper={onPrintPaper}
        onExportPng={onExportPng}
        onExportSvg={onExportSvg}
        showTextLayer={showTextLayer}
        onToggleTextLayer={onToggleTextLayer}
        penOnly={penOnly}
        onPenOnly={onPenOnly}
        hand={hand}
        onHand={onHand}
        sections={moreSections}
        folded={{
          history,
          page: pagePill,
          zoom: (
            <ZoomPill onZoomOut={zoomView.onZoomOut} onZoomIn={zoomView.onZoomIn}
              outDisabled={zoomView.disabled} inDisabled={zoomView.disabled}
            >
              <span className="ink-menu-value">{zoomView.zoomPercent}%</span>
            </ZoomPill>
          ),
          insert,
          onRecognise: recogniseOff ? undefined : onRecognise,
        }}
      />
      {children}
    </div>
  );
}

const noop = () => {};

function RecogniseGlyph() {
  return (
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
      <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z" />
    </svg>
  );
}

/** Undo and Redo: on the bar, or in More's Undo · Redo row once folded. */
function UndoRedo({ onUndo, onRedo, undoOff, redoOff }: { onUndo: () => void; onRedo: () => void; undoOff: boolean; redoOff: boolean }) {
  return (
      <div className="ink-bar-group">
        <ToolButton label="Undo" tip={`Undo (${shortcutLabel("⌘Z")})`}
          onClick={onUndo}
          disabled={undoOff}
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
        </ToolButton>
        <ToolButton label="Redo" tip={`Redo (${shortcutLabel("⌘⇧Z")})`}
          onClick={onRedo}
          disabled={redoOff}
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
        </ToolButton>
      </div>

  );
}

/** Find where the surface has none: the reader's Find button, greyed. */
function FindPlaceholder() {
  return (
    <Button type="button" variant="ghost" size="sm" aria-label="Find in document" title="Find in document" disabled>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
        <path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4.2-4.2" />
      </svg>
      <span>Find</span>
    </Button>
  );
}

/**
 * The sizes under the pen's colours: the highlighter's own while it is the
 * tool and the reader lets it be sized, the pen's nibs otherwise.
 */
export function NibRow({
  tool,
  width,
  highlighterWidth,
  onWidth,
  onHighlighterWidth,
}: {
  tool: InkBarTool | "shape";
  width: number;
  highlighterWidth: number;
  onWidth: (width: number) => void;
  onHighlighterWidth?: (width: number) => void;
}) {
  if (tool === "highlighter" && onHighlighterWidth) {
    return (
      <div className="colour-menu-row ink-bar-widths" role="group" aria-label="Highlighter width">
        {INK_HIGHLIGHTER_WIDTHS.map((entry) => (
          <ToolButton label={`Highlighter ${entry / 10} mm`} pressed={highlighterWidth === entry}
            key={entry}
            onClick={() => onHighlighterWidth(entry)}
          >
            <span className="ink-nib-dot ink-nib-bar" style={{ width: "6px", height: `${3 + entry / 10}px` }} />
          </ToolButton>
        ))}
      </div>
    );
  }
  return (
    <div className="colour-menu-row ink-bar-widths" role="group" aria-label="Pen nib width">
      {INK_PEN_WIDTHS.map((entry) => {
        const dotSize = 3 + entry;
        return (
          <ToolButton label={`Nib ${(entry / 10).toFixed(1)} mm`} pressed={width === entry && tool === "pen"}
            key={entry}
            onClick={() => onWidth(entry)}
          >
            <span className="ink-nib-dot" style={{ width: `${dotSize}px`, height: `${dotSize}px` }} />
          </ToolButton>
        );
      })}
    </div>
  );
}
