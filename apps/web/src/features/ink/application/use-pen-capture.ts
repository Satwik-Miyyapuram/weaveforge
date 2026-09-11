"use client";

/**
 * Pen capture: which pointer may draw, what the samples are, and where they go.
 *
 * This is the reader's palm handling lifted out and made shared — the same rule
 * set, in one place, so the reader and an ink note cannot disagree about what a
 * resting hand is. What the reader has today (`use-page-pointer.ts`: once a pen
 * has been seen, touch never draws again; one pointer owns a stroke) is
 * {@link InkPenGate}, and its three palm layers are the plan's §3.
 *
 * Two things here are new, and both come from the plan's measurements:
 *
 * - **The live stroke never enters React state.** {@link PenCaptureSession} is a
 *   plain object with plain fields. A 240 Hz digitiser produces more samples per
 *   second than React renders frames, so a `setState` per sample would be a render
 *   per sample; the session therefore contains no state setter at all, which is a
 *   structural guarantee rather than a promise. The only things the screen
 *   re-renders for are `penSeen` — once per session — and a committed stroke,
 *   which the worker reports once.
 * - **Filtering happens once, here, for both consumers.** The delegated trail
 *   needs a diameter now and the worker needs the width it bakes into geometry
 *   (§6.2.5). One {@link NibFilter} feeds both.
 *
 * The reader keeps its own React draft preview: it paints the in-progress stroke
 * as an SVG path in its JSX, and moving that into an offscreen worker is a change
 * to the reader's *rendering*, not to its capture. The gate is what the two
 * features share; the ink host is what uses the worker.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { nibWidth, type InkHand } from "@weaveforge/core";

import { NibFilter, type FilteredNibSample } from "./one-euro-filter";
import {
  InkSamplePool,
  InkSampleWriter,
  type InkStrokeHeader,
  type InkTransferMode,
  type InkWorkerEvent,
  type InkWorkerMessage,
} from "./capture-protocol";

/* -------------------------------------------------------------------------
 * The palm rules
 * ------------------------------------------------------------------------- */

/**
 * Contact area above which a touch is a hand rather than a fingertip, in mm².
 *
 * `PointerEvent.width`/`height` are **CSS pixels**, not millimetres, so the
 * comparison converts with the CSS definition of a pixel (1/96 inch) rather than
 * pretending the two are the same unit — the trap §3.2 names. A pen nib reports a
 * contact well under a square millimetre; a resting palm reports tens of them.
 */
export const PALM_CONTACT_AREA_MM2 = 25;

/** CSS pixels per millimetre: 96 px to the inch, 25.4 mm to the inch. */
export const CSS_PX_PER_MM = 96 / 25.4;

/** A pen down within this window of a touch makes the quadrant rule apply (§3.2). */
export const PALM_PEN_GRACE_MS = 300;

/** How long a touch must stay put before it counts as a palm, not a finger. */
export const TOUCH_DEFER_MS = 120;

/** Movement that makes a deferred touch a finger rather than a palm, in CSS px. */
export const TOUCH_MOVE_SLOP_PX = 2;

/** A second touch this soon after the first cancels the first as a palm. */
export const PALM_SECOND_TOUCH_MS = 150;

/** What the caller should do with a pointer. */
export type PenDecision = "draw" | "defer" | "ignore";

/** Why a touch was taken for a palm, for a test or a diagnostic readout. */
export type PalmReason = "area" | "quadrant";

/** The pointer fields the rules read. A `PointerEvent` satisfies this. */
export interface PenGateEvent {
  pointerId: number;
  pointerType: string;
  pressure?: number;
  /** Contact box in CSS pixels. `0` on a device that does not report one. */
  width?: number;
  height?: number;
  clientX?: number;
  clientY?: number;
  /** The drawing surface's box in client coordinates, for the quadrant rule. */
  bounds?: { left: number; top: number; width: number; height: number };
  /** Milliseconds, from the event's own clock. */
  t: number;
}

