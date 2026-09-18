"use client";

import { memo, useMemo } from "react";
import {
  pdfRectToScreenBox,
  type DocumentSearchMatch,
  type PageProjection,
  type PageTextItem,
} from "@weaveforge/core";
import { locateMention } from "../application/reference-locate";
import type { FindMark } from "../application/find-marks";

interface FindOverlayProps {
  /** The document's matches; only those on `pageIndex` are painted. */
  matches: readonly DocumentSearchMatch[];
  /** Index into `matches` of the one the user stepped to, or -1. */
  active: number;
  pageIndex: number;
  items: readonly PageTextItem[];
  projection: PageProjection;
}

/**
 * Every hit of the find box, painted on its page; the current one is louder.
 * Sits beside `ReferenceOverlay` and works the same way: offsets into the
 * page text become run rects, which the projection turns into CSS pixels.
 */
function FindOverlayInner({ matches, active, pageIndex, items, projection }: FindOverlayProps) {
  const boxes = useMemo(() => {
    const out: { key: string; current: boolean; left: number; top: number; width: number; height: number }[] = [];
    matches.forEach((match, index) => {
      if (match.pageIndex !== pageIndex) return;
      const { rects } = locateMention(items, match.start, match.end);
      rects.forEach((rect, i) => {
        const box = pdfRectToScreenBox(rect, projection);
        if (box.width < 1 || box.height < 1) return;
        out.push({ key: `${index}:${i}`, current: index === active, ...box });
      });
    });
    return out;
  }, [matches, active, pageIndex, items, projection]);

  if (!boxes.length) return null;
  return (
    <div className="pdf-reader-find-layer">
      {boxes.map(({ key, current, ...box }) => (
        <span
          key={key}
          className={`pdf-reader-find-hit${current ? " is-current" : ""}`}
          style={box}
        />
      ))}
    </div>
  );
}

export const FindOverlay = memo(FindOverlayInner);

/** Ticks beside the scrollbar, one per match, the current one in the accent. */
export function FindMarks({ marks, active }: { marks: readonly FindMark[]; active: number }) {
  if (!marks.length) return null;
  return (
    <div className="pdf-reader-find-marks" aria-hidden="true">
      {marks.map((mark) => (
        <span
          key={mark.index}
          className={`pdf-reader-find-mark${mark.index === active ? " is-current" : ""}`}
          style={{ top: `${mark.fraction * 100}%` }}
        />
      ))}
    </div>
  );
}
