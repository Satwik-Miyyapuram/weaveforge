"use client";

/**
 * Pen capture: which pointer may draw, what the samples are, and where they go.
 *
 * This is the reader's palm handling lifted out and made shared — the same rule
 * set, in one place, so the reader and an ink note cannot disagree about what a
 * resting hand is. What the reader has today (`use-page-pointer.ts`: once a pen
 * has been seen, touch never draws again; one pointer owns a stroke) is
 * `InkPenGate`, in `pen-gate.ts`, and its three palm layers are the plan's §3.
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
 *   (§6.2.5). One `NibFilter` feeds both.
 *
 * The reader keeps its own React draft preview: it paints the in-progress stroke
 * as an SVG path in its JSX, and moving that into an offscreen worker is a change
 * to the reader's *rendering*, not to its capture. The gate is what the two
 * features share; the ink host is what uses the worker.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { nibWidth, type InkColour, type InkHand } from "@weaveforge/core";

import { NibFilter, type FilteredNibSample } from "./one-euro-filter";
import {
  InkSamplePool,
  InkSampleWriter,
  type InkStrokeHeader,
  type InkTransferMode,
  type InkWorkerEvent,
  type InkWorkerMessage,
} from "./capture-protocol";
import {
  InkPenGate,
  TOUCH_DEFER_MS,
  type PenClaim,
  type PenDecision,
  type PenGateEvent,
} from "./pen-gate";
import {
  requestInkPresenter,
  updateTrail,
  type InkPresenterLike,
  type InkTrailStyle,
} from "./ink-trail";

/** Where the wrist guard's per-device choice lives (§3.3). Not in the note. */
export const INK_PEN_ONLY_STORAGE_KEY = "weaveforge.ink.penOnly";

/** The one slice of `localStorage` the hook reads and writes. */
export type PenOnlyStorage = Pick<Storage, "getItem" | "setItem">;

function defaultPenOnlyStorage(): PenOnlyStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** The stored wrist-guard choice, `null` when this device has never made one. */
export function readStoredPenOnly(
  storage: PenOnlyStorage | null,
): boolean | null {
  try {
    const value = storage?.getItem(INK_PEN_ONLY_STORAGE_KEY);
    return value === "1" ? true : value === "0" ? false : null;
  } catch {
    return null;
  }
}

export function writeStoredPenOnly(
  storage: PenOnlyStorage | null,
  value: boolean,
): void {
  try {
    storage?.setItem(INK_PEN_ONLY_STORAGE_KEY, value ? "1" : "0");
  } catch {
    // A full or forbidden store loses the preference, not the stroke.
  }
}

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

/* -------------------------------------------------------------------------
 * The React side
 * ------------------------------------------------------------------------- */

/** The worker, as the hook needs it. A type, so tests can double it. */
export interface InkWorkerLike {
  postMessage(message: InkWorkerMessage, transfer?: Transferable[]): void;
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<InkWorkerEvent>) => void,
  ): void;
  removeEventListener(
    type: "message",
    listener: (event: MessageEvent<InkWorkerEvent>) => void,
  ): void;
  terminate(): void;
}