/** The gate's answer, including any stroke a late palm decision invalidated. */
export interface PenClaim {
  decision: PenDecision;
  /**
   * Pointers whose in-progress stroke must be thrown away: a second touch
   * arriving within {@link PALM_SECOND_TOUCH_MS} means neither was writing.
   */
  cancelled: number[];
}

/**
 * The three palm layers, as one deterministic object.
 *
 * No pressure-based guessing, no classifier, no `tiltX` heuristics: every rule
 * below is a comparison on values a `PointerEvent` carries already, so each is
 * testable with a synthetic event and a user can predict what their own tablet
 * will do.
 *
 * `defer` is not a fourth opinion — it is rule five, the no-move rule, which
 * cannot be decided from a single event. The caller arms a {@link TOUCH_DEFER_MS}
 * timer and reports the answer through {@link InkPenGate.confirm}. Deferral
 * applies to **touch only**: a pen starts immediately, because deferring a pen by
 * 120 ms would add exactly the latency this feature exists to remove.
 */
export class InkPenGate {
  /** Layer three: the wrist guard. While it is on, a finger never draws. */
  penOnly: boolean;
  handedness: InkHand;

  private sawPen = false;
  private activeId: number | null = null;
  private activeIsTouch = false;
  private activeStartedAt = 0;
  /** Where the stroke in progress began, and the box it began on. */
  private activeOrigin: { x: number; y: number } | null = null;
  private activeBounds: PenGateEvent["bounds"];
  private lastPenDownAt = Number.NEGATIVE_INFINITY;
  private readonly deferred = new Map<number, { x: number; y: number }>();

  constructor(options: { handedness?: InkHand; penOnly?: boolean } = {}) {
    this.handedness = options.handedness ?? "right";
    this.penOnly = options.penOnly ?? false;
  }

  /** Whether a stylus has ever touched this surface. Mirrored for `touch-action`. */
  get hasSeenPen(): boolean {
    return this.sawPen;
  }

  /** The pointer that owns the stroke in progress, or `null`. */
  get activePointerId(): number | null {
    return this.activeId;
  }

  /** A pen was seen without drawing on this surface — a hover, say. */
  notePenSeen(t: number): void {
    this.sawPen = true;
    this.lastPenDownAt = Math.max(this.lastPenDownAt, t);
  }

  /**
   * Why a touch is a palm, or `null` when nothing says it is one.
   *
   * Two of §3.2's signals, classified rather than folded into a boolean, because
   * what the gate does about them differs: a contact the size of a hand and a
   * contact in the corner the writing hand rests in are both palms, and saying so
   * out loud is what makes the quadrant rule — "the rule most likely to be wrong,
   * and therefore the first thing 'Pen only' overrides" — testable on its own.
   *
   * The quadrant half needs a pen down within {@link PALM_PEN_GRACE_MS} and the
   * surface's box. The touch that lands *after* the pen is already refused by
   * layer one, so what this classifies in practice is the hand that landed first:
   * it is deferred, and a pen arriving inside the window turns it into a palm.
   */
  palmReason(event: PenGateEvent): PalmReason | null {
    if (event.pointerType !== "touch") return null;
    if (contactAreaMm2(event) > PALM_CONTACT_AREA_MM2) return "area";
    const penRecently = this.lastPenDownAt !== Number.NEGATIVE_INFINITY
      && Math.abs(event.t - this.lastPenDownAt) <= PALM_PEN_GRACE_MS;
    if (
      penRecently &&
      this.isHandQuadrant(event.clientX ?? 0, event.clientY ?? 0, event.bounds)
    ) {
      return "quadrant";
    }
    return null;
  }

  /** Decide what a pointer may do, without claiming anything. */
  decide(event: PenGateEvent): PenDecision {
    const type = event.pointerType;
    if (type === "pen") {
      // Layer one, kept exactly as the reader had it: *any* pen event means a
      // stylus is in use, and from then on a touch scrolls instead of drawing.
      this.sawPen = true;
      this.lastPenDownAt = Math.max(this.lastPenDownAt, event.t);
      return "draw";
    }
    if (type !== "touch") return "draw";
    // Touch, from here on.
    if (this.penOnly) return "ignore";
    if (this.sawPen) return "ignore";
    if (this.palmReason(event) !== null) return "ignore";
    return "defer";
  }

