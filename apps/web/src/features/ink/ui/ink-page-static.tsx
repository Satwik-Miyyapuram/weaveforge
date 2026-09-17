"use client";

/**
 * A static ink page: renders a page's complete visual content — paper,
 * background, text underlay, figures, and vector ink strokes — without
 * mounting a live WebGL canvas or web worker.
 *
 * Used for:
 * 1. The previous and next pages in Ink mode's 3-page continuous scroll window.
 * 2. All pages in Read mode, providing a crisp, non-interactive reading experience.
 */

import { useMemo } from "react";
import type { FigureGeometry, InkStroke } from "@weaveforge/core";
import { HIGHLIGHTER_ALPHA } from "../render/canvas-renderer";
import { INK_RENDER_COLOURS, paletteCss, type InkPalette } from "../render/ink-palette";
import { strokePath } from "../application/ink-svg";
import { InkFigures } from "./ink-figures";
import { InkSheetTextUnderlay } from "./ink-sheet-underlay";

export interface InkPageStaticProps {
  /** 0-based page index. */
  index: number;
  /** Page size in page units (0.1 mm). */
  pageSize: { width: number; height: number };
  /** Fit scale: CSS pixels per page unit. */
  scale: number;
  /** Paper rule name. */
  paper: string;
  /** Background image URL, if any. */
  backgroundUrl?: string | null;
  /** Figures placed on this page. */
  figures?: readonly FigureGeometry[];
  /** Map of figure paths to object/blob URLs. */
  figureUrls?: ReadonlyMap<string, string>;
  /** Note body text on this page (with figures and header stripped). */
  pureText?: string;
  /** Ink strokes on this page. */
  strokes?: readonly InkStroke[];
  /** Theme palette. */
  palette?: InkPalette;
  /** Callback on background load error. */
  onLoadError?: () => void;
}

export function InkPageStatic({
  index,
  pageSize,
  scale,
  paper,
  backgroundUrl,
  figures,
  figureUrls,
  pureText,
  strokes,
  palette = INK_RENDER_COLOURS,
  onLoadError,
}: InkPageStaticProps) {
  const width = Math.max(1, Math.round(pageSize.width * scale));
  const height = Math.max(1, Math.round(pageSize.height * scale));

  const pens = useMemo(
    () => strokes?.filter((s) => s.tool !== "highlighter") ?? [],
    [strokes],
  );

  const highlighters = useMemo(
    () => strokes?.filter((s) => s.tool === "highlighter") ?? [],
    [strokes],
  );

  return (
    <div className="ink-page" data-page={index}>
      <div
        className={`ink-sheet paper-${paper}`}
        style={{ width: `${width}px`, height: `${height}px`, position: "relative" }}
      >
        {backgroundUrl ? (
          <img
            className="ink-ghost-image"
            src={backgroundUrl}
            alt=""
            draggable={false}
            onError={onLoadError}
          />
        ) : null}
        {pureText ? (
          <InkSheetTextUnderlay text={pureText} scale={scale} />
        ) : null}
        {figures && figures.length > 0 ? (
          <InkFigures
            figures={figures}
            scale={scale}
            imageUrls={figureUrls ?? new Map()}
          />
        ) : null}
        {strokes && strokes.length > 0 ? (
          <svg
            className="ink-strokes-static"
            viewBox={`0 0 ${pageSize.width} ${pageSize.height}`}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              height: "100%",
              pointerEvents: "none",
              zIndex: 1,
            }}
          >
            {pens.map((stroke, i) => {
              const d = strokePath(stroke);
              if (!d) return null;
              const col = paletteCss(palette, stroke.colour);
              return (
                <path
                  key={`p-${i}`}
                  d={d}
                  stroke={col}
                  strokeWidth={stroke.width}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                />
              );
            })}
            {highlighters.map((stroke, i) => {
              const d = strokePath(stroke);
              if (!d) return null;
              const col = paletteCss(palette, stroke.colour);
              return (
                <path
                  key={`h-${i}`}
                  d={d}
                  stroke={col}
                  strokeWidth={stroke.width}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeOpacity={HIGHLIGHTER_ALPHA}
                  fill="none"
                />
              );
            })}
          </svg>
        ) : null}
        <span className="ink-ghost-label">{index + 1}</span>
      </div>
    </div>
  );
}
