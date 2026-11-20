"use client";

/**
 * Dev-only ink tuning panel (Ctrl+Alt+Shift+I). Edits the `ink.tuning`
 * workspace setting live and shows input-to-draw latency. Not shipped in
 * production builds: the caller renders it only outside production.
 */
import { useEffect, useState } from "react";
import { Button } from "@/components/button";
import {
  DEFAULT_INK_TUNING,
  INK_TUNING_BOOLS,
  INK_TUNING_RANGES,
  inkTuningSettingsJson,
  readInkTuning,
  resetInkTuning,
  setInkTuning,
  useInkTuning,
} from "../application/ink-tuning";
import { inkLatency } from "../application/ink-latency";

/** True for the panel's hotkey: Ctrl+Alt+Shift+I. */
export function isInkTuningHotkey(event: Pick<KeyboardEvent, "ctrlKey" | "altKey" | "shiftKey" | "code">): boolean {
  return event.ctrlKey && event.altKey && event.shiftKey && event.code === "KeyI";
}

/** A number knob's range and default, as the panel lists it: `(0–1, default 0.6)`. */
export function inkTuningRangeLabel(key: keyof typeof INK_TUNING_RANGES): string {
  const range = INK_TUNING_RANGES[key];
  const fallback = DEFAULT_INK_TUNING[key];
  const low = range.zeroMeans ? `0 (${range.zeroMeans}) or ${range.min}` : String(range.min);
  const shown = fallback === 0 && range.zeroMeans ? range.zeroMeans : String(fallback);
  return `(${low}–${range.max}, default ${shown})`;
}

type Props = { backend: string | null; delegating: boolean };

export function InkTuningPanel({ backend, delegating }: Props) {
  const [open, setOpen] = useState(false);
  const tuning = useInkTuning();
  const [latency, setLatency] = useState(() => inkLatency());

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!isInkTuningHotkey(event)) return;
      event.preventDefault();
      setOpen((prev) => !prev);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    const timer = window.setInterval(() => setLatency(inkLatency()), 500);
    return () => window.clearInterval(timer);
  }, [open]);

  if (!open) return null;
  const ms = (value: number | null) => (value === null ? "–" : `${value.toFixed(1)} ms`);
  const ranges = Object.entries(INK_TUNING_RANGES) as [keyof typeof INK_TUNING_RANGES, (typeof INK_TUNING_RANGES)[keyof typeof INK_TUNING_RANGES]][];

  return (
    <div
      className="card"
      data-ink-tuning-panel=""
      role="dialog"
      aria-label="Ink tuning"
      style={{ position: "fixed", right: 16, bottom: 16, zIndex: 50, width: 300, maxHeight: "70vh", overflowY: "auto", display: "grid", gap: 8 }}
    >
      <strong>Ink tuning</strong>
      <div data-ink-latency="">
        input→draw p50 {ms(latency.p50)} · p95 {ms(latency.p95)} ({latency.count})
        <br />
        backend {backend ?? "starting"} · delegating {delegating ? "yes" : "no"}
      </div>
      {INK_TUNING_BOOLS.map((key) => (
        <label key={key} className="graph-check">
          <input
            className="wf-check"
            type="checkbox"
            checked={tuning[key]}
            onChange={(event) => setInkTuning({ [key]: event.target.checked })}
          />
          {key}
        </label>
      ))}
      <small>Shape knobs (thinning to minWidth) apply to every stroke; holdToShapeMs is not wired yet.</small>
      {ranges.map(([key, range]) => (
        <label key={key} className="graph-slider-row" title={inkTuningRangeLabel(key)}>
          {key}: {tuning[key] === 0 && range.zeroMeans ? range.zeroMeans : tuning[key]} <small>{inkTuningRangeLabel(key)}</small>
          <input
            type="range"
            min={range.zeroMeans ? 0 : range.min}
            max={range.max}
            step={range.step}
            value={tuning[key]}
            onChange={(event) => setInkTuning({ [key]: Number(event.target.value) })}
          />
        </label>
      ))}
      <div style={{ display: "flex", gap: 8 }}>
        <Button variant="link" onClick={() => resetInkTuning()}>Reset to defaults</Button>
        <Button variant="link" onClick={() => void navigator.clipboard?.writeText(inkTuningSettingsJson(readInkTuning()))}>
          Copy JSON
        </Button>
      </div>
    </div>
  );
}