  /**
   * Decide *and* claim: the pointer that draws owns the stroke until it ends.
   *
   * A second touch while one is already drawing is not a second stroke — a hand
   * does not write twice at once. Both are palms, and the first is cancelled if it
   * is young enough that it cannot have been intended.
   *
   * A pen outranks a touch unconditionally. The hand cannot be writing while the
   * pen is, so a pen down takes the surface and whatever touch stroke is in
   * progress is discarded — which is what makes the quadrant rule safe to get
   * wrong: its worst case is a cancelled finger, and the next stroke is unaffected.
   */
  begin(event: PenGateEvent): PenClaim {
    const decision = this.decide(event);

    if (event.pointerType === "pen" && this.activeId !== null && this.activeIsTouch) {
      const cancelled = [this.activeId];
      this.release();
      this.deferred.delete(cancelled[0]!);
      this.claim(event, decision);
      return { decision, cancelled };
    }

    if (event.pointerType === "touch" && this.activeId !== null && this.activeIsTouch) {
      const cancelled: number[] = [];
      if (event.t - this.activeStartedAt <= PALM_SECOND_TOUCH_MS) cancelled.push(this.activeId);
      this.release();
      return { decision: "ignore", cancelled };
    }

    if (this.activeId !== null && this.activeId !== event.pointerId) {
      // One stroke at a time. A different pointer's contact is a palm whether or
      // not the rules above said so.
      return { decision: "ignore", cancelled: [] };
    }

    if (decision === "ignore") return { decision, cancelled: [] };
    this.claim(event, decision);
    return { decision, cancelled: [] };
  }

  /** Take the surface for a pointer that has earned it. */
  private claim(event: PenGateEvent, decision: PenDecision): void {
    this.activeId = event.pointerId;
    this.activeIsTouch = event.pointerType === "touch";
    this.activeStartedAt = event.t;
    this.activeOrigin = { x: event.clientX ?? 0, y: event.clientY ?? 0 };
    this.activeBounds = event.bounds;
    if (decision === "defer") {
      this.deferred.set(event.pointerId, { x: event.clientX ?? 0, y: event.clientY ?? 0 });
    }
  }

  /**
   * The deferred touch's verdict, from the caller's timer.
   *
   * A touch that has not moved more than {@link TOUCH_MOVE_SLOP_PX} in
   * {@link TOUCH_DEFER_MS} is a palm; one that moved is a finger, and draws on a
   * tablet with no pen in use. A pointer that is no longer the active one — a
   * pen claimed the stroke meanwhile — is refused.
   */
  confirm(pointerId: number, at: { x: number; y: number } | null): PenDecision {
    const origin = this.deferred.get(pointerId);
    this.deferred.delete(pointerId);
    if (!origin || this.activeId !== pointerId) return "ignore";
    if (!at) {
      this.release();
      return "ignore";
    }
    if (Math.hypot(at.x - origin.x, at.y - origin.y) > TOUCH_MOVE_SLOP_PX) return "draw";
    this.release();
    return "ignore";
  }

  /** Let go of the stroke in progress without touching the deferred map. */
  private release(): void {
    this.activeId = null;
    this.activeIsTouch = false;
    this.activeOrigin = null;
    this.activeBounds = undefined;
  }

  /** The stroke ended, however it ended. */
  end(pointerId: number): void {
    if (this.activeId === pointerId) this.release();
    this.deferred.delete(pointerId);
  }

  /** Throw away every decision, for a new document or a lost pointer. */
  reset(): void {
    this.release();
    this.deferred.clear();
  }

  /**
   * Whether a point sits where the writing hand rests.
   *
   * The rule most likely to be wrong, and therefore the first thing the "Pen
   * only" toggle overrides. It needs the surface's box; without one the rule is
   * skipped rather than guessed at.
   */
  private isHandQuadrant(
    clientX: number,
    clientY: number,
    bounds: PenGateEvent["bounds"],
  ): boolean {
    if (!bounds || bounds.width === 0 || bounds.height === 0) return false;
    const x = clientX - bounds.left;
    const y = clientY - bounds.top;
    const lowerHalf = y > bounds.height / 2;
    const handSide = this.handedness === "right" ? x > bounds.width / 2 : x < bounds.width / 2;
    return lowerHalf && handSide;
  }
}

