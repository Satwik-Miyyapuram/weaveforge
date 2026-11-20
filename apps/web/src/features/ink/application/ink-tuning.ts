/**
 * The ink tuning knobs: one typed object under `ink.tuning` in the workspace
 * settings file. Defaults live here; a stored value only overrides them, and
 * every value is clamped to its range or dropped back to the default.
 *
 * Reads are cheap and always current (the cache is keyed on the stored value),
 * so a change applies on the next stroke or the next page open, whichever is
 * when the knob is read:
 *
 * - next stroke: `prediction`, `predictionMs`, `wetLayerAboveSvg`,
 *   `presenterTimeoutMs`, `delegateNavigatorInk`, the input knobs
 *   (`inputSmoothing`, `resampleSpacing`, both renderers) and the shape knobs
 *   (`thinning`, `smoothing`, `streamline`, `taperStart`, `taperEnd`,
 *   `pressureGamma`, `minWidth`: the freehand renderer only; classic draws a
 *   constant-width nib). A shape change redraws the page's freehand strokes too;
 * - next page open (the worker and its context are made then): `wetDesynchronized`,
 *   `forceBackend`, `renderer`, `wetDpr`;
 * - stored only, for later: `holdToShapeMs`.
 *
 * The dev panel (`ink-tuning-panel.tsx`) is the only writer besides a hand edit.
 */
import { useSyncExternalStore } from "react";

import { workspaceSettings } from "@/features/settings/application/workspace-settings";

export const INK_TUNING_KEY = ["ink", "tuning"] as const;

export type InkForceBackend = "auto" | "webgl2" | "2d";
export type InkTuningRenderer = "setting" | "classic" | "freehand";

export interface InkTuning {
  /** Latency: `desynchronized` on the fallback path's WebGL context. */
  wetDesynchronized: boolean;
  /** Latency: raise the wet canvas over the sheet's SVG for the stroke. */
  wetLayerAboveSvg: boolean;
  forceBackend: InkForceBackend;
  /** How long a stroke waits for the OS ink presenter before drawing itself. */
  presenterTimeoutMs: number;
  /** Ask for `navigator.ink` at all. */
  delegateNavigatorInk: boolean;
  /** Wet-layer device pixel ratio; 0 means the device's. */
  wetDpr: number;
  thinning: number;
  smoothing: number;
  streamline: number;
  taperStart: number;
  taperEnd: number;
  pressureGamma: number;
  minWidth: number;
  /** Input smoothing: average each position with this many previous ones; 0 is off. */
  inputSmoothing: number;
  prediction: boolean;
  /**
   * Cap on how far ahead the browser's predicted samples may reach; 0 takes all
   * it gives. It can only shorten the browser's prediction, not extend it.
   */
  predictionMs: number;
  /** Drop a sample closer than this (0.1 mm) to the last one kept; 0 is off. */
  resampleSpacing: number;
  renderer: InkTuningRenderer;
  /** Hold the pen still this long at a stroke's end to snap it to a shape; 0 is off. */
  holdToShapeMs: number;
}

export const DEFAULT_INK_TUNING: Readonly<InkTuning> = Object.freeze({
  wetDesynchronized: true,
  wetLayerAboveSvg: true,
  forceBackend: "auto",
  presenterTimeoutMs: 500,
  delegateNavigatorInk: true,
  wetDpr: 0,
  thinning: 0.6,
  smoothing: 0.5,
  streamline: 0.5,
  taperStart: 0,
  taperEnd: 0,
  pressureGamma: 1,
  minWidth: 0,
  inputSmoothing: 0,
  prediction: true,
  predictionMs: 0,
  resampleSpacing: 0,
  renderer: "setting",
  holdToShapeMs: 0,
});

type NumberKey = { [K in keyof InkTuning]: InkTuning[K] extends number ? K : never }[keyof InkTuning];
type BoolKey = { [K in keyof InkTuning]: InkTuning[K] extends boolean ? K : never }[keyof InkTuning];

