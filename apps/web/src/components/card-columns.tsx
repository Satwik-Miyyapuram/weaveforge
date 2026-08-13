"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

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
 * Cards are dealt round-robin (0,1,2 / 0,1,2 …) rather than filled column-first.
 * Multi-column filled column 1 top-to-bottom before column 2, so a sorted list
 * read *downwards* — the first three cards were vertical, not horizontal.
 * Round-robin puts the first row across the top, matching the sort order, and
 * keeps columns close in length whenever card heights are similar.
 */
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
  const [columnCount, setColumnCount] = useState(1);

  // Column count follows the container, not the viewport: these grids sit next
  // to sidebars that open and close, and a media query cannot see that.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const measure = (width: number) => {
      if (width <= 0) return;
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

  const columns = useMemo(() => {
    const buckets: { item: T; key: string }[][] = Array.from(
      { length: columnCount },
      () => [],
    );
    items.forEach((item, index) => {
      buckets[index % columnCount]!.push({ item, key: getKey(item) });
    });
    return buckets;
  }, [items, columnCount, getKey]);

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
          {column.map(({ item, key }) => (
            <div className={deferOffscreen ? "card-columns-item is-deferred" : "card-columns-item"} key={key}>
              {renderItem(item)}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