/** A contact's area in mm², from the CSS pixels a `PointerEvent` reports. */
export function contactAreaMm2(event: Pick<PenGateEvent, "width" | "height">): number {
  const width = event.width ?? 0;
  const height = event.height ?? 0;
  if (!(width > 0) || !(height > 0)) return 0;
  return (width / CSS_PX_PER_MM) * (height / CSS_PX_PER_MM);
}

/* -------------------------------------------------------------------------
 * The session: samples in, worker out
 * ------------------------------------------------------------------------- */

/** The pointer fields the session reads; a `PointerEvent` satisfies this. */
export interface PenPointerEvent extends PenGateEvent {
  buttons?: number;
  /** Coalesced events, when the platform provides them. */
  getCoalescedEvents?: () => PenPointerEvent[];
  /** Predicted events, used **only** when not delegating (D11). */
  getPredictedEvents?: () => PenPointerEvent[];
}

/** The tool in force, which a stroke copies when it begins. */
export interface InkToolChoice {
  width: number;
  tool: InkStrokeHeader["tool"];
  colour: string;
  pageIndex: number;
}

export interface PenCaptureDeps {
  gate: InkPenGate;
  filter: NibFilter;
  writer: InkSampleWriter;
  /** Client coordinates to page units in 0.1 mm, `null` when off the page. */
  project: (clientX: number, clientY: number) => { x: number; y: number } | null;
  /** The newest filtered sample and its instantaneous width, for the trail. */
  onLive?: (sample: FilteredNibSample, width: number) => void;
  /**
   * The worker acknowledged a stroke. The **only** thing a screen may re-render
   * for, once per stroke.
   */
  onStrokeEnd?: (header: InkStrokeHeader, points: Float32Array, pressures: Float32Array) => void;
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
  /** The tool a stroke will use, remembered so a confirmed touch can begin. */
  private tool: InkToolChoice = { width: 6, tool: "pen", colour: "text", pageIndex: 0 };

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
  confirmTouch(at: { x: number; y: number } | null, event: PenPointerEvent | null): void {
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
    this.consume(event, false);

    // Prediction is for the fallback path only: while the OS is drawing the wet
    // tail, predicting as well forks the stroke (§6.2.6, D11). Predicted samples
    // are flushed on their own so the worker can tell them from real ones and
    // replace the tail rather than commit it.
    if (this.predicts) {
      const predicted = safeEvents(event.getPredictedEvents?.bind(event));
      if (predicted.length > 0) {
        for (const sample of predicted) this.consume(sample, false, true);
        this.deps.writer.flush("samples", this.header!, true);
      }
    }
  }

  /** The pointer came up: hand the stroke to the worker. */
  pointerUp(event: PenPointerEvent): void {
    if (!this.active || event.pointerId !== this.pointerId) return;
    this.consume(event, false);
    const header = this.header!;
    this.deps.writer.flush("stroke-end", header);
    this.clear();
    this.deps.gate.end(event.pointerId);
  }