/** Each number knob's range and slider step. `zeroMeans` lets 0 sit below `min`. */
export const INK_TUNING_RANGES: Record<NumberKey, { min: number; max: number; step: number; zeroMeans?: string }> = {
  presenterTimeoutMs: { min: 0, max: 2000, step: 50 },
  wetDpr: { min: 0.5, max: 3, step: 0.25, zeroMeans: "device" },
  thinning: { min: 0, max: 1, step: 0.05 },
  smoothing: { min: 0, max: 1, step: 0.05 },
  streamline: { min: 0, max: 1, step: 0.05 },
  taperStart: { min: 0, max: 200, step: 5 },
  taperEnd: { min: 0, max: 200, step: 5 },
  pressureGamma: { min: 0.2, max: 3, step: 0.1 },
  minWidth: { min: 0, max: 1, step: 0.05 },
  inputSmoothing: { min: 0, max: 16, step: 1 },
  predictionMs: { min: 0, max: 50, step: 1 },
  resampleSpacing: { min: 0, max: 10, step: 0.5 },
  holdToShapeMs: { min: 0, max: 2000, step: 50 },
};

export const INK_TUNING_BOOLS: readonly BoolKey[] = [
  "wetDesynchronized",
  "wetLayerAboveSvg",
  "delegateNavigatorInk",
  "prediction",
];
export const INK_FORCE_BACKENDS: readonly InkForceBackend[] = ["auto", "webgl2", "2d"];
export const INK_TUNING_RENDERERS: readonly InkTuningRenderer[] = ["setting", "classic", "freehand"];

function clampNumber(key: NumberKey, value: unknown): number {
  const fallback = DEFAULT_INK_TUNING[key];
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const range = INK_TUNING_RANGES[key];
  if (range.zeroMeans !== undefined && value === 0) return 0;
  return Math.min(range.max, Math.max(range.min, value));
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly unknown[]).includes(value) ? (value as T) : fallback;
}

/** Any stored value to a full, in-range tuning. */
export function parseInkTuning(raw: unknown): InkTuning {
  const src: Record<string, unknown> =
    raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out = { ...DEFAULT_INK_TUNING } as InkTuning;
  for (const key of Object.keys(INK_TUNING_RANGES) as NumberKey[]) out[key] = clampNumber(key, src[key]);
  for (const key of INK_TUNING_BOOLS) {
    if (typeof src[key] === "boolean") out[key] = src[key];
  }
  out.forceBackend = oneOf(src.forceBackend, INK_FORCE_BACKENDS, DEFAULT_INK_TUNING.forceBackend);
  out.renderer = oneOf(src.renderer, INK_TUNING_RENDERERS, DEFAULT_INK_TUNING.renderer);
  return out;
}

let cache: InkTuning = { ...DEFAULT_INK_TUNING };
let seen: unknown = undefined;

/** The tuning in force now. Stable by identity until the stored value changes. */
export function readInkTuning(): InkTuning {
  const raw = workspaceSettings.get(INK_TUNING_KEY);
  if (raw !== seen) {
    seen = raw;
    cache = parseInkTuning(raw);
  }
  return cache;
}

export function setInkTuning(patch: Partial<InkTuning>): void {
  workspaceSettings.set(INK_TUNING_KEY, parseInkTuning({ ...readInkTuning(), ...patch }));
}

/** Back to the defaults: the key leaves the settings file. */
export function resetInkTuning(): void {
  workspaceSettings.set(INK_TUNING_KEY, undefined);
}

/** The wet layer's device pixel ratio: `wetDpr`, or `device` when it is 0 (the device's own). */
export function inkWetDpr(wetDpr: number, device: number): number {
  return wetDpr > 0 ? wetDpr : device;
}

/**
 * The tuning as the settings file holds it (`{ "ink": { "tuning": … } }`), for
 * the panel's Copy JSON: pasted into an empty `.weaveforge/settings.json` it is
 * the whole file, and into a full one it is the `ink` entry to merge.
 */
export function inkTuningSettingsJson(tuning: InkTuning): string {
  const [outer, inner] = INK_TUNING_KEY;
  return JSON.stringify({ [outer]: { [inner]: tuning } }, null, 2);
}

export function subscribeInkTuning(listener: () => void): () => void {
  return workspaceSettings.subscribe(listener);
}

export function useInkTuning(): InkTuning {
  return useSyncExternalStore(subscribeInkTuning, readInkTuning, () => DEFAULT_INK_TUNING);
}
