"use client";

import { Children, useEffect, useState, type ReactNode, type WheelEvent } from "react";

const KEY = "metric-grid:cols";
const MAX_COLS = 10;

function readCols(fallback: number): number {
  try {
    const n = Number(sessionStorage.getItem(KEY));
    if (Number.isInteger(n) && n >= 1) return n;
  } catch {}
  return fallback;
}

/** Chart grid with a snapping zoom slider: 1 per row is fully zoomed in, out to 10 per row. */
export function MetricGrid({
  variant,
  defaultCols = 1,
  children,
}: {
  variant: "detail" | "compare";
  defaultCols?: number;
  children: ReactNode;
}) {
  const max = Math.min(MAX_COLS, Math.max(1, Children.count(children)));
  const [want, setWant] = useState(() => readCols(defaultCols));
  const cols = Math.min(want, max);

  useEffect(() => {
    try {
      sessionStorage.setItem(KEY, String(want));
    } catch {}
  }, [want]);

  const set = (n: number) => setWant(Math.min(max, Math.max(1, n)));
  // Either wheel axis steps one notch; down/right = zoom out (more per row).
  const onWheel = (e: WheelEvent) => {
    const d = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    if (d) set(cols + (d > 0 ? 1 : -1));
  };

  return (
    <div className={`metric-grid metric-grid--${variant}`}>
      {max > 1 && (
        <label className="seg metric-grid-zoom" onWheel={onWheel} title="Scroll to zoom">
          <button type="button" aria-label="Zoom in" disabled={cols <= 1} onClick={() => set(cols - 1)}>
            +
          </button>
          <input
            type="range"
            min={1}
            max={max}
            step={1}
            list={`metric-grid-ticks-${variant}`}
            value={cols}
            aria-label="Charts per row"
            onChange={(e) => set(Number(e.target.value))}
          />
          <datalist id={`metric-grid-ticks-${variant}`}>
            {Array.from({ length: max }, (_, i) => (
              <option key={i} value={i + 1} />
            ))}
          </datalist>
          <button type="button" aria-label="Zoom out" disabled={cols >= max} onClick={() => set(cols + 1)}>
            −
          </button>
          <span className="seg-on metric-grid-count">{cols} / row</span>
        </label>
      )}
      <div className={`metric-curves metric-curves--${variant}`} style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {children}
      </div>
    </div>
  );
}
