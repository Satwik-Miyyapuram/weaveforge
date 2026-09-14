"use client";

/**
 * The figures on a live page: images placed on the paper (§figure).
 *
 * A figure is not ink — it does not go through the worker, because it is not
 * a stroke and never rasterises into one. It is a placed image, drawn as one:
 * absolutely positioned in the sheet, in page units scaled the way the sheet
 * is, under the canvas so writing over a figure stays ink.
 *
 * The gestures are the canvas's, not the image's. The canvas is the drawing
 * surface and it sits over every figure, so the page routes the pointer
 * itself (§ink-page): a pen tip always draws — a pen over a photograph is a
 * note — while a mouse that lands inside a figure's box drags the figure,
 * and one that lands on a corner resizes it. A double-click opens the
 * controls here, which is where the crop and the removal live — the two
 * things a gesture cannot say.
 *
 * The placement is the note's text (§figure.ts in core): the layer reads it
 * as geometry and the host writes it back, so the text layer is the model
 * and never a shadow of it.
 */

import { useState } from "react";

import { PromptDialog } from "@/components/prompt-dialog";
import type { FigureGeometry } from "@weaveforge/core";

/** A figure's box in CSS pixels, for the popover to sit at. */
export interface FigureBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface InkFiguresProps {
  /** The figures the page's text layer places. */
  figures: readonly FigureGeometry[];
  /** CSS pixels per 0.1 mm, the sheet's own scale. */
  scale: number;
  /** A blob URL per figure path, resolved by the host once. */
  imageUrls: ReadonlyMap<string, string>;
  /**
   * The figure the controls are open for, by its index in `figures` — an
   * outline while the controls are open, so the popover has a referent.
   */
  activeIndex?: number | null;
}

/**
 * The figures themselves — painted under the canvas, pointer-transparent
 * because the canvas owns the pointer (§ink-page).
 */
export function InkFigures({
  figures,
  scale,
  imageUrls,
  activeIndex = null,
}: InkFiguresProps) {
  return (
    <div className="ink-figures" aria-hidden="true">
      {figures.map((one, index) => {
        const url = imageUrls.get(one.path);
        const crop = one.crop ?? [0, 0, 0, 0];
        // A crop hides part of the image without touching the box: the
        // frame keeps its place and size, and the picture inside it is
        // enlarged so the cropped-out edges fall outside the frame — the
        // wrapper clips. The scale factor is the reciprocal of the fraction
        // of the image that remains, so what fills the frame is exactly the
        // un-cropped middle.
        const keepX = Math.max(0.01, 1 - (crop[0] + crop[2]) / 100);
        const keepY = Math.max(0.01, 1 - (crop[1] + crop[3]) / 100);
        const active = activeIndex === index;
        return (
          <div
            key={`${one.path}:${index}`}
            className={`ink-figure${active ? " is-active" : ""}`}
            data-figure={index}
            style={{
              position: "absolute",
              left: `${one.x * scale}px`,
              top: `${one.y * scale}px`,
              width: `${one.w * scale}px`,
              height: `${one.h * scale}px`,
            }}
          >
            {url ? (
              <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
                <img
                  src={url}
                  alt=""
                  draggable={false}
                  style={{
                    position: "absolute",
                    width: `${(100 / keepX).toFixed(3)}%`,
                    height: `${(100 / keepY).toFixed(3)}%`,
                    left: `${(crop[0] / keepX).toFixed(3)}%`,
                    top: `${(crop[1] / keepY).toFixed(3)}%`,
                    objectFit: "fill",
                  }}
                />
              </div>
            ) : (
              <div className="ink-figure-pending" />
            )}
            {/* The corners, painted where the canvas's own corner hit-test
                looks: a mouse on one of these resizes the figure, and a dot
                is where the eye goes when the hand wants that. */}
            <span className="ink-figure-dot" style={{ left: -4, top: -4 }} />
            <span className="ink-figure-dot" style={{ right: -4, top: -4 }} />
            <span className="ink-figure-dot" style={{ left: -4, bottom: -4 }} />
            <span className="ink-figure-dot" style={{ right: -4, bottom: -4 }} />
          </div>
        );
      })}
    </div>
  );
}