export interface UsePenCaptureOptions {
  /** The surface the pen draws on. Its box maps client coordinates to ink units. */
  element: () => HTMLCanvasElement | null;
  /** Client coordinates to page units in 0.1 mm, `null` off the page. */
  project: (
    clientX: number,
    clientY: number,
  ) => { x: number; y: number } | null;
  /** The surface's box, read only when a touch needs the quadrant rule. */
  bounds?: () => PenGateEvent["bounds"];
  pageIndex: number;
  tool: InkStrokeHeader["tool"];
  /** Base nib width in 0.1 mm. */
  width: number;
  colour: InkColour;
  handedness?: InkHand;
  /** The newest filtered sample and its width, for a host that draws its own tail. */
  onLive?: (sample: FilteredNibSample, width: number) => void;
  /**
   * The Delegated Ink Trail (§6.2.6). Given, the hook asks the platform for a
   * presenter over the canvas before the worker gets it, tells the worker which
   * path it is on, and moves the trail's start point for every dispatched
   * sample with the style this returns. Absent, the fallback path: prediction
   * on, no presenter asked for.
   */
  trail?: {
    /** The style for a live sample of `width` (0.1 mm). */
    style: (width: number) => InkTrailStyle;
    /** Injected for tests; the default reads `navigator.ink`. */
    request?: (canvas: HTMLCanvasElement) => Promise<InkPresenterLike | null>;
  };
  /** Where the wrist guard's choice is kept. `null` keeps it for the session only. */
  penOnlyStorage?: PenOnlyStorage | null;
  onStrokeEnd?: (
    header: InkStrokeHeader,
    points: Float32Array,
    pressures: Uint8Array,
  ) => void;
  /** The worker's frame counter, for the trail's "is it behind?" check. */
  onFrame?: (frame: number) => void;
  onBackend?: (backend: "webgl2" | "canvas2d" | "none") => void;
  onContextLost?: () => void;
  /**
   * Every worker event, after the hook has taken what it needs.
   *
   * The hook owns the pen; the host owns the page. Saves, page models, lasso
   * selections and history depth are the host's business, and threading each
   * through a named callback would make the hook grow with every tool.
   */
  onEvent?: (event: InkWorkerEvent) => void;
  /**
   * Whether something else is drawing the wet tail. Prediction is on **only**
   * when neither this nor the hook's own presenter is (§6.2.6).
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
  /** Whether the OS is drawing the wet tail: a presenter was granted. */
  delegating: boolean;
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
  /**
   * Post a message to the worker.
   *
   * The pen path owns the worker, so everything else the page needs from it —
   * loading a page's bytes, the viewport transform, resize, erase, undo, export —
   * goes through this one door rather than the host standing up a second worker.
   */
  send: (message: InkWorkerMessage, transfer?: Transferable[]) => void;
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
  const [delegating, setDelegating] = useState(false);
  const presenterRef = useRef<InkPresenterLike | null>(null);
  const storageRef = useRef<PenOnlyStorage | null | undefined>(undefined);
  if (storageRef.current === undefined) {
    storageRef.current =
      options.penOnlyStorage === undefined
        ? defaultPenOnlyStorage()
        : options.penOnlyStorage;
  }

  const workerRef = useRef<InkWorkerLike | null>(null);
  const gateRef = useRef<InkPenGate>(
    new InkPenGate({ handedness: options.handedness ?? "right" }),
  );
  const filterRef = useRef<NibFilter>(new NibFilter());
  const poolRef = useRef<InkSamplePool>(new InkSamplePool({ capacity: 4 }));
  const deferTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Messages sent before the worker exists. The presenter is asked for before
   * the worker starts (§6.2.6) and the answer is a promise, so the host's mount
   * effects — `load-page`, `viewport`, `resize` — would otherwise land on a
   * `null` worker and vanish; the page would then render at the renderer's
   * default transform, with most of it outside the clip volume.
   */
  const pendingRef = useRef<
    { message: InkWorkerMessage; transfer: Transferable[] }[]
  >([]);
  const post = useCallback(
    (message: InkWorkerMessage, transfer: Transferable[] = []) => {
      const worker = workerRef.current;
      if (worker) worker.postMessage(message, transfer);
      else pendingRef.current.push({ message, transfer });
    },
    [],
  );

