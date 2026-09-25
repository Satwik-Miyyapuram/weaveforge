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
  InkToolChoice,
  PenCaptureSession,
  PenPointerEvent,
  type PenCaptureDeps,
} from "./pen-capture-session";
import {
  requestInkPresenter,
  updateTrail,
  type InkPresenterLike,
  type InkTrailStyle,
} from "./ink-trail";

/**
 * The session's names, still found here: `use-pen-capture` is the door the
 * reader, the ink host and the tests have always imported through, and the
 * session is one of its two pieces.
 */
export {
  PenCaptureSession,
} from "./pen-capture-session";
export type {
  InkToolChoice,
  PenCaptureDeps,
  PenPointerEvent,
} from "./pen-capture-session";

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
   * The pen came near the screen.
   *
   * Fired on a pen pointer-down, which is the earliest signal this hook has: a
   * hover that never becomes a stroke is not reported by the web platform, and the
   * native shell's hover events are not bridged. Fired every time rather than once,
   * because the tool can be moved away from a pen mode between strokes and the
   * restore has to happen again — see `toolOnPenApproach` for the rule, which is
   * idempotent when a pen mode is already selected.
   */
  onPenApproach?: () => void;
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
  // Whether the worker's context was created for the delegated path. Decided
  // once and never revisited: a presenter that later refuses an event is
  // dropped, but the context is still `desynchronized: false`, so prediction
  // stays off (§6.2.6).
  const delegatedContextRef = useRef(false);
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
        !delegatedContextRef.current &&
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
      delegatedContextRef.current = presenter !== null;
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
        // Not terminated on the spot: the host flushes its pending save just
        // before this runs, and that save is still being encoded over there.
        // The listener stays so the `page-saved` it produces still lands; the
        // worker closes itself after it, and is terminated here as a backstop.
        worker.postMessage({ type: "dispose" });
        const backstop = setTimeout(() => worker.terminate(), 5000);
        worker.addEventListener("message", (event: MessageEvent<InkWorkerEvent>) => {
          if (event.data.type !== "disposed") return;
          clearTimeout(backstop);
          worker.removeEventListener("message", onMessage);
          worker.terminate();
        });
        workerRef.current = null;
        presenterRef.current = null;
        pendingRef.current = [];
        // Whatever the pool still holds is ours alone now; the worker's copies
        // went with it. Nothing keeps the free list's buffers alive after this.
        poolRef.current.clear();
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
        // The pen is here, so a pen mode should be in force. Fired on every pen
        // pointer-down rather than once, because the tool can be changed away from a
        // pen mode between strokes — pick the eraser, put the pen down, pick the pen
        // back up — and the restore has to happen again each time. It is idempotent
        // when a pen mode is already selected, which is the common case.
        callbacksRef.current.onPenApproach?.();
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
        try {
          event.currentTarget.setPointerCapture?.(event.pointerId);
        } catch {
          // A synthetic or already-released pointer has no capture to take; the
          // stroke has begun regardless.
        }
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
        if (session.active) {
          try {
            event.currentTarget.setPointerCapture?.(pointerId);
          } catch {
            // As above: capture is a nicety, the stroke is not.
          }
        }
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