  /** The worker acknowledged the stroke: the screen may re-render now. */
  committed(header: InkStrokeHeader, points: Float32Array, pressures: Float32Array): void {
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
    if (!this.consume(event, true)) {
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
  }

  /** Filter one pointer sample and write it into the batch. */
  private consume(event: PenPointerEvent, first: boolean, predicted = false): boolean {
    const header = this.header;
    if (!header) return false;
    if (!first && event.pointerId !== this.pointerId) return false;
    const projected = this.deps.project(event.clientX ?? 0, event.clientY ?? 0);
    if (!projected) return false;

    const sample = this.deps.filter.filter({
      x: projected.x,
      y: projected.y,
      pressure: event.pressure ?? 0,
      t: event.t,
    });
    const width = nibWidth(header.width, sample.pressure, sample.velocity);
    // The trail is told where to start *before* the sample is posted, and with
    // the same filtered width the worker will bake into geometry. A predicted
    // sample is not where the pen has been, so the trail is not moved for it.
    if (!predicted) this.deps.onLive?.(sample, width);

    if (!predicted) {
      this.points.push(sample.x, sample.y);
      this.pressures.push(sample.pressure);
    }
    this.deps.writer.push(sample.x, sample.y, sample.pressure, sample.t, header);
    return true;
  }

  /** The stroke's real samples, for a host that packs them itself. */
  takeStroke(): { points: number[]; pressures: number[] } {
    return { points: [...this.points], pressures: [...this.pressures] };
  }
}

/** Coalesced/predicted lists are optional and may throw on a synthetic event. */
function safeEvents(read: (() => PenPointerEvent[]) | undefined): PenPointerEvent[] {
  if (!read) return [];
  try {
    const events = read();
    return Array.isArray(events) ? events : [];
  } catch {
    return [];
  }
}

/* -------------------------------------------------------------------------
 * The React side
 * ------------------------------------------------------------------------- */

/** The worker, as the hook needs it. A type, so tests can double it. */
export interface InkWorkerLike {
  postMessage(message: InkWorkerMessage, transfer?: Transferable[]): void;
  addEventListener(type: "message", listener: (event: MessageEvent<InkWorkerEvent>) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent<InkWorkerEvent>) => void): void;
  terminate(): void;
}

export interface UsePenCaptureOptions {
  /** The surface the pen draws on. Its box maps client coordinates to ink units. */
  element: () => HTMLCanvasElement | null;
  /** Client coordinates to page units in 0.1 mm, `null` off the page. */
  project: (clientX: number, clientY: number) => { x: number; y: number } | null;
  /** The surface's box, read only when a touch needs the quadrant rule. */
  bounds?: () => PenGateEvent["bounds"];
  pageIndex: number;
  tool: InkStrokeHeader["tool"];
  /** Base nib width in 0.1 mm. */
  width: number;
  colour: string;
  handedness?: InkHand;
  /** The newest filtered sample and its width, for the delegated trail (§6.2.6). */
  onLive?: (sample: FilteredNibSample, width: number) => void;
  onStrokeEnd?: (header: InkStrokeHeader, points: Float32Array, pressures: Float32Array) => void;
  /** The worker's frame counter, for the trail's "is it behind?" check. */
  onFrame?: (frame: number) => void;
  onBackend?: (backend: "webgl2" | "canvas2d" | "none") => void;
  onContextLost?: () => void;
  /**
   * Whether the delegated ink trail is active. Prediction is on **only** when it
   * is not (§6.2.6); the host owns the presenter and passes its state in.
   */
  delegating?: () => boolean;
  /** Where the worker comes from. Injected so tests need no bundler. */
  createWorker?: () => InkWorkerLike;
  /** Where the canvas is transferred. Injected for the same reason. */
  transferCanvas?: (canvas: HTMLCanvasElement) => OffscreenCanvas;
}

export interface PenCaptureHandle {
  /** True once a stylus has been seen: the wrist guard's default, and scrolling. */
  penSeen: boolean;
  /** Layer three: whether touch may draw at all. */
  penOnly: boolean;
  setPenOnly: (value: boolean) => void;
  /** The worker's backend, `null` until it has said. */
  backend: "webgl2" | "canvas2d" | "none" | null;
  /** The worker's newest frame counter. */
  frame: number;
  /** Native pointer handlers for the canvas element. */
  handlers: {
    onPointerDown: (event: React.PointerEvent<HTMLCanvasElement>) => void;
    onPointerMove: (event: React.PointerEvent<HTMLCanvasElement>) => void;
    onPointerUp: (event: React.PointerEvent<HTMLCanvasElement>) => void;
    onPointerCancel: (event: React.PointerEvent<HTMLCanvasElement>) => void;
  };
  /** The session, for a screen that wants to ask it anything. */
  session: PenCaptureSession;
}

