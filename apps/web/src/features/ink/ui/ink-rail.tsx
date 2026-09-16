"use client";

/**
 * The rail: every page of the note in one column, so the note is one scroll
 * rather than a step.
 *
 * Only the page being written on is live — its canvas and its worker — and
 * the ghosts above and below it are inert boxes of the page's own size, paper
 * and background image, so the scroll lands where the next page will be.
 * Reaching a ghost is what flips the note to it (the host's scroll watcher).
 */

import { Fragment } from "react";
import type { InkStroke } from "@weaveforge/core";
import { inkPageFigures } from "@weaveforge/core";
import type { InkPalette } from "../render/ink-palette";
import { InkGhostPage } from "./ink-ghost-page";
import { InkPageStatic } from "./ink-page-static";
import { pureInkPageText } from "./ink-sheet-underlay";

/** What the rail needs from the host. */
export interface InkRailProps {
  /** The scroller, on the rail's own root: the host watches its scroll. */
  scrollRef: { current: HTMLDivElement | null };
  /** 0-based: the live page. */
  pageIndex: number;
  /** How many pages the note has. */
  pageCount: number;
  /** The live page's size in page units. */
  pageSize: { width: number; height: number };
  /** The CSS-pixels-per-unit fit, zoom included. */
  scale: number;
  /** The fallback paper, for a page the sidecar has not named. */
  paper: string;
  /** The paper of each page, by index, where the sidecar has named it. */
  pages: readonly { paper: string }[] | null;
  /** A ghost's background, by page index. */
  ghosts: ReadonlyMap<number, string>;
  /** Decoded strokes for note pages, so adjacent pages render their ink. */
  strokesMap?: ReadonlyMap<number, readonly InkStroke[]>;
  /** Text pages for the note, for text underlay and figure metadata. */
  textPages?: readonly string[] | null;
  /** Figure blob URLs by path. */
  figureUrls?: ReadonlyMap<string, string>;
  /** Theme palette. */
  palette?: InkPalette;
  /** Everything else the live page needs, as the page component takes it. */
  children: React.ReactNode;
}

export function InkRail(props: InkRailProps) {
  const {
    scrollRef,
    pageIndex,
    pageCount,
    pageSize,
    scale,
    paper,
    pages,
    ghosts,
    strokesMap,
    textPages,
    figureUrls,
    palette,
    children,
  } = props;

  const total = Math.max(1, pageCount);

  return (
    <div className="ink-page-scroll" ref={scrollRef}>
      {Array.from({ length: total }, (_, index) => {
        if (index === pageIndex) {
          return <Fragment key={`page-${index}`}>{children}</Fragment>;
        }

        const isAdjacent = Math.abs(index - pageIndex) === 1;
        const pageStrokes = strokesMap?.get(index);
        const pageText = textPages?.[index] ?? "";
        const pureText = pageText ? pureInkPageText(pageText) : "";
        const pageFigures = pageText ? inkPageFigures(pageText) : undefined;
        const hasContent =
          (pageStrokes && pageStrokes.length > 0) ||
          pureText.length > 0 ||
          (pageFigures && pageFigures.length > 0);

        if (isAdjacent || hasContent) {
          return (
            <InkPageStatic
              key={`page-${index}`}
              index={index}
              pageSize={pageSize}
              scale={scale}
              paper={pages?.[index]?.paper ?? paper}
              backgroundUrl={ghosts.get(index) ?? null}
              figures={pageFigures}
              figureUrls={figureUrls}
              pureText={pureText}
              strokes={pageStrokes}
              palette={palette}
            />
          );
        }

        return (
          <InkGhostPage
            key={`page-${index}`}
            index={index}
            pageSize={pageSize}
            scale={scale}
            paper={pages?.[index]?.paper ?? paper}
            backgroundUrl={ghosts.get(index) ?? null}
          />
        );
      })}
    </div>
  );
}