  const sessionRef = useRef<PenCaptureSession | null>(null);
  if (!sessionRef.current) {
    const writer = new InkSampleWriter({
      pool: poolRef.current,
      mode: transferMode(),
      post: (message, transfer) => post(message, transfer ?? []),
    });
    sessionRef.current = new PenCaptureSession({
      gate: gateRef.current,
      filter: filterRef.current,
      writer,
      project: (x, y) => callbacksRef.current.project(x, y),
      onLive: (sample, width, event) => {
        // The trail is moved in the handler, before the sample is posted, with
        // the same width the worker bakes in. A presenter that refuses the event
        // is dropped: from then on the worker draws the tail, still unpredicted
        // because the context was created for the delegated path.
        const presenter = presenterRef.current;
        const trail = callbacksRef.current.trail;
        if (presenter && trail && event?.native) {
          if (!updateTrail(presenter, event.native, trail.style(width))) {
            presenterRef.current = null;
          }
        }
        callbacksRef.current.onLive?.(sample, width);
      },
      onStrokeEnd: (header, points, pressures) =>
        callbacksRef.current.onStrokeEnd?.(header, points, pressures),
      predict: () =>
        presenterRef.current === null &&
        !(callbacksRef.current.delegating?.() ?? false),
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
        native: event.nativeEvent,
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
    let disposed = false;
    let dispose: (() => void) | null = null;

    /** Everything after the presenter question is answered. */
    const start = (presenter: InkPresenterLike | null) => {
      if (disposed) return;
      presenterRef.current = presenter;
      setDelegating(presenter !== null);
      const create =
        callbacksRef.current.createWorker ??
        (() =>
          new Worker(
            new URL("../worker/ink-worker.ts", import.meta.url),
          ) as unknown as InkWorkerLike);
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
            sessionRef.current?.committed(
              message.header,
              message.points,
              message.pressures,
            );
            break;
          case "samples-returned":
            for (const buffer of message.buffers)
              poolRef.current.release(buffer);
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
        callbacksRef.current.onEvent?.(message);
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
          // The sidecar is deflate-raw'd where the platform can; the worker falls
          // back to identity where it cannot, and the chunk says which it was.
          codec: "deflate-raw",
          // Immutable once the context exists, so it is decided here (§6.2.6).
          delegating: presenter !== null,
        },
        offscreen ? [offscreen] : [],
      );
      // Everything the host said while the worker did not exist, in order.
      const pending = pendingRef.current;
      pendingRef.current = [];
      for (const entry of pending)
        worker.postMessage(entry.message, entry.transfer);

      dispose = () => {
        worker.removeEventListener("message", onMessage);
        worker.postMessage({ type: "dispose" });
        worker.terminate();
        workerRef.current = null;
        presenterRef.current = null;
        pendingRef.current = [];
      };
    };

    // The presenter is asked for first because its answer picks the canvas's
    // context attributes; without a trail option the worker starts at once.
    const trail = callbacksRef.current.trail;
    if (trail) {
      void (trail.request ?? requestInkPresenter)(canvas).then(start, () =>
        start(null),
      );
    } else {
      start(null);
    }

    return () => {
      disposed = true;
      dispose?.();
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
        // Layer three's default: the guard goes up on the first pen, unless this
        // device has already said otherwise.
        if (
          !gateRef.current.penOnly &&
          readStoredPenOnly(storageRef.current ?? null) === null
        ) {
          gateRef.current.penOnly = true;
          setPenOnlyState(true);
        }
      }

      if (claim.decision === "draw") {
        // Without this Chromium on Windows treats a pen-down as the start of a
        // platform gesture, revokes the capture a few pixels in and sends
        // `pointercancel`; the stroke then dies with one or two samples.
        event.preventDefault();
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
        const at = newest
          ? { x: newest.clientX ?? 0, y: newest.clientY ?? 0 }
          : null;
        session.confirmTouch(at, newest);
        if (session.active) event.currentTarget.setPointerCapture?.(pointerId);
      }, TOUCH_DEFER_MS);
    },
    [toGateEvent],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const session = sessionRef.current!;
      // A deferred touch keeps its default so the browser can still scroll.
      if (session.active) event.preventDefault();
      session.pointerRawUpdate(toGateEvent(event));
    },
    [toGateEvent],
  );

  const onPointerUp = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (deferTimer.current) {
        clearTimeout(deferTimer.current);
        deferTimer.current = null;
      }
      const session = sessionRef.current!;
      if (session.active) event.preventDefault();
      session.pointerUp(toGateEvent(event));
    },
    [toGateEvent],
  );

  const onPointerCancel = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (deferTimer.current) {
        clearTimeout(deferTimer.current);
        deferTimer.current = null;
      }
      sessionRef.current!.pointerUp(toGateEvent(event));
    },
    [toGateEvent],
  );

  const setPenOnly = useCallback((value: boolean) => {
    gateRef.current.penOnly = value;
    setPenOnlyState(value);
    writeStoredPenOnly(storageRef.current ?? null, value);
  }, []);

  // The stored choice is applied after mount: the server has no storage, and
  // deciding during render would ship a guard that flips on hydration.
  useEffect(() => {
    const stored = readStoredPenOnly(storageRef.current ?? null);
    if (stored !== null) {
      gateRef.current.penOnly = stored;
      setPenOnlyState(stored);
    }
  }, []);

  // Handedness is the note's, and a note can change hands mid-session.
  useEffect(() => {
    gateRef.current.handedness = options.handedness ?? "right";
  }, [options.handedness]);

  const handlers = useMemo(
    () => ({ onPointerDown, onPointerMove, onPointerUp, onPointerCancel }),
    [onPointerDown, onPointerMove, onPointerUp, onPointerCancel],
  );

  const send = post;

  return {
    penSeen,
    penOnly,
    setPenOnly,
    backend,
    delegating,
    frame,
    handlers,
    session: sessionRef.current!,
    send,
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
