/**
 * The palm rules: which pointer may draw, and what makes a touch a hand.
 *
 * Split out of `use-pen-capture.ts` when that file crossed the repository's
 * 800-line source limit, and the seam is the right one: this half is **shared** —
 * the reader imports {@link InkPenGate} through the feature's index and has since
 * step 2 — while the half that stayed is the ink note's own capture pipeline. The
 * gate has no worker, no samples and no React in it; it is three deterministic
 * comparisons and the state they need.
 *
 * The rules themselves are §3.1 and §3.2 of the plan, explained at each one.
 */

import type { InkHand } from "@weaveforge/core";
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
    const penRecently =
      this.lastPenDownAt !== Number.NEGATIVE_INFINITY &&
      Math.abs(event.t - this.lastPenDownAt) <= PALM_PEN_GRACE_MS;
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

    if (
      event.pointerType === "pen" &&
      this.activeId !== null &&
      this.activeIsTouch
    ) {
      const cancelled = [this.activeId];
      this.release();
      this.deferred.delete(cancelled[0]!);
      this.claim(event, decision);
      return { decision, cancelled };
    }

    if (
      event.pointerType === "touch" &&
      this.activeId !== null &&
      this.activeIsTouch
    ) {
      const cancelled: number[] = [];
      if (event.t - this.activeStartedAt <= PALM_SECOND_TOUCH_MS)
        cancelled.push(this.activeId);
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
      this.deferred.set(event.pointerId, {
        x: event.clientX ?? 0,
        y: event.clientY ?? 0,
      });
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
    if (Math.hypot(at.x - origin.x, at.y - origin.y) > TOUCH_MOVE_SLOP_PX)
      return "draw";
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
    const handSide =
      this.handedness === "right" ? x > bounds.width / 2 : x < bounds.width / 2;
    return lowerHalf && handSide;
  }
}

/** A contact's area in mm², from the CSS pixels a `PointerEvent` reports. */
export function contactAreaMm2(
  event: Pick<PenGateEvent, "width" | "height">,
): number {
  const width = event.width ?? 0;
  const height = event.height ?? 0;
  if (!(width > 0) || !(height > 0)) return 0;
  return (width / CSS_PX_PER_MM) * (height / CSS_PX_PER_MM);
}
