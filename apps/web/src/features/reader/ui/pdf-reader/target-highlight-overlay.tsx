"use client";

import { useLayoutEffect, useRef, useState } from "react";
import type { FigureTarget } from "@weaveforge/core";

export interface TargetHighlightRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Resolves exact text-selection-aligned bounding rects for an internal jump target
 * (Footnote, Figure caption, Table caption, Equation, or Section) against the
 * rendered PDF.js text layer.
 */
export function resolveTargetHighlightRects(
  pageEl: HTMLElement | null,
  target: FigureTarget,
  pageHeight: number,
): TargetHighlightRect[] {
  if (!pageEl) return [];
  const pageRect = pageEl.getBoundingClientRect();
  const row = (typeof pageEl.closest === "function" ? pageEl.closest<HTMLElement>(".pdf-reader-page-row") : null) ?? pageEl.parentElement ?? pageEl;
  const textLayer = row.querySelector(".pdf-reader-textlayer");
  if (!textLayer) return [];
  const spans = Array.from(textLayer.querySelectorAll<HTMLElement>("span"));
  if (spans.length === 0) return [];

  const scale = pageRect.height > 0 ? pageRect.height / (pageHeight || 792) : 1;
  const expectedY = typeof target.y === "number" ? (pageHeight - target.y) * scale : 0;
  let matchedSpans: HTMLElement[] = [];

  // 1. Caption matching for Figure / Table / Algorithm / Section / Equation
  if (target.label) {
    const cleanLabel = target.label.replace(/[)\]]+$/, "").trim();
    const figMatch = /^(Fig(?:ure)?|Tab(?:le)?|Alg(?:orithm)?|Sec(?:tion)?)\.?\s*(\d+[a-z]?)/i.exec(cleanLabel);
    if (figMatch) {
      const kind = figMatch[1];
      const num = figMatch[2];
      const pattern = new RegExp(`^${kind}\\.?\\s*${num}\\b`, "i");
      const found = spans.find((s) => s.textContent && pattern.test(s.textContent.trim()));
      if (found) {
        const foundTop = found.getBoundingClientRect().top;
        matchedSpans = spans.filter((s) => Math.abs(s.getBoundingClientRect().top - foundTop) <= 4);
      }
    }
  }

  // 2. Footnote or destination coordinate matching near expectedY
  if (matchedSpans.length === 0 && typeof target.y === "number") {
    const nearby = spans.filter((s) => {
      const topRel = s.getBoundingClientRect().top - pageRect.top;
      return Math.abs(topRel - expectedY) < 48;
    });

    if (nearby.length > 0) {
      const label = target.label;
      if (label && /^\d+$/.test(label.trim())) {
        const marker = nearby.find((s) => s.textContent?.trim() === label.trim());
        if (marker) {
          const markerTop = marker.getBoundingClientRect().top;
          matchedSpans = nearby.filter((s) => Math.abs(s.getBoundingClientRect().top - markerTop) <= 6);
        }
      }

      // If no marker span found, pick the line closest to expectedY
      if (matchedSpans.length === 0) {
        const lines = new Map<number, HTMLElement[]>();
        for (const s of nearby) {
          const topRel = s.getBoundingClientRect().top - pageRect.top;
          const roundedTop = Math.round(topRel / 5) * 5;
          if (!lines.has(roundedTop)) lines.set(roundedTop, []);
          lines.get(roundedTop)!.push(s);
        }
        let bestLine: HTMLElement[] | null = null;
        let bestDist = Infinity;
        for (const [topVal, lineSpans] of lines.entries()) {
          const dist = Math.abs(topVal - expectedY);
          if (dist < bestDist) {
            bestDist = dist;
            bestLine = lineSpans;
          }
        }
        if (bestLine) matchedSpans = bestLine;
      }
    }
  }

  if (matchedSpans.length === 0) return [];

  // Convert matched spans into page-relative client rects
  const rawRects = matchedSpans.map((s) => {
    const r = s.getBoundingClientRect();
    return {
      left: r.left - pageRect.left,
      top: r.top - pageRect.top,
      width: r.width,
      height: r.height,
    };
  });

  // Group by vertical line (within 4px) and merge contiguous spans into clean boxes
  const lineGroups: { left: number; right: number; top: number; bottom: number }[] = [];
  for (const r of rawRects) {
    if (r.width < 1 || r.height < 1) continue;
    const group = lineGroups.find((g) => Math.abs(g.top - r.top) <= 4);
    if (group) {
      group.left = Math.min(group.left, r.left);
      group.right = Math.max(group.right, r.left + r.width);
      group.top = Math.min(group.top, r.top);
      group.bottom = Math.max(group.bottom, r.top + r.height);
    } else {
      lineGroups.push({
        left: r.left,
        right: r.left + r.width,
        top: r.top,
        bottom: r.top + r.height,
      });
    }
  }

  return lineGroups.map((g) => ({
    left: g.left,
    top: g.top,
    width: g.right - g.left,
    height: g.bottom - g.top,
  }));
}

export interface TargetHighlightOverlayProps {
  target: FigureTarget;
  scale: number;
  pageHeight: number;
  pageWidth: number;
}

/**
 * Renders unified text-aligned pulse highlights for internal jump targets
 * (Figures, Footnotes, Tables, Headings).
 */
export function TargetHighlightOverlay({
  target,
  scale,
  pageHeight,
  pageWidth,
}: TargetHighlightOverlayProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [rects, setRects] = useState<TargetHighlightRect[]>([]);

  useLayoutEffect(() => {
    const pageEl = rootRef.current?.closest<HTMLElement>(".pdf-reader-page") ?? null;
    const resolved = resolveTargetHighlightRects(pageEl, target, pageHeight);
    if (resolved.length > 0) {
      setRects(resolved);
    } else {
      // Clean ascender-compensated geometric fallback if no text spans exist
      const h = Math.max((target.height ?? 18) * scale, 18);
      const top = Math.max(0, (pageHeight - target.y) * scale - h);
      const left = typeof target.x === "number" ? target.x * scale : 40;
      const width = Math.min(pageWidth * scale * 0.8, 500 * scale);
      setRects([{ left, top, width, height: h }]);
    }
  }, [target, scale, pageHeight, pageWidth]);

  return (
    <div
      ref={rootRef}
      key={`target-${target.page}-${target.y}-${target.label ?? ""}`}
      className="pdf-reader-target-overlay"
      aria-hidden="true"
    >
      {rects.map((r, i) => (
        <span
          key={i}
          className="pdf-reader-target-hit"
          style={{
            left: `${r.left}px`,
            top: `${r.top}px`,
            width: `${r.width}px`,
            height: `${r.height}px`,
          }}
        />
      ))}
    </div>
  );
}
