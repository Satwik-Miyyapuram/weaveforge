"use client";

/**
 * One stroke's capture, in fields rather than in state.
 *
 * Split out of `use-pen-capture.ts` when that file crossed the repository's
 * hygiene ceiling. The session is the part of capture that never touches
 * React: it is driven by pointer events, writes to its own fields, and tells
 * the worker — which draws — as the stroke grows. The hook that mounts one
 * and the React state around it stay in `use-pen-capture.ts`.
 */

import { nibWidth, type InkColour } from "@weaveforge/core";

import { NibFilter, type FilteredNibSample } from "./one-euro-filter";
import { type InkSampleWriter, type InkStrokeHeader } from "./capture-protocol";
import { InkPenGate, type PenClaim, type PenGateEvent } from "./pen-gate";

/* -------------------------------------------------------------------------
 * The session: samples in, worker out
 * ------------------------------------------------------------------------- */

/** The pointer fields the session reads; a `PointerEvent` satisfies this. */
export interface PenPointerEvent extends PenGateEvent {
  buttons?: number;
  /** The platform event itself, which is what a presenter must be handed. */
  native?: PointerEvent;
  /** Coalesced events, when the platform provides them. */
  getCoalescedEvents?: () => PenPointerEvent[];
  /** Predicted events, used **only** when not delegating (D11). */
  getPredictedEvents?: () => PenPointerEvent[];
}

/** The tool in force, which a stroke copies when it begins. */
export interface InkToolChoice {
  width: number;
  tool: InkStrokeHeader["tool"];
  /** The palette name the stroke paints with, never a hex. */
  colour: InkColour;
  pageIndex: number;
}

export interface PenCaptureDeps {
  gate: InkPenGate;
  filter: NibFilter;
  writer: InkSampleWriter;
  /** Client coordinates to page units in 0.1 mm, `null` when off the page. */
  project: (
    clientX: number,
    clientY: number,
  ) => { x: number; y: number } | null;
  /**
   * The newest filtered sample and its instantaneous width, for the trail.
   * `event` is the dispatched sample — the one a presenter may be handed —
   * and is absent for a coalesced one.
   */
  onLive?: (
    sample: FilteredNibSample,
    width: number,
    event?: PenPointerEvent,
  ) => void;
  /**
   * The worker acknowledged a stroke. The **only** thing a screen may re-render
   * for, once per stroke.
   */
  onStrokeEnd?: (
    header: InkStrokeHeader,
    points: Float32Array,
    pressures: Uint8Array,
  ) => void;
  /** Whether predicted events may be used: false while delegating (§6.2.6). */
  predict?: () => boolean;
  /** A pointer whose stroke a late palm decision cancelled. */
  onCancelled?: (pointerId: number) => void;
}

/**
 * One stroke's worth of capture, in fields rather than in state.
 *
 * Every method is driven by a pointer event and writes to ref-held fields;
 * nothing calls into React. The worker is told about the live stroke as it grows
 * and is the thing that draws it, so the main thread's whole job is: gate the
 * pointer, filter the sample, forward the batch.
 */
export class PenCaptureSession {
  private strokeId = 0;
  private header: InkStrokeHeader | null = null;
  private pointerId: number | null = null;
  /** Real samples only — predicted ones ride the live tail and never commit. */
  private readonly points: number[] = [];
  private readonly pressures: number[] = [];
  private newest: PenPointerEvent | null = null;
  /** The last real sample consumed, so a repeat of it is dropped (see `consume`). */
  private lastRaw: { x: number; y: number; t: number } | null = null;
  /** The tool a stroke will use, remembered so a confirmed touch can begin. */
  private tool: InkToolChoice = {
    width: 6,
    tool: "pen",
    colour: "text",
    pageIndex: 0,
  };

  constructor(private readonly deps: PenCaptureDeps) {}

  /** Whether a stroke is in progress. */
  get active(): boolean {
    return this.header !== null;
  }

  /** The stroke the worker is drawing, for a status-bar readout. */
  get activeStrokeId(): number {
    return this.strokeId;
  }

