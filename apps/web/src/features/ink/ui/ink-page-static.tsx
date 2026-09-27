"use client";

/**
 * A static ink page: renders a page's complete visual content — paper,
 * background, text underlay, figures, and vector ink strokes — without
 * mounting a live WebGL canvas or web worker.
 *
 * Used for every page in Read mode, and for every slot of Ink mode's rail —
 * the live page's sheet sits over its slot and draws its ink through the same
 * `InkPageInk` (§ink-page-ink), so each page on screen is drawn one way.
 */

import type { FigureGeometry, InkStroke } from "@weaveforge/core";
import type { InkPalette } from "../render/ink-palette";
import { InkFigures } from "./ink-figures";
import { InkPageInk } from "./ink-page-ink";
import { InkSheetTextUnderlay, inkSheetRuleStyle } from "./ink-sheet-underlay";

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
  /**
   * `vault:`/`paperimg:` src → a fetchable URL, or null to drop the image.
   * A stable identity, so the underlay's markdown pass is not re-run — and its
   * mermaid upgrades thrown away — every time a fetch lands.
   */
  resolveImageSrc?: (src: string) => string | null;
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
  resolveImageSrc,
  strokes,
  palette,
  onLoadError,
}: InkPageStaticProps) {
  const width = Math.max(1, Math.round(pageSize.width * scale));
  const height = Math.max(1, Math.round(pageSize.height * scale));

  return (
    <div className="ink-page" data-page={index}>
      <div
        className={`ink-sheet paper-${paper}`}
        style={{ width: `${width}px`, height: `${height}px`, position: "relative", ...inkSheetRuleStyle(scale) }}
      >
        {backgroundUrl ? (
          // A plain `<img>`: `backgroundUrl` is a `blob:` URL from
          // `use-ink-sheet-images.ts`, made and revoked in this tab, which the
          // `next/image` optimizer has no route for.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            className="ink-ghost-image"
            src={backgroundUrl}
            alt=""
            draggable={false}
            onError={onLoadError}
          />
        ) : null}
        {pureText ? (
          <InkSheetTextUnderlay text={pureText} scale={scale} resolveImageSrc={resolveImageSrc} />
        ) : null}
        {figures && figures.length > 0 ? (
          <InkFigures
            figures={figures}
            scale={scale}
            imageUrls={figureUrls ?? new Map()}
          />
        ) : null}
        <InkPageInk strokes={strokes} pageSize={pageSize} palette={palette} />
        <span className="ink-ghost-label">{index + 1}</span>
      </div>
    </div>
  );
}
