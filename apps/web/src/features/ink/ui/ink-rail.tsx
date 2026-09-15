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

import { InkFigures, InkFigureControls } from "./ink-figures";
import { InkGhostPage } from "./ink-ghost-page";
import { InkPage } from "./ink-page";

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
  /** Everything else the live page needs, as the page component takes it. */
  children: React.ReactNode;
}

export function InkRail(props: InkRailProps) {
  const { pageIndex, pageCount, pageSize, scale, paper, pages, ghosts } = props;
  return (
    <div className="ink-page-scroll" ref={props.scrollRef}>
      {Array.from({ length: pageIndex }, (_, index) => (
        <InkGhostPage
          key={`ghost-${index}`}
          index={index}
          pageSize={pageSize}
          scale={scale}
          paper={pages?.[index]?.paper ?? paper}
          backgroundUrl={ghosts.get(index) ?? null}
        />
      ))}
      {props.children}
      {Array.from(
        { length: Math.max(0, pageCount - pageIndex - 1) },
        (_, i) => {
          const index = pageIndex + 1 + i;
          return (
            <InkGhostPage
              key={`ghost-${index}`}
              index={index}
              pageSize={pageSize}
              scale={scale}
              paper={pages?.[index]?.paper ?? paper}
              backgroundUrl={ghosts.get(index) ?? null}
            />
          );
        },
      )}
    </div>
  );
}
