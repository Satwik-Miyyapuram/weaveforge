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

import { useState, type ReactNode } from "react";
import { INK_PAPERS, type InkHand, type InkPaper } from "@weaveforge/core";

import { FoldedItems, foldedFind, foldMoves, useFoldOf } from "./ink-bar-fold";
import { paperLabel } from "./ink-bar-glyphs";
import { InsertItems, hasInsertItems, type InsertMenuProps } from "./ink-bar-view";
import { BarMenuList, useBarMenu, type InkMenuSection } from "./ink-bar-menus";
import { shortcutLabel } from "@/lib/shortcut-label";
import { MenuItemButton, ToolButton } from "@/components/controls";

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
  /** The document's own sections (a citation format), first in the list. */
  sections?: readonly InkMenuSection[];
  /** What the toolbar's fold can move in here (`ink-bar-fold.tsx`). */
  folded?: {
    history: ReactNode;
    page: ReactNode;
    zoom: ReactNode;
    insert?: InsertMenuProps;
    onRecognise?: () => void;
  };
}

/**
 * A document's own More sections. A checked/unchecked item is one of a set and
 * keeps the menu open, like Paper; a plain item is an action and closes it.
 */
export function MenuSections({
  sections,
  choose,
}: {
  sections: readonly InkMenuSection[];
  choose: (run: () => void) => () => void;
}) {
  return (
    <>
      {sections.map((section) => (
        <div key={section.label} className="ink-menu-section" role="group" aria-label={section.label}>
          <span className="ink-menu-heading">{section.label}</span>
          {section.items.map((item) =>
            item.checked === undefined ? (
              <MenuItemButton key={item.label} title={item.title} onClick={choose(item.onSelect)}>
                {item.label}
              </MenuItemButton>
            ) : (
              <MenuItemButton key={item.label} kind="radio" checked={item.checked} title={item.title} onClick={item.onSelect}>
                {item.label}
              </MenuItemButton>
            ),
          )}
        </div>
      ))}
    </>
  );
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
  sections = [],
  folded,
}: MoreMenuProps) {
  // Insert ›: its entries take More's place until More closes.
  const [sub, setSub] = useState(false);
  const { open, setOpen, menuRef, listRef, pos, choose } = useBarMenu(sub);
  const fold = useFoldOf(menuRef);
  const moved = Boolean(folded) && foldMoves(fold);

  const hasPaper = Boolean(paper && onPaper);
  const hasGap = Boolean(pageGap && onPageGap);
  const hasExport = Boolean((onPrint && onExportPng) || onPrintPaper);
  const hasInput = Boolean(onToggleTextLayer || onPenOnly || (onHand && hand));
  // Nothing to offer: greyed, not gone, so the bar keeps its shape.
  const empty = !moved && !hasPaper && !hasGap && !hasExport && !hasInput && sections.length === 0;
  const insert = folded?.insert;

  return (
    <div className="ink-menu ink-menu-more" ref={menuRef}>
      <ToolButton label="More ink options" tip="More"
        disabled={empty}
        onClick={() => {
          setSub(false);
          setOpen((was) => !was);
        }}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="5" cy="12" r="1.8" />
          <circle cx="12" cy="12" r="1.8" />
          <circle cx="19" cy="12" r="1.8" />
        </svg>
      </ToolButton>
      {open && sub && insert ? (
        <BarMenuList label="Insert" className="ink-menu-more-list" listRef={listRef} pos={pos}>
          <InsertItems {...insert} choose={choose} />
        </BarMenuList>
      ) : open ? (
        <BarMenuList label="More ink options" className="ink-menu-more-list" listRef={listRef} pos={pos}>
          {folded ? (
            <FoldedItems
              on={fold}
              {...folded}
              onFind={foldedFind(menuRef.current)}
              onInsert={insert && hasInsertItems(insert) ? () => setSub(true) : undefined}
              choose={choose}
            />
          ) : null}
          <MenuSections sections={sections} choose={choose} />
          {paper && onPaper ? (
            <div className="ink-menu-section" role="group" aria-label="Paper">
              <span className="ink-menu-heading">Paper</span>
              <div className="ink-menu-chips">
                {INK_PAPERS.map((entry) => (
                  <MenuItemButton kind="radio" checked={paper === entry}
                    key={entry}
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
                title="A4 portrait, each page fitted to the sheet"
                onClick={choose(() => onPrintPaper(false))}
              >
                Without comments
              </MenuItemButton>
              <MenuItemButton
                title="A4 landscape, the comments beside each page"
                onClick={choose(() => onPrintPaper(true))}
              >
                With comments
              </MenuItemButton>
            </div>
          ) : null}

          {onPrint && onExportPng ? (
            <div className="ink-menu-section" role="group" aria-label="Export">
              <MenuItemButton onClick={choose(onPrint)}>
                Print or save as PDF
                <kbd>{shortcutLabel("⌘⇧P")}</kbd>
              </MenuItemButton>
              <MenuItemButton onClick={choose(onExportPng)}>
                Full-page PNG
                <kbd>{shortcutLabel("⌘⇧E")}</kbd>
              </MenuItemButton>
              {onExportSvg ? (
                <MenuItemButton onClick={choose(onExportSvg)}>
                  Vector SVG
                </MenuItemButton>
              ) : null}
            </div>
          ) : null}

          {hasInput ? (
            <div className="ink-menu-section" role="group" aria-label="Input">
              {onToggleTextLayer ? (
                <MenuItemButton kind="checkbox" checked={showTextLayer}
                  onClick={onToggleTextLayer}
                >
                  Show the text layer
                </MenuItemButton>
              ) : null}
              {onPenOnly ? (
                <MenuItemButton kind="checkbox" checked={penOnly}
                  title="Ignore touch entirely; the wrist guard"
                  onClick={() => onPenOnly(!penOnly)}
                >
                  Pen only
                </MenuItemButton>
              ) : null}
              {onHand && hand ? (
                <MenuItemButton
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
