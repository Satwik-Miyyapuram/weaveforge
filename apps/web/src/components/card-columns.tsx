"use client";

import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";

/**
 * Masonry card layout that a browser can actually skip work for.
 *
 * The dense, gap-free packing here used to come from CSS multi-column. That
 * looks right and scales badly: column balancing is a property of the *whole*
 * flow, so the browser must lay out every card to decide where any column
 * breaks. With 1500 cards a scroll spent ~4.3s blocked, and the
 * `content-visibility: auto` on each card bought nothing, because "skip this
 * offscreen card" is not something column balancing permits.
 *
 * Plain CSS grid fixes the cost but not the look: rows start level, so a short
 * card leaves a gap beneath it — which is exactly what masonry exists to avoid.
 *
 * So: N real columns, each an ordinary block flow. A column's layout depends
 * only on its own cards, so offscreen ones are genuinely skipped, and cards
 * stack tightly with no gaps. Measured on the same 1500 cards: 4.3s → 2.3s
 * blocked, better than both alternatives.
 *
 * `dealColumns` below owns which card goes where.
 */
/** How many hues Confetti rotates through. Mirrors the `6n` in styles/cards.css. */
export const CARD_HUE_COUNT = 6;

/** One card, dealt into a column, with what the CSS needs to colour it. */
export type DealtCard<T> = { item: T; key: string; hue: number };

/**
 * Deal cards round-robin (0,1,2 / 0,1,2 …) rather than filling column-first.
 *
 * Multi-column filled column 1 top-to-bottom before column 2, so a sorted list
 * read *downwards* — the first three cards were vertical, not horizontal.
 * Round-robin puts the first row across the top, matching the sort order, and
 * keeps columns close in length whenever card heights are similar.
 *
 * `hue` is the card's position in the flat list, which nothing can recover once
 * the cards are dealt: themes that colour by position (Confetti) need exactly
 * that number. 1-based to match `nth-child`, which does the same job for cards
 * that are siblings.
 */
export function dealColumns<T>(
  items: readonly T[],
  columnCount: number,
  getKey: (item: T) => string,
): DealtCard<T>[][] {
  if (columnCount < 1) return [];
  const buckets: DealtCard<T>[][] = Array.from({ length: columnCount }, () => []);
  items.forEach((item, index) => {
    buckets[index % columnCount]!.push({
      item,
      key: getKey(item),
      hue: (index % CARD_HUE_COUNT) + 1,
    });
  });
  return buckets;
}

export function CardColumns<T>({
  items,
  getKey,
  renderItem,
  className,
  minColumnWidth = 280,
  gap = 12,
  deferOffscreen,
}: {
  items: readonly T[];
  getKey: (item: T) => string;
  renderItem: (item: T) => ReactNode;
  className?: string;
  /** Narrowest a column may get before the count drops by one. */
  minColumnWidth?: number;
  /** Gap between columns and between stacked cards, in px. */
  gap?: number;
  /**
   * Let the browser skip layout for offscreen cards. Worth it for long lists;
   * for a handful of cards the containment bookkeeping is the larger cost.
   */
  deferOffscreen?: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  // 0 means "not measured yet". Cards are held back for that one pass on
  // purpose: a card that first mounts in a one-column deal and is then re-dealt
  // into three loses its own state, because it lands in a different column's
  // subtree. That state includes whether a card's dialog is open — a share
  // dialog opened the moment a list rendered would close itself again.
  const [columnCount, setColumnCount] = useState(0);

  // Column count follows the container, not the viewport: these grids sit next
  // to sidebars that open and close, and a media query cannot see that.
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const measure = (width: number) => {
      // A container with no width yet (display:none ancestor, for one) must
      // still deal the cards somewhere, or nothing ever renders.
      if (width <= 0) {
        setColumnCount((prev) => (prev === 0 ? 1 : prev));
        return;
      }
      const next = Math.max(1, Math.floor((width + gap) / (minColumnWidth + gap)));
      setColumnCount((prev) => (prev === next ? prev : next));
    };
    measure(host.clientWidth);
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) measure(entry.contentRect.width);
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, [gap, minColumnWidth]);

  const columns = useMemo(
    () => dealColumns(items, columnCount, getKey),
    [items, columnCount, getKey],
  );

  return (
    <div
      ref={hostRef}
      className={className ? `card-columns ${className}` : "card-columns"}
      style={{ gap }}
    >
      {columns.map((column, index) => (
        <div
          className="card-columns-col"
          // Column index is the identity here: cards inside carry their own
          // keys, so React reconciles them per column rather than re-creating
          // the whole subtree when the count changes.
          key={index}
          style={{ gap }}
        >
          {column.map(({ item, key, hue }) => (
            <div
              className={deferOffscreen ? "card-columns-item is-deferred" : "card-columns-item"}
              data-card-hue={hue}
              key={key}
            >
              {renderItem(item)}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
