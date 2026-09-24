"use client";

/**
 * The bar's two drop-downs: print/export, and the page layout the ink sits on.
 *
 * They live beside the bar rather than inside it because a menu owns state the
 * bar does not care about — which list is open, where it had to be shifted to
 * stay inside the toolbar, and which click closes it — and because the bar is
 * long enough without them.
 *
 * Both are drawn only when their handlers are handed over, so the PDF reader,
 * which prints nothing and has no paper of its own, shows neither.
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { INK_PAPERS, type InkPaper } from "@weaveforge/core";
import { paperLabel } from "./ink-bar-glyphs";

/**
 * One drop-down's own state: open or not, and the two refs it needs.
 *
 * The bar wraps, so a button can sit at the left end of a row on a narrow pane
 * and at the right end of one on a wide one — a fixed `left` or `right`
 * therefore hangs the list off the edge about half the time, and the pane clips
 * it (`overflow: hidden`, so a floating menu cannot escape it). Measured rather
 * than guessed, before the paint, and clamped to the bar rather than to the
 * window because the bar is what the clipping ancestor is sized to.
 */
function useBarMenu() {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const list = listRef.current;
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
  }, [open]);

  return { open, setOpen, menuRef, listRef };
}

export interface PrintMenuProps {
  onPrint: () => void;
  onExportPng: () => void;
  /** Vector export; absent, the item is not offered. */
  onExportSvg?: () => void;
}

/** Print, save as PDF, a full-page PNG, or the page as SVG. */
export function PrintMenu({ onPrint, onExportPng, onExportSvg }: PrintMenuProps) {
  const { open, setOpen, menuRef, listRef } = useBarMenu();
  /** Close the menu, then run what was chosen. */
  const choose = (run: () => void) => () => {
    setOpen(false);
    run();
  };

  return (
    <div className="ink-menu" ref={open ? menuRef : undefined}>
      <button
        type="button"
        className="ink-tool ink-tool-icon-only"
        onClick={() => setOpen((was) => !was)}
        aria-haspopup="menu"
        aria-expanded={open}
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
      {open ? (
        <div className="ink-menu-list" role="menu" aria-label="Print or export" ref={listRef}>
          <button type="button" role="menuitem" className="ink-menu-item" onClick={choose(onPrint)}>
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
  );
}

export interface PaperMenuProps {
  paper: InkPaper;
  onPaper: (paper: InkPaper) => void;
}

/** The paper under the ink: blank, dotted, ruled, grid or wide (§6.2.12). */
export function PaperMenu({ paper, onPaper }: PaperMenuProps) {
  const { open, setOpen, menuRef, listRef } = useBarMenu();
  const choose = (run: () => void) => () => {
    setOpen(false);
    run();
  };

  return (
    <div className="ink-menu ink-menu-paper" ref={open ? menuRef : undefined}>
      <button
        type="button"
        className="ink-tool ink-tool-icon-only"
        onClick={() => setOpen((was) => !was)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={`Page layout: ${paperLabel(paper)}`}
        aria-label={`Page layout: ${paperLabel(paper)}`}
      >
        <span className={`ink-paper-preview paper-${paper}`} aria-hidden="true" />
      </button>
      {open ? (
        <div className="ink-menu-list" role="menu" aria-label="Page layout" ref={listRef}>
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
  );
}
