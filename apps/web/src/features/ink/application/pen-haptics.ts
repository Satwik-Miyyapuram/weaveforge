/**
 * The pen's own haptics (docs/internal/design/ink-native-bridges.md §4).
 *
 * A Surface Slim Pen 2 has an actuator in the barrel; driven with the pencil
 * waveform at an intensity set from pressure and speed, it feels like graphite
 * on paper — and, held still, like nothing, since friction is kinetic. The
 * engine that drives it lives in the desktop app's helper process; this side
 * only decides *what* to send and *how often*: one sample every ~8 ms at most,
 * with the velocity in the units the engine's gate is tuned in, and a stop the
 * moment the pen lifts.
 *
 * Nothing here is used unless the desktop bridge says the OS has the API. A
 * browser, or a Mac, gets a no-op.
 */

import type { DesktopInkHaptics } from "@/lib/desktop/desktop-bridge";

import type { FilteredNibSample } from "./one-euro-filter";

/** How often a sample goes down the pipe: 120 Hz, the digitiser's own rate. */
const UPDATE_INTERVAL_MS = 8;

/**
 * Ink units are 0.1 mm; the engine's velocity gate is in CSS px/ms (§4.2),
 * which at 96 dpi is 25.4 / 96 mm per px — so 2.6458 ink units per px.
 */
const INK_UNITS_PER_CSS_PX = (25.4 / 96) * 10;

export interface PenHapticsSink {
  inkHaptics(message: DesktopInkHaptics): void;
}

/** The tools the engine has a waveform for: graphite, felt, rubber. */
export type PenHapticsTool = Extract<
  DesktopInkHaptics,
  { type: "tool" }
>["tool"];

export interface PenHaptics {
  /** The tool the next stroke draws with; the waveform follows it. */
  setTool(tool: PenHapticsTool): void;
  /** One filtered sample of the stroke in flight. Throttled here. */
  update(sample: FilteredNibSample): void;
  /** The pen lifted: silence, at once and unthrottled. */
  stop(): void;
}

export function createPenHaptics(
  sink: PenHapticsSink,
  now: () => number = () =>
    typeof performance === "undefined" ? Date.now() : performance.now(),
): PenHaptics {
  let lastSent = -Infinity;
  let playing = false;
  return {
    setTool(tool) {
      sink.inkHaptics({ type: "tool", tool });
    },
    update(sample) {
      const t = now();
      if (t - lastSent < UPDATE_INTERVAL_MS) return;
      lastSent = t;
      playing = true;
      sink.inkHaptics({
        type: "update",
        pressure: Math.max(0, Math.min(1, sample.pressure)),
        velocity: Math.max(0, sample.velocity) / INK_UNITS_PER_CSS_PX,
      });
    },
    stop() {
      if (!playing) return;
      playing = false;
      lastSent = -Infinity;
      sink.inkHaptics({ type: "stop" });
    },
  };
}
