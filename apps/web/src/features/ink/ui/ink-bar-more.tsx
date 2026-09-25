"use client";

/**
 * The bar's ⋯ menu: everything the bar does less than once a page.
 *
 * The bar keeps one row — the tools, the pen, undo and the page — and this list
 * holds the rest a section at a time: pages, paper, spacing, export, and the
 * input settings. Each section is drawn only when its handlers are handed over,
 * so the PDF reader, which has none of them, gets no ⋯ at all.
 */

import { INK_PAPERS, type InkHand, type InkPaper } from "@weaveforge/core";

import { paperLabel } from "./ink-bar-glyphs";
import { useBarMenu } from "./ink-bar-menus";

/** How much desk shows between two pages of a note. */
export const INK_PAGE_GAPS = ["none", "small", "large"] as const;
export type InkPageGap = (typeof INK_PAGE_GAPS)[number];

export function pageGapLabel(gap: InkPageGap): string {
  switch (gap) {
    case "none":
      return "None";
    case "small":
      return "Small";
    case "large":
      return "Large";
  }
}

/** The gap in CSS pixels at zoom 1; the rail scales nothing, the desk is desk. */
export function pageGapPx(gap: InkPageGap): number {
  switch (gap) {
    case "none":
      return 0;
    case "small":
      return 16;
    case "large":
      return 48;
  }
}

export interface MoreMenuProps {
  onAddPage?: () => void;
  onAddImage?: () => void;
  hasPageBackground?: boolean;
  onRemovePageBackground?: () => void;
  onInsertPage?: () => void;
  paper?: InkPaper;
  onPaper?: (paper: InkPaper) => void;
  pageGap?: InkPageGap;
  onPageGap?: (gap: InkPageGap) => void;
  onPrint?: () => void;
  onExportPng?: () => void;
  onExportSvg?: () => void;
  showTextLayer?: boolean;
  onToggleTextLayer?: () => void;
  penOnly?: boolean;
  onPenOnly?: (value: boolean) => void;
  hand?: InkHand;
  onHand?: (value: InkHand) => void;
}

