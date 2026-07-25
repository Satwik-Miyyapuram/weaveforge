"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

const DEFAULT_ROW_HEIGHT = 88;
const DEFAULT_OVERSCAN = 6;
const VIRTUALIZE_THRESHOLD = 30;

/** Fixed-height windowed list — no extra deps (Phase 3 perf). */
export function VirtualList<T>({
  items,
  rowHeight = DEFAULT_ROW_HEIGHT,
  overscan = DEFAULT_OVERSCAN,
  className,
  renderRow,
}: {
  items: readonly T[];
  rowHeight?: number;
  overscan?: number;
  className?: string;
  renderRow: (item: T, index: number) => ReactNode;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(480);
  const [scrollTop, setScrollTop] = useState(0);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.clientHeight || 480));
    ro.observe(el);
    setHeight(el.clientHeight || 480);
    return () => ro.disconnect();
  }, []);

  const onScroll = useCallback(() => {
    const el = hostRef.current;
    if (!el) return;
    setScrollTop(el.scrollTop);
  }, []);

  if (items.length <= VIRTUALIZE_THRESHOLD) {
    return (
      <div className={className}>
        {items.map((item, index) => (
          <div key={index}>{renderRow(item, index)}</div>
        ))}
      </div>
    );
  }

  const totalHeight = items.length * rowHeight;
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const visibleCount = Math.ceil(height / rowHeight) + overscan * 2;
  const end = Math.min(items.length, start + visibleCount);
  const slice = items.slice(start, end);

  return (
    <div
      ref={hostRef}
      className={className}
      style={{ overflow: "auto", maxHeight: "100%" }}
      onScroll={onScroll}
    >
      <div style={{ height: totalHeight, position: "relative" }}>
        {slice.map((item, i) => {
          const index = start + i;
          return (
            <div
              key={index}
              style={{
                position: "absolute",
                top: index * rowHeight,
                left: 0,
                right: 0,
                height: rowHeight,
              }}
            >
              {renderRow(item, index)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
