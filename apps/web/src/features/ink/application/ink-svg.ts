/**
 * A page as vector graphics (§4.8's page, in a file another program can open).
 *
 * The PNG export is a picture of the page; this is the page itself — one path
 * per stroke, in the model's own unit (0.1 mm), so the file opens at A4 in a
 * browser, in Inkscape, or in a paper's figure folder without a raster step.
 * The strokes are the *centrelines* the model holds, drawn with a round cap and
 * join at the nib's width: exact for a pen, and for a highlighter at its own
 * width and alpha. The pressure-faded width the renderer animates is not in the
 * model — a chunk stores one width per stroke (§4.3) — so it is not here
 * either, and a page with a heavy taper in it exports at its base width.
 *
 * A page's image background is a raster and stays one: it is embedded as a
 * base64 `<image>` at the sheet's own origin, which is where the host already
 * composed it (§4.8's `placeOnSheet`).
 */

import {
  INK_A4_HEIGHT,
  INK_A4_WIDTH,
  type FigureGeometry,
  type InkColour,
  type InkPage,
  type InkStroke,
} from "@weaveforge/core";

import { escapeHtml } from "@/lib/escape-html";
import { HIGHLIGHTER_ALPHA } from "../render/canvas-renderer";
import { INK_SEGMENT_SUBDIVISIONS, strokeCurveAt } from "../render/ink-renderer";
import {
  INK_RENDER_COLOURS,
  paletteCss,
  type InkPalette,
} from "../render/ink-palette";

/**
 * No pressure channel, for a caller that only wants the centreline: with
 * `variableWidth: false` {@link strokeCurveAt} never reads this, and the page's
 * samples carry no pressure anyway.
 */
const NO_PRESSURE = new Uint8Array(0);

/** A figure as the SVG export needs it: its placement and its pixels. */
export interface InkSvgFigure extends FigureGeometry {
  /** The image as a data URL; a blob URL would not survive the file being reopened. */
  dataUrl: string;
}

export interface InkSvgOptions {
  /** Ink colours, from the live theme; the light defaults otherwise. */
  palette?: InkPalette;
  /**
   * The page's background raster as a data URL (`data:image/png;base64,…`), or
   * null. A blob URL would not survive the file being saved and reopened.
   */
  backgroundDataUrl?: string | null;
  /**
   * The page's figures — images placed on the paper — as data URLs, drawn
   * under the strokes the way the sheet draws them (§figure).
   */
  figures?: readonly InkSvgFigure[];
  /** What the file is called in a viewer's title bar. */
  title?: string;
}

/** A number as SVG wants it: no exponent, no trailing zeros. */
function num(value: number): string {
  return Number.isFinite(value) ? String(Math.round(value * 100) / 100) : "0";
}

/**
 * One stroke's centreline as a path, or `null` for a stroke with no points.
 *
 * The samples are joined by the **same Hermite spline the renderers draw**
 * — `strokeCurveAt`, `INK_SEGMENT_SUBDIVISIONS` sub-segments per span — and not
 * by straight lines. A digitiser puts a sample about every millimetre, and a
 * stored path has been simplified on top of that, so consecutive samples can be
 * far apart: a polyline through them shows a corner on every curve, which is
 * exactly what a stroke on a PDF page looked like beside the same stroke on a
 * note. Three sub-segments per span is the count the canvas and the GPU already
 * draw, so this is the geometry, not an approximation of it.
 *
 * The width stays the model's one width per stroke: a reader annotation stores
 * a single `width`, so there is no per-point taper to reproduce here.
 *
 * Takes anything that carries points rather than an `InkStroke` outright,
 * because the PDF reader's ink is a `ReaderAnnotation` anchor, not a note
 * stroke — and both are drawn through the same renderer
 * (`ui/ink-strokes.tsx`), which is the point.
 */
export function strokePath(stroke: { points: readonly number[] }): string | null {
  const points = stroke.points;
  if (points.length < 2) return null;
  const first = `M${num(points[0]!)} ${num(points[1]!)}`;
  // A single point is a dot, and a round cap draws it — hence the zero-length
  // line rather than an empty path.
  if (points.length === 2) return `${first}l0 0`;

  const count = Math.floor(points.length / 2);
  const x = new Float32Array(count);
  const y = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    x[i] = points[i * 2]!;
    y[i] = points[i * 2 + 1]!;
  }
  const input = { x, y, pressure: NO_PRESSURE, width: 0, variableWidth: false };
  let out = first;
  for (let i = 0; i + 1 < count; i += 1) {
    for (let k = 1; k <= INK_SEGMENT_SUBDIVISIONS; k += 1) {
      const at = strokeCurveAt(input, i, k / INK_SEGMENT_SUBDIVISIONS);
      out += `L${num(at.x)} ${num(at.y)}`;
    }
  }
  return out;
}

