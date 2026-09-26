"use client";

/**
 * The bar's ⋯ menu: everything the bar does less than once a page.
 *
 * The bar keeps one row — the tools, the pen, undo and the page — and this list
 * holds the rest a section at a time: paper, spacing, export, and the input
 * settings. Adding pages and images has its own menu, `InsertMenu` below. Each section is drawn only when its handlers are handed over,
 * so the PDF reader, which has none of them, gets no ⋯ at all.
 */

import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
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
  paper?: InkPaper;
  onPaper?: (paper: InkPaper) => void;
  pageGap?: InkPageGap;
  onPageGap?: (gap: InkPageGap) => void;
  onPrint?: () => void;
  /** A paper's print, with or without its margin comments. */
  onPrintPaper?: (withComments: boolean) => void;
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
  paper,
  onPaper,
  pageGap,
  onPageGap,
  onPrint,
  onPrintPaper,
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

  const hasPaper = Boolean(paper && onPaper);
  const hasGap = Boolean(pageGap && onPageGap);
  const hasExport = Boolean((onPrint && onExportPng) || onPrintPaper);
  const hasInput = Boolean(onToggleTextLayer || onPenOnly || (onHand && hand));
  if (!hasPaper && !hasGap && !hasExport && !hasInput) return null;

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

          {onPrintPaper ? (
            <div className="ink-menu-section" role="group" aria-label="Print">
              <span className="ink-menu-heading">Print</span>
              <button
                type="button"
                role="menuitem"
                className="ink-menu-item"
                title="A4 portrait, each page fitted to the sheet"
                onClick={choose(() => onPrintPaper(false))}
              >
                Without comments
              </button>
              <button
                type="button"
                role="menuitem"
                className="ink-menu-item"
                title="A4 landscape, the comments beside each page"
                onClick={choose(() => onPrintPaper(true))}
              >
                With comments
              </button>
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

export interface InsertMenuProps {
  onAddPage?: () => void;
  onAddImage?: () => void;
  hasPageBackground?: boolean;
  onRemovePageBackground?: () => void;
  onInsertPage?: () => void;
  onAddPicture?: () => void;
}

/**
 * Insert: a page, a page from a PDF or image, or an image under this page.
 *
 * Its own drop-down rather than a section of ⋯, because adding a page is done
 * mid-note, often, and should not sit among export and input settings.
 */
export function InsertMenu({
  onAddPage,
  onAddImage,
  hasPageBackground = false,
  onRemovePageBackground,
  onInsertPage,
  onAddPicture,
}: InsertMenuProps) {
  const { open, setOpen, menuRef, listRef } = useBarMenu();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [place, setPlace] = useState<CSSProperties>({ visibility: "hidden" });
  // Fixed under the button, kept inside the window: the list lives on <body>.
  useLayoutEffect(() => {
    const list = listRef.current;
    const trigger = triggerRef.current;
    if (!open || !list || !trigger) {
      setPlace({ visibility: "hidden" });
      return;
    }
    const at = trigger.getBoundingClientRect();
    const edge = 8;
    const left = Math.max(edge, Math.min(at.left, window.innerWidth - list.offsetWidth - edge));
    const below = at.bottom + 6;
    const top =
      below + list.offsetHeight > window.innerHeight - edge ? Math.max(edge, at.top - list.offsetHeight - 6) : below;
    setPlace({ left, top });
  }, [open, listRef]);
  const choose = (run: () => void) => () => {
    setOpen(false);
    run();
  };
  const removeImage = hasPageBackground ? onRemovePageBackground : undefined;
  if (!onAddPage && !onAddImage && !onInsertPage && !onAddPicture && !removeImage) return null;

  return (
    <div className="ink-menu ink-menu-insert" ref={open ? menuRef : undefined}>
      <button
        type="button"
        ref={triggerRef}
        className="ink-tool ink-insert-trigger"
        onClick={() => setOpen((was) => !was)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Insert"
        aria-label="Insert"
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M12 5v14M5 12h14" />
        </svg>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open
        ? createPortal(
            <div
              className="ink-menu-list ink-menu-insert-list"
              role="menu"
              aria-label="Insert"
              ref={listRef}
              style={place}
            >
              {onAddPage ? (
                <button type="button" role="menuitem" className="ink-menu-item" onClick={choose(onAddPage)}>
                  A blank page
                </button>
              ) : null}
              {onInsertPage ? (
                <button type="button" role="menuitem" className="ink-menu-item" onClick={choose(onInsertPage)}>
                  A page from a PDF or image
                </button>
              ) : null}
              {onAddImage ? (
                <button type="button" role="menuitem" className="ink-menu-item" onClick={choose(onAddImage)}>
                  {hasPageBackground ? "Change the page image" : "An image under this page"}
                </button>
              ) : null}
              {onAddPicture ? (
                <button type="button" role="menuitem" className="ink-menu-item" onClick={choose(onAddPicture)}>
                  A picture on this page
                </button>
              ) : null}
              {removeImage ? (
                <button type="button" role="menuitem" className="ink-menu-item" onClick={choose(removeImage)}>
                  Remove the page image
                </button>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