/**
 * The pen path, as a hook.
 *
 * A hook because it owns a worker and a canvas and a screen must be able to tear
 * both down; **not** because the samples go through React. Nothing here calls
 * `setState` from a pointer event: the state is `penSeen`, `penOnly`, and the
 * worker's backend and frame counter — the first two change once per session, and
 * the last two are metadata about the renderer rather than about the stroke.
 */
export function usePenCapture(options: UsePenCaptureOptions): PenCaptureHandle {
  const callbacksRef = useRef(options);
  callbacksRef.current = options;
  const elementRef = useRef(options.element);
  elementRef.current = options.element;

  const [penSeen, setPenSeen] = useState(false);
  const [penOnly, setPenOnlyState] = useState(false);
  const [backend, setBackend] = useState<PenCaptureHandle["backend"]>(null);
  const [frame, setFrame] = useState(0);

  const workerRef = useRef<InkWorkerLike | null>(null);
  const gateRef = useRef<InkPenGate>(new InkPenGate({ handedness: options.handedness ?? "right" }));
  const filterRef = useRef<NibFilter>(new NibFilter());
  const poolRef = useRef<InkSamplePool>(new InkSamplePool({ capacity: 4 }));
  const deferTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sessionRef = useRef<PenCaptureSession | null>(null);
  if (!sessionRef.current) {
    const writer = new InkSampleWriter({
      pool: poolRef.current,
      mode: transferMode(),
      post: (message, transfer) => workerRef.current?.postMessage(message, transfer),
    });
    sessionRef.current = new PenCaptureSession({
      gate: gateRef.current,
      filter: filterRef.current,
      writer,
      project: (x, y) => callbacksRef.current.project(x, y),
      onLive: (sample, width) => callbacksRef.current.onLive?.(sample, width),
      onStrokeEnd: (header, points, pressures) =>
        callbacksRef.current.onStrokeEnd?.(header, points, pressures),
      predict: () => !(callbacksRef.current.delegating?.() ?? false),
    });
  }

  /** The gate event for a React pointer event. Bounds only where a rule needs them. */
  const toGateEvent = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>): PenPointerEvent => {
      const native = event.nativeEvent as unknown as PenPointerEvent;
      const touch = event.pointerType === "touch";
      return {
        pointerId: event.pointerId,
        pointerType: event.pointerType,
        pressure: event.pressure,
        width: native.width,
        height: native.height,
        clientX: event.clientX,
        clientY: event.clientY,
        bounds: touch ? callbacksRef.current.bounds?.() : undefined,
        t: event.timeStamp,
        getCoalescedEvents: native.getCoalescedEvents?.bind(native),
        getPredictedEvents: native.getPredictedEvents?.bind(native),
      };
    },
    [],
  );

  /** Bring the worker up and hand it the canvas. */
  useEffect(() => {
    const canvas = elementRef.current();
    if (!canvas) return;
    const create =
      callbacksRef.current.createWorker ??
      (() =>
        new Worker(new URL("../worker/ink-worker.ts", import.meta.url)) as unknown as InkWorkerLike);
    const worker = create();
    workerRef.current = worker;

    const onMessage = (event: MessageEvent<InkWorkerEvent>) => {
      const message = event.data;
      switch (message.type) {
        case "ready":
          setBackend(message.backend);
          callbacksRef.current.onBackend?.(message.backend);
          break;
        case "frame":
          setFrame(message.frame);
          callbacksRef.current.onFrame?.(message.frame);
          break;
        case "stroke-committed":
          sessionRef.current?.committed(message.header, message.points, message.pressures);
          break;
        case "samples-returned":
          for (const buffer of message.buffers) poolRef.current.release(buffer);
          break;
        case "context-lost":
          callbacksRef.current.onContextLost?.();
          break;
        case "context-restored":
          setBackend(message.backend);
          break;
        case "error":
          // The pen must keep working when the worker cannot draw: a lost
          // renderer is a degraded note, not a lost one.
          setBackend("none");
          break;
      }
    };
    worker.addEventListener("message", onMessage);

    const transfer =
      callbacksRef.current.transferCanvas ??
      ((target: HTMLCanvasElement) => target.transferControlToOffscreen());
    let offscreen: OffscreenCanvas | null = null;
    try {
      offscreen = transfer(canvas);
    } catch {
      // A canvas can only be transferred once, and one without
      // `transferControlToOffscreen` cannot be transferred at all. The worker
      // then runs headless and the host paints through the fallback renderer.
      offscreen = null;
    }
    const box = canvas.getBoundingClientRect();
    worker.postMessage(
      {
        type: "init",
        canvas: offscreen,
        width: Math.max(1, Math.round(box.width)),
        height: Math.max(1, Math.round(box.height)),
        dpr: typeof window === "undefined" ? 1 : window.devicePixelRatio || 1,
        // The worker only returns buffers it was given by transfer; in clone mode
        // the memory never left this thread and returning it would pool an array
        // that is still in use here.
        mode: transferMode(),
      },
      offscreen ? [offscreen] : [],
    );

    return () => {
      worker.removeEventListener("message", onMessage);
      worker.postMessage({ type: "dispose" });
      worker.terminate();
      workerRef.current = null;
    };
    // One worker per canvas, deliberately: re-creating it would throw away the
    // committed geometry. Everything it needs is read through a ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** The frame pump: batches reach the worker once per frame, not per sample. */
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      sessionRef.current?.flush();
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, []);

  useEffect(
    () => () => {
      if (deferTimer.current) clearTimeout(deferTimer.current);
    },
    [],
  );

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const session = sessionRef.current!;
      session.setTool({
        width: callbacksRef.current.width,
        tool: callbacksRef.current.tool,
        colour: callbacksRef.current.colour,
        pageIndex: callbacksRef.current.pageIndex,
      });
      const gateEvent = toGateEvent(event);
      const claim = session.pointerDown(gateEvent);

      if (event.pointerType === "pen") {
        if (!gateRef.current.hasSeenPen) setPenSeen(true);
      }

      if (claim.decision === "draw") {
        event.currentTarget.setPointerCapture?.(event.pointerId);
        return;
      }
      if (claim.decision !== "defer") return;

      // Rule five: give the touch 120 ms to move, and let the browser scroll
      // until it does — no capture, no `preventDefault`.
      if (deferTimer.current) clearTimeout(deferTimer.current);
      const pointerId = event.pointerId;
      deferTimer.current = setTimeout(() => {
        deferTimer.current = null;
        const newest = session.newestEvent;
        const at = newest ? { x: newest.clientX ?? 0, y: newest.clientY ?? 0 } : null;
        session.confirmTouch(at, newest);
        if (session.active) event.currentTarget.setPointerCapture?.(pointerId);
      }, TOUCH_DEFER_MS);
    },
    [toGateEvent],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      sessionRef.current!.pointerRawUpdate(toGateEvent(event));
    },
    [toGateEvent],
  );

  const onPointerUp = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (deferTimer.current) {
        clearTimeout(deferTimer.current);
        deferTimer.current = null;
      }
      sessionRef.current!.pointerUp(toGateEvent(event));
    },
    [toGateEvent],
  );

  const onPointerCancel = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      sessionRef.current!.pointerUp(toGateEvent(event));
    },
    [toGateEvent],
  );

  const setPenOnly = useCallback((value: boolean) => {
    gateRef.current.penOnly = value;
    setPenOnlyState(value);
  }, []);

  const handlers = useMemo(
    () => ({ onPointerDown, onPointerMove, onPointerUp, onPointerCancel }),
    [onPointerDown, onPointerMove, onPointerUp, onPointerCancel],
  );

  return {
    penSeen,
    penOnly,
    setPenOnly,
    backend,
    frame,
    handlers,
    session: sessionRef.current!,
  };
}

/**
 * Which copy discipline the samples use.
 *
 * `SharedArrayBuffer` would make this moot and needs COOP/COEP headers this app
 * deliberately does not send (§6.2.13), so a batch is transferred and its buffer
 * comes back through the pool — the plan's option 1 with option 2's discipline. A
 * runtime without transferable typed arrays falls back to cloning, which costs
 * one small copy per frame.
 */
export function transferMode(): InkTransferMode {
  return typeof structuredClone === "function" ? "transfer" : "clone";
}