export function MoreMenu({
  onAddPage,
  onAddImage,
  hasPageBackground = false,
  onRemovePageBackground,
  onInsertPage,
  paper,
  onPaper,
  pageGap,
  onPageGap,
  onPrint,
  onExportPng,
  onExportSvg,
  showTextLayer = false,
  onToggleTextLayer,
  penOnly = false,
  onPenOnly,
  hand,
  onHand,
}: MoreMenuProps) {
  const { open, setOpen, menuRef, listRef } = useBarMenu();
  /** Close the menu, then run what was chosen. */
  const choose = (run: () => void) => () => {
    setOpen(false);
    run();
  };

  const removeImage = hasPageBackground ? onRemovePageBackground : undefined;
  const hasPageItems = Boolean(onAddPage || onAddImage || onInsertPage || removeImage);
  const hasPaper = Boolean(paper && onPaper);
  const hasGap = Boolean(pageGap && onPageGap);
  const hasExport = Boolean(onPrint && onExportPng);
  const hasInput = Boolean(onToggleTextLayer || onPenOnly || (onHand && hand));
  if (!hasPageItems && !hasPaper && !hasGap && !hasExport && !hasInput) return null;

  return (
    <div className="ink-menu ink-menu-more" ref={open ? menuRef : undefined}>
      <button
        type="button"
        className="ink-tool ink-tool-icon-only"
        onClick={() => setOpen((was) => !was)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="More"
        aria-label="More ink options"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="5" cy="12" r="1.8" />
          <circle cx="12" cy="12" r="1.8" />
          <circle cx="19" cy="12" r="1.8" />
        </svg>
      </button>
      {open ? (
        <div
          className="ink-menu-list ink-menu-more-list"
          role="menu"
          aria-label="More ink options"
          ref={listRef}
        >
          {hasPageItems ? (
            <div className="ink-menu-section" role="group" aria-label="Page">
              {onAddPage ? (
                <button type="button" role="menuitem" className="ink-menu-item" onClick={choose(onAddPage)}>
                  Add a page
                </button>
              ) : null}
              {onInsertPage ? (
                <button
                  type="button"
                  role="menuitem"
                  className="ink-menu-item"
                  onClick={choose(onInsertPage)}
                >
                  Insert a page from a PDF or image
                </button>
              ) : null}
              {onAddImage ? (
                <button type="button" role="menuitem" className="ink-menu-item" onClick={choose(onAddImage)}>
                  {hasPageBackground ? "Change the page image" : "Add an image to this page"}
                </button>
              ) : null}
              {removeImage ? (
                <button type="button" role="menuitem" className="ink-menu-item" onClick={choose(removeImage)}>
                  Remove the page image
                </button>
              ) : null}
            </div>
          ) : null}

          {paper && onPaper ? (
            <div className="ink-menu-section" role="group" aria-label="Paper">
              <span className="ink-menu-heading">Paper</span>
              <div className="ink-menu-chips">
                {INK_PAPERS.map((entry) => (
                  <button
                    key={entry}
                    type="button"
                    role="menuitemradio"
                    aria-checked={paper === entry}
                    className="ink-menu-chip"
                    onClick={() => onPaper(entry)}
                  >
                    <span className={`ink-paper-preview paper-${entry}`} aria-hidden="true" />
                    {paperLabel(entry)}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {pageGap && onPageGap ? (
            <div className="ink-menu-section" role="group" aria-label="Page spacing">
              <span className="ink-menu-heading">Page spacing</span>
              <div className="ink-menu-chips">
                {INK_PAGE_GAPS.map((entry) => (
                  <button
                    key={entry}
                    type="button"
                    role="menuitemradio"
                    aria-checked={pageGap === entry}
                    className="ink-menu-chip"
                    onClick={() => onPageGap(entry)}
                  >
                    {pageGapLabel(entry)}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {onPrint && onExportPng ? (
            <div className="ink-menu-section" role="group" aria-label="Export">
              <button type="button" role="menuitem" className="ink-menu-item" onClick={choose(onPrint)}>
                Print or save as PDF
                <kbd>⌘⇧P</kbd>
              </button>
              <button type="button" role="menuitem" className="ink-menu-item" onClick={choose(onExportPng)}>
                Full-page PNG
                <kbd>⌘⇧E</kbd>
              </button>
              {onExportSvg ? (
                <button type="button" role="menuitem" className="ink-menu-item" onClick={choose(onExportSvg)}>
                  Vector SVG
                </button>
              ) : null}
            </div>
          ) : null}

          {hasInput ? (
            <div className="ink-menu-section" role="group" aria-label="Input">
              {onToggleTextLayer ? (
                <button
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={showTextLayer}
                  className="ink-menu-item"
                  onClick={onToggleTextLayer}
                >
                  Show the text layer
                  <span className="ink-menu-check" aria-hidden="true">{showTextLayer ? "✓" : ""}</span>
                </button>
              ) : null}
              {onPenOnly ? (
                <button
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={penOnly}
                  className="ink-menu-item"
                  title="Ignore touch entirely; the wrist guard"
                  onClick={() => onPenOnly(!penOnly)}
                >
                  Pen only
                  <span className="ink-menu-check" aria-hidden="true">{penOnly ? "✓" : ""}</span>
                </button>
              ) : null}
              {onHand && hand ? (
                <button
                  type="button"
                  role="menuitem"
                  className="ink-menu-item"
                  title="Which hand writes: the resting palm is expected on that side"
                  onClick={() => onHand(hand === "right" ? "left" : "right")}
                >
                  Writing hand
                  <span className="ink-menu-value">{hand === "right" ? "Right" : "Left"}</span>
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