/**
 * The page as an SVG document.
 *
 * `width`/`height` are in millimetres and the `viewBox` is in 0.1 mm — the
 * model's own unit — so the file prints at A4 whatever its pixel size, and a
 * reader that only wants the numbers gets the same ones the sidecar holds.
 */
export function inkPageSvg(page: InkPage, options: InkSvgOptions = {}): string {
  const palette = options.palette ?? INK_RENDER_COLOURS;
  const width = page.width || INK_A4_WIDTH;
  const height = page.height || INK_A4_HEIGHT;
  const title = options.title ?? "Ink page";

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
      `width="${num(width / 10)}mm" height="${num(height / 10)}mm" ` +
      `viewBox="0 0 ${num(width)} ${num(height)}">`,
  );
  parts.push(`<title>${escapeHtml(title)}</title>`);
  // A page is a sheet of paper: the export is white behind everything, so a
  // viewer with a dark canvas still shows what the page looks like on paper.
  parts.push(
    `<rect x="0" y="0" width="${num(width)}" height="${num(height)}" fill="#ffffff"/>`,
  );
  if (options.backgroundDataUrl) {
    parts.push(
      `<image x="0" y="0" width="${num(width)}" height="${num(height)}" ` +
        `preserveAspectRatio="xMidYMid meet" ` +
        `xlink:href="${escapeHtml(options.backgroundDataUrl)}"/>`,
    );
  }

  // The figures, under the strokes: the same order the sheet draws them
  // (§figure). A crop is a clip at the figure's box with the image enlarged
  // into it — the same arithmetic the DOM uses, in SVG's own units.
  for (const figure of options.figures ?? []) {
    const crop = figure.crop ?? [0, 0, 0, 0];
    const keepX = Math.max(0.01, 1 - (crop[0] + crop[2]) / 100);
    const keepY = Math.max(0.01, 1 - (crop[1] + crop[3]) / 100);
    const drawW = figure.w / keepX;
    const drawH = figure.h / keepY;
    const drawX = figure.x - (crop[0] / 100) * drawW;
    const drawY = figure.y - (crop[1] / 100) * drawH;
    const clipId = `figure-clip-${num(figure.x)}-${num(figure.y)}-${num(figure.w)}-${num(figure.h)}`;
    parts.push(
      `<clipPath id="${clipId}"><rect x="${num(figure.x)}" y="${num(figure.y)}" ` +
        `width="${num(figure.w)}" height="${num(figure.h)}"/></clipPath>`,
    );
    parts.push(
      `<g clip-path="url(#${clipId})"><image x="${num(drawX)}" y="${num(drawY)}" ` +
        `width="${num(drawW)}" height="${num(drawH)}" ` +
        `preserveAspectRatio="none" xlink:href="${escapeHtml(figure.dataUrl)}"/></g>`,
    );
  }

  // The pen first, the highlighter over it — the same order the renderers
  // draw in, and the same reason: a highlighter tints writing it was laid
  // on, and the pen stays legible through the tint.
  for (const pass of ["pen", "highlighter"] as const) {
    const group: string[] = [];
    for (const stroke of page.strokes ?? []) {
      const highlighter = stroke.tool === "highlighter";
      if ((pass === "highlighter") !== highlighter) continue;
      const d = strokePath(stroke);
      if (!d) continue;
      const colour = paletteCss(
        palette,
        (stroke.colour ?? "text") as InkColour,
      );
      group.push(
        `<path d="${d}" fill="none" stroke="${escapeHtml(colour)}" ` +
          `stroke-width="${num(stroke.width)}" stroke-linecap="round" ` +
          `stroke-linejoin="round"` +
          (highlighter ? ` stroke-opacity="${HIGHLIGHTER_ALPHA}"` : "") +
          `/>`,
      );
    }
    if (group.length > 0) parts.push(group.join("\n"));
  }

  parts.push("</svg>");
  return `${parts.join("\n")}\n`;
}