  /** Real samples captured for the stroke in progress. */
  get sampleCount(): number {
    return this.pressures.length;
  }

  /** The newest raw event, which the deferral timer tests for movement. */
  get newestEvent(): PenPointerEvent | null {
    return this.newest;
  }

  /** Remember the tool the ink bar is showing. */
  setTool(tool: InkToolChoice): void {
    this.tool = tool;
  }

  /**
   * A pointer went down.
   *
   * Returns the claim so the caller can arm the deferral timer and discard a
   * cancelled stroke. A `defer` is not a stroke yet: nothing is filtered and
   * nothing is sent until {@link confirmTouch} says the touch moved.
   */
  pointerDown(event: PenPointerEvent): PenClaim {
    const claim = this.deps.gate.begin(event);
    for (const pointerId of claim.cancelled) {
      this.deps.onCancelled?.(pointerId);
      if (pointerId === this.pointerId) this.abort();
    }
    if (claim.decision !== "draw") return claim;
    this.beginStroke(event);
    return claim;
  }

  /** The deferral timer's answer for a deferred touch. */
  confirmTouch(
    at: { x: number; y: number } | null,
    event: PenPointerEvent | null,
  ): void {
    const pointerId = event?.pointerId ?? this.pointerId;
    if (pointerId === null) return;
    if (this.deps.gate.confirm(pointerId, at) !== "draw" || !event) return;
    this.beginStroke(event);
  }

  /**
   * A raw pointer update: the coalesced events *and* the dispatched one.
   *
   * `getCoalescedEvents()` returns the events merged *into* this dispatch and
   * deliberately does not include the dispatch itself, so consuming only the
   * coalesced list drops the newest sample every frame.
   */
  pointerRawUpdate(event: PenPointerEvent): void {
    if (!this.active || event.pointerId !== this.pointerId) return;
    this.newest = event;
    for (const sample of safeEvents(event.getCoalescedEvents?.bind(event))) {
      this.consume(sample, false);
    }
    this.consume(event, false, false, true);

    // Prediction is for the fallback path only: while the OS is drawing the wet
    // tail, predicting as well forks the stroke (§6.2.6, D11). Predicted samples
    // are flushed on their own so the worker can tell them from real ones and
    // replace the tail rather than commit it.
    if (this.predicts) {
      const predicted = safeEvents(event.getPredictedEvents?.bind(event));
      if (predicted.length > 0) {
        // The real samples pending in the writer go out first, as their own
        // message. A flush carries everything in the buffer under one flag, so
        // flushing them together with the predicted tail would mark the real
        // samples predicted too — and the worker discards a predicted tail when
        // the next samples arrive, so most of the stroke would be lost, leaving
        // only whatever the per-frame flush happened to send: a polyline of the
        // few survivors.
        this.deps.writer.flush("samples", this.header!);
        for (const sample of predicted) this.consume(sample, false, true);
        this.deps.writer.flush("samples", this.header!, true);
      }
    }
  }

  /** The pointer came up: hand the stroke to the worker. */
  pointerUp(event: PenPointerEvent): void {
    if (this.active && event.pointerId === this.pointerId) {
      this.consume(event, false, false, true);
      const header = this.header!;
      this.deps.writer.flush("stroke-end", header);
      this.clear();
    }
    // The gate's claim is released whether or not a stroke was running: a
    // pointer that was cancelled before its first sample landed, or that never
    // began a stroke, must not keep every later pen out.
    this.deps.gate.end(event.pointerId);
  }

  /** The worker acknowledged the stroke: the screen may re-render now. */
  committed(
    header: InkStrokeHeader,
    points: Float32Array,
    pressures: Uint8Array,
  ): void {
    this.deps.onStrokeEnd?.(header, points, pressures);
  }

  /** Discard the stroke in progress, because a palm decision arrived late. */
  abort(): void {
    this.clear();
    this.deps.filter.reset();
  }