export interface InkFigureControlsProps {
  /** The figure the controls are about, or null to close them. */
  figure: FigureGeometry | null;
  /** The figure's box in CSS pixels, for the popover to sit at. */
  box: FigureBox | null;
  /** The crop field, applied to the active figure. */
  onCrop: (crop: [number, number, number, number]) => void;
  /** The removal, applied to the active figure. */
  onRemove: () => void;
  /** The controls closed without doing anything. */
  onClose: () => void;
}

/**
 * The active figure's controls — the one part of a figure above the canvas,
 * because it is the one part that takes its own pointer events.
 */
export function InkFigureControls({
  figure,
  box,
  onCrop,
  onRemove,
  onClose,
}: InkFigureControlsProps) {
  const [cropping, setCropping] = useState(false);
  if (!figure || !box) return null;
  if (cropping) {
    return (
      <CropDialog
        figure={figure}
        onApply={(crop) => {
          onCrop(crop);
          setCropping(false);
        }}
        onClose={() => setCropping(false)}
      />
    );
  }
  return (
    <div
      className="ink-figure-popover"
      role="toolbar"
      aria-label="This image"
      style={{
        left: `${Math.max(8, box.left)}px`,
        top: `${Math.max(8, box.top - 40)}px`,
      }}
    >
      <button
        type="button"
        className="ink-figure-button"
        onClick={() => setCropping(true)}
      >
        Crop
      </button>
      <button
        type="button"
        className="ink-figure-button ink-figure-button-remove"
        onClick={onRemove}
      >
        Remove
      </button>
      <button type="button" className="ink-figure-button" onClick={onClose}>
        Done
      </button>
    </div>
  );
}

/**
 * The crop: four insets as percentages, typed rather than scraped, because
 * the mouse cannot tell a 3 % inset from a 4 % one and a number can.
 */
function CropDialog({
  figure,
  onApply,
  onClose,
}: {
  figure: FigureGeometry;
  onApply: (crop: [number, number, number, number]) => void;
  onClose: () => void;
}) {
  return (
    <PromptDialog
      title="Crop this image"
      body="How much of the image to hide, as percentages off each edge: left, top, right, bottom. The file itself is untouched."
      label="Crop (left, top, right, bottom)"
      initialValue={(figure.crop ?? [0, 0, 0, 0]).join(", ")}
      confirmLabel="Crop it"
      validate={(text) => {
        const parts = text.split(",").map((part) => Number(part.trim()));
        if (
          parts.length !== 4 ||
          parts.some((n) => !Number.isFinite(n) || n < 0 || n >= 100)
        ) {
          return "Four numbers, each 0 to 99.";
        }
        return null;
      }}
      onConfirm={(text) => {
        const parts = text.split(",").map((part) => Math.round(Number(part.trim())));
        onApply(parts as [number, number, number, number]);
      }}
      onClose={onClose}
    />
  );
}

/**
 * A default box for a figure whose first placement is a drop: the image's own
 * aspect on a half-width of the page, centred where the drop landed and then
 * clamped onto the paper — a drop at an edge lands the figure against that
 * edge rather than half off the page.
 */
export function figureBoxForAspect(
  aspect: number,
  at: { x: number; y: number },
  pageSize: { width: number; height: number },
): { x: number; y: number; w: number; h: number } {
  const w = Math.round(Math.min(pageSize.width * 0.5, pageSize.width));
  const h = Math.round(w / Math.max(aspect, 0.01));
  const clamp = (value: number, low: number, high: number) =>
    Math.min(high, Math.max(low, value));
  return {
    x: Math.round(clamp(at.x - w / 2, 0, Math.max(0, pageSize.width - w))),
    y: Math.round(clamp(at.y - h / 2, 0, Math.max(0, pageSize.height - h))),
    w,
    h,
  };
}
