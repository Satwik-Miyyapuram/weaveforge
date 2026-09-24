"use client";

/**
 * Fingers on a paper: pan it, and pinch it.
 *
 * The sheet's gesture, plus the part a sheet never needed: **deciding which
 * gesture this is, and sticking to it**. A hand puts two fingers down and moves
 * them; whether that is a pan, a zoom, or both is not knowable from the first
 * event, and a hook that re-guesses every frame does both badly — the page
 * drifts while it zooms and the scale wobbles while it pans. So this is a small
 * recogniser, following the rules the platforms settled on:
 *
 * - **A tolerance before anything happens.** Nothing moves or scales until the
 *   fingers have travelled `PAN_SLOP_PX`, or their span has changed by
 *   `ZOOM_SLOP_PX`. That is Android's touch slop (about 8 dp), and it is why a
 *   tap, a tremble or a resting palm does not nudge the page.
 * - **One intent per gesture.** The moment a tolerance is crossed the gesture is
 *   classified, and it stays classified until a finger lifts — which is how
 *   Android's `ScaleGestureDetector` and iOS's recognisers both behave: a touch
 *   sequence is a pan *or* a pinch, never alternately. A pinch wins only when
 *   the span has moved further than the pair's own midpoint (`ZOOM_DOMINANCE`),
 *   which is what separates two fingers *spreading* from two fingers *walking*.
 * - **A deadband while zooming.** Within `ZOOM_DEADBAND` of the starting span
 *   the factor stays exactly 1, so a pinch that is mostly a pan does not shimmer.
 * - **One finger is a pan**, always, on a paper: the stylus draws and the hand
 *   moves the page. That is the rule OneNote has, and the one a tablet user
 *   arrives with — a palm never draws a line when it meant to scroll.
 *
 * **Everything is measured at a frame boundary.** Pointer events carry one
 * finger each, so between two of them the pair is half-updated: a two-finger
 * drag that keeps its span reads, event by event, as a span that grew and then
 * shrank, and a recogniser that classifies on that sees a pinch in every pan.
 * A frame is the first moment both fingers are where they are — the granularity
 * the native touch APIs hand a recogniser for free — so this measures,
 * classifies and reports once per frame, which is also the work a frame of the
 * gesture needs.
 *
 * The zoom is *reported*, not applied: the caller previews it as it likes and
 * commits it once, at the end. Scaling a document is expensive — every page has
 * to be rendered again — and doing that per frame is exactly what makes a pinch
 * feel heavy and jumpy; a transform for the length of the gesture and one render
 * afterwards is what makes it feel native.
 */

import { useCallback, useEffect, useRef } from "react";

/** How far a finger must travel before it is panning rather than touching. */
const PAN_SLOP_PX = 8;
/**
 * How much the span must change before it is a pinch rather than a wobble.
 *
 * Android's `ScaleGestureDetector` uses twice its touch slop for this: a span
 * is measured between two fingers, and both of them jitter.
 */
const ZOOM_SLOP_PX = 16;
/**
 * How far the span must beat the pair's own travel to count as a pinch.
 *
 * Equal would be a coin toss between two fingers spreading and two fingers
 * walking; a fifth is enough to make the intent obvious before it is locked.
 */
const ZOOM_DOMINANCE = 1.2;
/** A span within this much of the starting one is left alone entirely. */
const ZOOM_DEADBAND = 0.03;

/** Where each finger is, in client pixels, while it is down. */
interface Finger {
  x: number;
  y: number;
}

/** The two fingers of a two-finger gesture, as one thing. */
interface Pair {
  /** Client x of the midpoint. */
  cx: number;
  /** Client y of the midpoint. */
  cy: number;
  /** Distance between the fingers. */
  span: number;
}

/** What the page's pointer handlers ask before they act on an event. */
export interface ReaderGestures {
  /** True when the event belongs to a gesture this hook owns. */
  begin: (event: React.PointerEvent) => boolean;
  move: (event: React.PointerEvent) => boolean;
  end: (event: React.PointerEvent) => boolean;
}