  /** Once per frame: get the pending samples to the worker. */
  flush(): void {
    if (!this.header) return;
    this.deps.writer.flush("samples", this.header);
  }

  private get predicts(): boolean {
    return this.deps.predict?.() ?? false;
  }

  /** Start a stroke from an event that has earned one. */
  private beginStroke(event: PenPointerEvent): void {
    this.strokeId += 1;
    this.pointerId = event.pointerId;
    this.header = {
      strokeId: this.strokeId,
      pageIndex: this.tool.pageIndex,
      width: this.tool.width,
      tool: this.tool.tool,
      colour: this.tool.colour,
    };
    this.points.length = 0;
    this.pressures.length = 0;
    this.newest = event;
    this.deps.filter.reset();
    // A stroke whose first sample does not land on the page is not a stroke: the
    // pen came down on the paper's margin or outside it, and telling the worker
    // to begin one would leave it waiting for a stroke that never arrives.
    if (!this.consume(event, true, false, true)) {
      this.clear();
      this.deps.gate.end(event.pointerId);
      return;
    }
    this.deps.writer.flush("stroke-begin", this.header);
  }

  private clear(): void {
    this.header = null;
    this.pointerId = null;
    this.points.length = 0;
    this.pressures.length = 0;
    this.lastRaw = null;
  }

  /** Filter one pointer sample and write it into the batch. */
  private consume(
    event: PenPointerEvent,
    first: boolean,
    predicted = false,
    dispatched = false,
  ): boolean {
    const header = this.header;
    if (!header) return false;
    if (!first && event.pointerId !== this.pointerId) return false;
    const projected = this.deps.project(event.clientX ?? 0, event.clientY ?? 0);
    if (!projected) return false;

    // A coalesced or predicted event is the platform's own `PointerEvent`,
    // which carries `timeStamp`, not `t`; a `NaN` here would poison the
    // filter's `dt` and every sample after it.
    const t = Number.isFinite(event.t)
      ? event.t
      : ((event as unknown as { timeStamp?: number }).timeStamp ??
        (typeof performance === "undefined" ? Date.now() : performance.now()));
    // The dispatched `pointermove` is also the last entry of its own coalesced
    // list, and a `pointerup` usually repeats the last move. A repeated sample
    // has `dt = 0`, which the filter can only answer by passing the raw value
    // through — so every frame boundary would be an unfiltered point — and it
    // halves the spacing the renderer reads speed from, so the width would
    // dip at every frame boundary too. It is not new information; drop it.
    if (
      !first &&
      !predicted &&
      this.lastRaw &&
      this.lastRaw.t === t &&
      this.lastRaw.x === projected.x &&
      this.lastRaw.y === projected.y
    )
      return false;
    if (!predicted) this.lastRaw = { x: projected.x, y: projected.y, t };
    const sample = this.deps.filter.filter({
      x: projected.x,
      y: projected.y,
      pressure: event.pressure ?? 0,
      t,
    });
    const width = nibWidth(header.width, sample.pressure, sample.velocity);
    // The trail is told where to start *before* the sample is posted, and with
    // the same filtered width the worker will bake into geometry. A predicted
    // sample is not where the pen has been, so the trail is not moved for it.
    if (!predicted)
      this.deps.onLive?.(sample, width, dispatched ? event : undefined);

    if (!predicted) {
      this.points.push(sample.x, sample.y);
      this.pressures.push(sample.pressure);
    }
    this.deps.writer.push(
      sample.x,
      sample.y,
      sample.pressure,
      sample.t,
      header,
    );
    return true;
  }

  /** The stroke's real samples, for a host that packs them itself. */
  takeStroke(): { points: number[]; pressures: number[] } {
    return { points: [...this.points], pressures: [...this.pressures] };
  }
}

/** Coalesced/predicted lists are optional and may throw on a synthetic event. */
function safeEvents(
  read: (() => PenPointerEvent[]) | undefined,
): PenPointerEvent[] {
  if (!read) return [];
  try {
    const events = read();
    return Array.isArray(events) ? events : [];
  } catch {
    return [];
  }
}
