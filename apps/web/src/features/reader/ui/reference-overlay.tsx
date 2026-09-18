"use client";

import { memo, useMemo } from "react";
import {
  pdfRectToScreenBox,
  type PageProjection,
  type PageTextItem,
} from "@weaveforge/core";
import { locateMention } from "../application/reference-locate";
import type { MentionHit } from "../application/reader-references";

export type { MentionHit };

interface ReferenceOverlayProps {
  mentions: readonly MentionHit[];
  /** The page's text runs, in the order the offsets were built from. */
  items: readonly PageTextItem[];
  projection: PageProjection;
  onOpen: (hit: MentionHit, anchor: DOMRectLike) => void;
}

interface DOMRectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface PlacedMention {
  hit: MentionHit;
  box: DOMRectLike;
  /** Per-run underlines, positioned inside `box`. */
  segments: DOMRectLike[];
}

/**
 * Paint the citation and figure mentions found in the page's text layer.
 *
 * The text layer itself is left alone: it stays selectable and keeps its own
 * geometry, and this paints a sibling layer above it. The layer sits above the
 * dark-mode canvas filter so its colours are not inverted along with the page
 * (see `use-dark-pdf.ts`).
 *
 * Every page mounts one, so the work is memoised on the inputs the geometry
 * depends on and the component is memoised on its props, exactly like
 * `AnnotationOverlay` — a re-render must not re-project untouched pages.
 */
function ReferenceOverlayInner({ mentions, items, projection, onOpen }: ReferenceOverlayProps) {
  const placed = useMemo<PlacedMention[]>(() => {
    const out: PlacedMention[] = [];
    for (const hit of mentions) {
      const { rects, bounds } = locateMention(items, hit.start, hit.end);
      if (!bounds) continue;
      const box = pdfRectToScreenBox(bounds, projection);
      // A zero-width or zero-height box is unclickable; skip it rather than
      // render a control nobody can hit.
      if (box.width < 1 || box.height < 1) continue;
      out.push({
        hit,
        box,
        segments: rects.map((rect) => {
          const segment = pdfRectToScreenBox(rect, projection);
          return {
            left: segment.left - box.left,
            top: segment.top - box.top,
            width: segment.width,
            height: segment.height,
          };
        }),
      });
    }
    return out;
  }, [mentions, items, projection]);

  if (!placed.length) return null;

  return (
    <div className="pdf-reader-ref-layer">
      {placed.map(({ hit, box, segments }) => (
        <button
          key={hit.key}
          type="button"
          className="pdf-reader-ref-link"
          data-kind={hit.kind}
          data-ref-indexes={hit.refIndexes.join(",") || undefined}
          data-mention-key={hit.key}
          aria-label={hit.label}
          title={hit.label}
          style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
          onClick={() => onOpen(hit, box)}
        >
          {segments.map((segment, i) => (
            <span
              key={i}
              className="pdf-reader-ref-underline"
              style={{ left: segment.left, top: segment.top, width: segment.width, height: segment.height }}
            />
          ))}
        </button>
      ))}
    </div>
  );
}

export const ReferenceOverlay = memo(ReferenceOverlayInner);