export interface ReaderGestureOptions {
  /** The scroller: its content is what the fingers move. */
  scrollRef: { current: HTMLElement | null };
  /** The second finger landed: stop whatever the first one was doing. */
  onGestureStart?: () => void;
  /**
   * The pinch so far, as a factor on the scale in force when it began, and the
   * point between the fingers it is about.
   *
   * Called while the gesture runs, for a caller that wants to *show* it — a
   * transform is the cheap way. Nothing is committed here.
   */
  onZoomPreview?: (factor: number, focusX: number, focusY: number) => void;
  /** The pinch is over: this is what it came to. Called once per gesture. */
  onZoomCommit?: (factor: number, focusX: number, focusY: number) => void;
}

export function useReaderGestures({
  scrollRef,
  onGestureStart,
  onZoomPreview,
  onZoomCommit,
}: ReaderGestureOptions): ReaderGestures {
  const fingers = useRef(new Map<number, Finger>());
  /**
   * The caller's callbacks, as of this render.
   *
   * Read through a ref rather than captured, so the handlers below can be stable:
   * a gesture that began two renders ago must call the *current* commit, not the
   * one that was current when the fingers landed.
   */
  const handlers = useRef({ onGestureStart, onZoomPreview, onZoomCommit });
  handlers.current = { onGestureStart, onZoomPreview, onZoomCommit };

  /**
   * What this gesture turned out to be.
   *
   * `wait` is fingers down and inside the tolerance; `pan` and `zoom` are
   * locked, and stay locked until a finger lifts.
   */
  const intent = useRef<"none" | "wait" | "pan" | "zoom">("none");
  /** The pair as the gesture began, and as it was last reported. */
  const from = useRef<Pair | null>(null);
  const last = useRef<Pair | null>(null);
  /** Where the single finger was last frame, for a one-finger pan. */
  const lastFinger = useRef<Finger | null>(null);
  /** The factor the pinch has reached, and the point it is about. */
  const factor = useRef(1);
  const focus = useRef({ x: 0, y: 0 });
  /** One measurement per frame, however fast the fingers report. */
  const frame = useRef<number | null>(null);

  const pairOf = useCallback((): Pair | null => {
    const points = [...fingers.current.values()];
    if (points.length < 2) return null;
    const [a, b] = points as [Finger, Finger];
    return {
      cx: (a.x + b.x) / 2,
      cy: (a.y + b.y) / 2,
      span: Math.hypot(a.x - b.x, a.y - b.y),
    };
  }, []);

  const focusOn = useCallback(
    (pair: Pair) => {
      const rect = scrollRef.current?.getBoundingClientRect();
      focus.current = rect
        ? { x: pair.cx - rect.left, y: pair.cy - rect.top }
        : { x: pair.cx, y: pair.cy };
    },
    [scrollRef],
  );

  const panBy = useCallback(
    (dx: number, dy: number) => {
      const scroller = scrollRef.current;
      if (scroller && (dx !== 0 || dy !== 0)) scroller.scrollBy(-dx, -dy);
    },
    [scrollRef],
  );

  /**
   * One frame of the gesture: measure the fingers, decide if it is still
   * undecided, and do the one thing that gesture does.
   */
  const measure = useCallback(() => {
    frame.current = null;
    if (intent.current === "none") return;

    // One finger is a pan, by however far it has moved since the last frame.
    if (fingers.current.size === 1) {
      const now = [...fingers.current.values()][0]!;
      const was = lastFinger.current;
      lastFinger.current = now;
      if (was) panBy(now.x - was.x, now.y - was.y);
      return;
    }

    const pair = pairOf();
    const start = from.current;
    if (!pair || !start) return;

    if (intent.current === "wait") {
      const spanChange = Math.abs(pair.span - start.span);
      const travelled = Math.hypot(pair.cx - start.cx, pair.cy - start.cy);
      if (spanChange > ZOOM_SLOP_PX && spanChange > travelled * ZOOM_DOMINANCE) {
        intent.current = "zoom";
        // A pinch zooms about the point the fingers *started* on, and the focus
        // is then frozen for the rest of the gesture. A midpoint wanders as two
        // fingers spread — by a few pixels, always — and a focus that followed it
        // would slide the page sideways while it scaled, which reads as the
        // document panning about while it zooms. A zoom is one thing about one
        // point; a hand that wants to move the paper uses the pan.
        focusOn(start);
      } else if (travelled > PAN_SLOP_PX) {
        intent.current = "pan";
        last.current = pair;
        return;
      } else {
        // Inside the tolerance: no pan, no zoom, no wobble.
        return;
      }
    }

    if (intent.current === "zoom") {
      const raw = start.span > 0 ? pair.span / start.span : 1;
      factor.current = Math.abs(raw - 1) < ZOOM_DEADBAND ? 1 : raw;
      handlers.current.onZoomPreview?.(factor.current, focus.current.x, focus.current.y);
      return;
    }

    const previous = last.current ?? start;
    last.current = pair;
    panBy(pair.cx - previous.cx, pair.cy - previous.cy);
  }, [focusOn, panBy, pairOf]);

  const schedule = useCallback(() => {
    if (frame.current != null) return;
    // No frames to wait for (a test, a worker): measure now rather than never.
    if (typeof requestAnimationFrame !== "function") {
      measure();
      return;
    }
    frame.current = requestAnimationFrame(measure);
  }, [measure]);

  /** Hand the pinch to the caller, once, and stop measuring it. */
  const commitZoom = useCallback(() => {
    if (frame.current != null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }
    handlers.current.onZoomCommit?.(factor.current, focus.current.x, focus.current.y);
    factor.current = 1;
  }, []);

  useEffect(
    () => () => {
      if (frame.current != null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  const begin = useCallback(
    (event: React.PointerEvent): boolean => {
      // A pen is not a finger: a stylus landing on a pinch is drawing.
      if (event.pointerType !== "touch") return false;
      const map = fingers.current;
      map.set(event.pointerId, { x: event.clientX, y: event.clientY });

      if (map.size >= 2) {
        // Two fingers are a gesture, so whatever the first one was doing — a
        // stroke, a loop — goes the way a palm's does.
        handlers.current.onGestureStart?.();
        // A new pair re-baselines: whatever was happening, this is a fresh
        // chance to be a pinch.
        intent.current = "wait";
        factor.current = 1;
        const pair = pairOf();
        from.current = pair;
        last.current = pair;
        if (pair) focusOn(pair);
        return true;
      }

      // One finger is the page's: the stylus draws, the hand moves the paper.
      intent.current = "pan";
      lastFinger.current = { x: event.clientX, y: event.clientY };
      return true;
    },
    [focusOn, pairOf],
  );

  const move = useCallback(
    (event: React.PointerEvent): boolean => {
      const map = fingers.current;
      if (!map.has(event.pointerId) || intent.current === "none") return false;
      map.set(event.pointerId, { x: event.clientX, y: event.clientY });
      // Nothing is done here: the frame decides, with every finger where it is.
      event.preventDefault();
      schedule();
      return true;
    },
    [schedule],
  );

  const end = useCallback(
    (event: React.PointerEvent): boolean => {
      const map = fingers.current;
      if (!map.has(event.pointerId)) return false;
      map.delete(event.pointerId);
      const handled = intent.current !== "none";

      if (map.size === 0) {
        if (intent.current === "zoom") commitZoom();
        intent.current = "none";
        from.current = null;
        last.current = null;
        lastFinger.current = null;
        return handled;
      }

      if (intent.current === "zoom") {
        // A pinch that loses a finger is over: what it reached is committed, and
        // the finger still down pans from here rather than starting a stroke.
        commitZoom();
        intent.current = "pan";
        last.current = null;
        lastFinger.current = [...map.values()][0] ?? null;
      } else if (intent.current === "pan" && map.size === 1) {
        // The pair is gone; the finger left keeps panning from where it is.
        last.current = null;
        lastFinger.current = [...map.values()][0] ?? null;
      }
      return handled;
    },
    [commitZoom],
  );

  return { begin, move, end };
}
