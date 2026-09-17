/**
 * The Delegated Ink Trail: the OS compositor draws the wet tail between the
 * last frame the worker presented and the pen tip (§6.2.6).
 *
 * This is one of two mutually exclusive low-latency paths, and the choice is
 * made once, before the canvas gets its context: with a presenter the canvas
 * is `desynchronized: false` and prediction is off; without one it is the
 * other way round. So the presenter is requested up front, by the pen hook,
 * and the answer is what the worker's `init` carries.
 *
 * Coded against the WICG shape — `navigator.ink.requestPresenter({
 * presentationArea })` and `updateInkTrailStartPoint(event, { color, diameter
 * })` — and nothing here throws when the API is absent: Firefox, Safari and a
 * test runner all get `null`, which is the fallback path and a no-op trail.
 */

import { INK_A4_WIDTH, type InkColour } from "@weaveforge/core";

import {
  INK_RENDER_COLOURS,
  paletteCss,
  type InkPalette,
} from "../render/ink-palette";

/** The presenter, as this code uses it. The real one has more; a test needs this much. */
export interface InkPresenterLike {
  updateInkTrailStartPoint(event: PointerEvent, style: InkTrailStyle): void;
  /** The area the presenter was asked for; `null` on some implementations. */
  presentationArea?: Element | null;
  /** The older proposal's hint, when a platform still reports it. */
  expectedImprovement?: number;
}

/** The style the trail is drawn with, per event. */
export interface InkTrailStyle {
  /** A CSS colour. */
  color: string;
  /** In CSS pixels. */
  diameter: number;
}

/** `navigator`, as far as the trail reads it. */
export interface InkNavigatorLike {
  ink?: {
    requestPresenter(param?: {
      presentationArea?: Element;
    }): Promise<InkPresenterLike>;
  };
}

/**
 * Ask the platform for a presenter over `area`. `null` where there is none, or
 * the request is refused — never a throw, because the fallback path is the
 * ordinary one and an absent API is not an error.
 */
export async function requestInkPresenter(
  area: Element,
  nav: InkNavigatorLike | null | undefined = typeof navigator === "undefined"
    ? null
    : (navigator as unknown as InkNavigatorLike),
): Promise<InkPresenterLike | null> {
  const ink = nav?.ink;
  if (!ink || typeof ink.requestPresenter !== "function") return null;
  try {
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 500));
    const presenter = await Promise.race([
      ink.requestPresenter({ presentationArea: area }),
      timeout,
    ]);
    if (!presenter || typeof presenter.updateInkTrailStartPoint !== "function")
      return null;
    return presenter;
  } catch {
    return null;
  }
}

/**
 * A nib width in page units (0.1 mm) as CSS pixels on a page drawn `pageWidthPx`
 * wide. The diameter follows the same filtered width the worker bakes into
 * geometry, so the trail is the stroke's own thickness and there is no step
 * where the tail meets the dry ink.
 */
export function trailDiameterPx(width: number, pageWidthPx: number): number {
  if (!(width > 0) || !(pageWidthPx > 0)) return 1;
  return Math.max(1, (width / INK_A4_WIDTH) * pageWidthPx);
}

/** The trail's colour for a palette name: the renderer's own sRGB, as CSS. */
export function trailColour(
  colour: InkColour,
  alpha = 1,
  palette: InkPalette = INK_RENDER_COLOURS,
): string {
  return paletteCss(palette, colour, alpha);
}

/**
 * The style for one live sample: colour from the tool, diameter from the
 * filtered width. A highlighter's trail is translucent like its ink.
 */
export function trailStyle(input: {
  colour: InkColour;
  tool: "pen" | "highlighter";
  width: number;
  pageWidthPx: number;
  /** The theme's colours; the light defaults when omitted. */
  palette?: InkPalette;
}): InkTrailStyle {
  return {
    color: trailColour(
      input.colour,
      input.tool === "highlighter" ? 0.35 : 1,
      input.palette,
    ),
    diameter: trailDiameterPx(input.width, input.pageWidthPx),
  };
}

/**
 * Move the trail's start point for a dispatched event. A presenter that
 * throws — an untrusted event, a detached area — is dropped for the session,
 * which is the fallback path minus prediction: still correct, only slower.
 */
export function updateTrail(
  presenter: InkPresenterLike,
  event: PointerEvent,
  style: InkTrailStyle,
): boolean {
  try {
    presenter.updateInkTrailStartPoint(event, style);
    return true;
  } catch {
    return false;
  }
}
