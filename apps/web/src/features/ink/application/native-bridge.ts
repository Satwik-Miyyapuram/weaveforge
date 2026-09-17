/**
 * The native inking bridge (docs/internal/design/ink-native-bridges.md §1).
 *
 * A native shell — today the Android wrapper in `apps/android` — can lay a
 * hardware-rendered overlay over the page and take the stylus itself: the wet
 * stroke is drawn front-buffered at the digitiser's rate, the palm is refused
 * by the driver's own flags and by hover proximity, and when the pen lifts the
 * finished stroke comes back here as one flat array. The web app then runs the
 * same pipeline it runs for its own pointer events — the gate, the filter, the
 * worker — so the note is the same note whichever surface drew it.
 *
 * Nothing here is used unless the shell has installed itself on `window`; a
 * browser without a shell never sees any of it.
 */

import type { InkColour, InkHand } from "@weaveforge/core";

import type { PenPointerEvent } from "./use-pen-capture";
import { trailColour } from "./ink-trail";

/**
 * What the Android shell exposes through `addJavascriptInterface`. Only
 * primitives cross that boundary, which is why the viewport is five numbers
 * and not an object; the shape in the design note's §1.1 is realised by
 * {@link NativeInkBridge} on this side.
 */
interface AndroidInkingBridge {
  setViewport(
    left: number,
    top: number,
    width: number,
    height: number,
    dpr: number,
  ): void;
  clearViewport(): void;
  setTool(colourArgb: string, widthPx: number): void;
  setPenOnly(enabled: boolean): void;
  setHandedness(hand: string): void;
  clearOverlay(): void;
}

/** The shell, as the app sees it. */
export interface NativeInkBridge {
  readonly platform: "android";
  /** The ink page's box in CSS pixels; the overlay inks only inside it. */
  setViewport(box: {
    left: number;
    top: number;
    width: number;
    height: number;
  }): void;
  /** No page on screen: every stylus event goes to the web view. */
  clearViewport(): void;
  setTool(input: {
    tool: "pen" | "highlighter";
    colour: InkColour;
    widthPx: number;
  }): void;
  setPenOnly(enabled: boolean): void;
  setHandedness(hand: InkHand): void;
  /** The overlay's wet stroke is gone; the worker has the committed one. */
  clearOverlay(): void;
}

/** The points a native stroke arrives as: `[x, y, pressure, t, …]` in view pixels. */
export type NativeStrokePoints = ArrayLike<number>;

declare global {
  interface Window {
    AndroidInkingBridge?: AndroidInkingBridge;
    onNativeStrokeComplete?: (points: NativeStrokePoints) => void;
  }
}

/** The bridge the shell installed, or `null` in a plain browser. */
export function nativeInkBridge(): NativeInkBridge | null {
  if (typeof window === "undefined") return null;
  const android = window.AndroidInkingBridge;
  if (!android || typeof android.setTool !== "function") return null;
  return {
    platform: "android",
    setViewport: (box) =>
      android.setViewport(
        box.left,
        box.top,
        box.width,
        box.height,
        window.devicePixelRatio || 1,
      ),
    clearViewport: () => android.clearViewport(),
    setTool: ({ tool, colour, widthPx }) =>
      android.setTool(
        argbHex(colour, tool === "highlighter" ? 0.35 : 1),
        widthPx,
      ),
    setPenOnly: (enabled) => android.setPenOnly(enabled),
    setHandedness: (hand) => android.setHandedness(hand),
    clearOverlay: () => android.clearOverlay(),
  };
}

/**
 * Install the handoff the shell calls on pen lift. Returns the uninstall; the
 * host mounts and unmounts it with the page, so a stroke arriving with no page
 * open is dropped rather than drawn on the wrong note.
 */
export function installNativeStrokeHandler(
  handler: (points: NativeStrokePoints) => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  window.onNativeStrokeComplete = handler;
  return () => {
    if (window.onNativeStrokeComplete === handler)
      delete window.onNativeStrokeComplete;
  };
}

/**
 * A native stroke as the events the capture session already understands.
 *
 * The overlay's coordinates are view pixels from the window's top-left, which
 * is `clientX × dpr`; the timestamps are the device's uptime clock, which is
 * not `performance.now()`'s origin but is monotonic, and the filter only ever
 * looks at differences. Everything is a pen, since the overlay took nothing
 * else.
 */
export function nativeStrokeEvents(
  points: NativeStrokePoints,
  dpr: number,
  pointerId = -1,
): PenPointerEvent[] {
  const events: PenPointerEvent[] = [];
  const scale = dpr > 0 ? 1 / dpr : 1;
  for (let i = 0; i + 3 < points.length; i += 4) {
    const pressure = points[i + 2]!;
    events.push({
      pointerId,
      pointerType: "pen",
      pressure: Number.isFinite(pressure)
        ? Math.max(0, Math.min(1, pressure))
        : 0.5,
      width: 1,
      height: 1,
      clientX: points[i]! * scale,
      clientY: points[i + 1]! * scale,
      t: points[i + 3]!,
    });
  }
  return events;
}

/** `#AARRGGBB`, which is what Android's `Color.parseColor` reads. */
function argbHex(colour: InkColour, alpha: number): string {
  const match = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(trailColour(colour, 1));
  const [r, g, b] = match
    ? [match[1], match[2], match[3]].map(Number)
    : [0, 0, 0];
  const hex = (value: number) =>
    Math.round(value).toString(16).padStart(2, "0");
  return `#${hex(alpha * 255)}${hex(r!)}${hex(g!)}${hex(b!)}`;
}
