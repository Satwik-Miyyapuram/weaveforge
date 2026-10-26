"use client";

/**
 * The bar's ⋯ menu: everything the bar does less than once a page.
 *
 * The bar keeps one row — the tools, the pen, undo and the page — and this list
 * holds the rest a section at a time: paper, spacing, export, and the input
 * settings. Adding pages and images is done from icons on the bar itself.
 * Each section is drawn only when its handlers are handed over, so the PDF
 * reader, which has none of them, gets no ⋯ at all.
 */

import { INK_PAPERS, type InkHand, type InkPaper } from "@weaveforge/core";

import { paperLabel } from "./ink-bar-glyphs";
import { BarMenuList, useBarMenu } from "./ink-bar-menus";
import { shortcutLabel } from "@/lib/shortcut-label";
import { MenuItemButton, RowButton } from "@/components/controls";

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
  const { open, setOpen, menuRef, listRef, pos, choose } = useBarMenu();

  const hasPaper = Boolean(paper && onPaper);
  const hasGap = Boolean(pageGap && onPageGap);
  const hasExport = Boolean((onPrint && onExportPng) || onPrintPaper);
  const hasInput = Boolean(onToggleTextLayer || onPenOnly || (onHand && hand));
  if (!hasPaper && !hasGap && !hasExport && !hasInput) return null;

  return (
    <div className="ink-menu ink-menu-more" ref={open ? menuRef : undefined}>
      <RowButton
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
      </RowButton>
      {open ? (
        <BarMenuList label="More ink options" className="ink-menu-more-list" listRef={listRef} pos={pos}>
          {paper && onPaper ? (
            <div className="ink-menu-section" role="group" aria-label="Paper">
              <span className="ink-menu-heading">Paper</span>
              <div className="ink-menu-chips">
                {INK_PAPERS.map((entry) => (
                  <MenuItemButton kind="radio" checked={paper === entry}
                    key={entry}
                    className="ink-menu-chip"
                    onClick={() => onPaper(entry)}
                  >
                    <span className={`ink-paper-preview paper-${entry}`} aria-hidden="true" />
                    {paperLabel(entry)}
                  </MenuItemButton>
                ))}
              </div>
            </div>
          ) : null}

          {pageGap && onPageGap ? (
            <div className="ink-menu-section" role="group" aria-label="Page spacing">
              <span className="ink-menu-heading">Page spacing</span>
              <div className="ink-menu-chips">
                {INK_PAGE_GAPS.map((entry) => (
                  <MenuItemButton kind="radio" checked={pageGap === entry}
                    key={entry}
                    className="ink-menu-chip"
                    onClick={() => onPageGap(entry)}
                  >
                    {pageGapLabel(entry)}
                  </MenuItemButton>
                ))}
              </div>
            </div>
          ) : null}

          {onPrintPaper ? (
            <div className="ink-menu-section" role="group" aria-label="Print">
              <span className="ink-menu-heading">Print</span>
              <MenuItemButton
                className="ink-menu-item"
                title="A4 portrait, each page fitted to the sheet"
                onClick={choose(() => onPrintPaper(false))}
              >
                Without comments
              </MenuItemButton>
              <MenuItemButton
                className="ink-menu-item"
                title="A4 landscape, the comments beside each page"
                onClick={choose(() => onPrintPaper(true))}
              >
                With comments
              </MenuItemButton>
            </div>
          ) : null}

          {onPrint && onExportPng ? (
            <div className="ink-menu-section" role="group" aria-label="Export">
              <MenuItemButton className="ink-menu-item" onClick={choose(onPrint)}>
                Print or save as PDF
                <kbd>{shortcutLabel("⌘⇧P")}</kbd>
              </MenuItemButton>
              <MenuItemButton className="ink-menu-item" onClick={choose(onExportPng)}>
                Full-page PNG
                <kbd>{shortcutLabel("⌘⇧E")}</kbd>
              </MenuItemButton>
              {onExportSvg ? (
                <MenuItemButton className="ink-menu-item" onClick={choose(onExportSvg)}>
                  Vector SVG
                </MenuItemButton>
              ) : null}
            </div>
          ) : null}

          {hasInput ? (
            <div className="ink-menu-section" role="group" aria-label="Input">
              {onToggleTextLayer ? (
                <MenuItemButton kind="checkbox" checked={showTextLayer}
                  className="ink-menu-item"
                  onClick={onToggleTextLayer}
                >
                  Show the text layer
                  <span className="ink-menu-check" aria-hidden="true">{showTextLayer ? "✓" : ""}</span>
                </MenuItemButton>
              ) : null}
              {onPenOnly ? (
                <MenuItemButton kind="checkbox" checked={penOnly}
                  className="ink-menu-item"
                  title="Ignore touch entirely; the wrist guard"
                  onClick={() => onPenOnly(!penOnly)}
                >
                  Pen only
                  <span className="ink-menu-check" aria-hidden="true">{penOnly ? "✓" : ""}</span>
                </MenuItemButton>
              ) : null}
              {onHand && hand ? (
                <MenuItemButton
                  className="ink-menu-item"
                  title="Which hand writes: the resting palm is expected on that side"
                  onClick={() => onHand(hand === "right" ? "left" : "right")}
                >
                  Writing hand
                  <span className="ink-menu-value">{hand === "right" ? "Right" : "Left"}</span>
                </MenuItemButton>
              ) : null}
            </div>
          ) : null}
        </BarMenuList>
      ) : null}
    </div>
  );
}
