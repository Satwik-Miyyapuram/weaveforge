/**
 * Where a pointer gesture goes, and where a stroke crosses the paper's edge.
 *
 * Notes and the reader route a down the same way — back tip first, then the
 * armed tool — and cut a stroke where it leaves the page, so one place decides
 * both and a bug in either shows up on both surfaces.
 */

import { clipSegmentToArea, pointInArea, type DrawArea, type Point } from "./clip-to-area";
import { EraserSweep, type EraserSweepEvent } from "./eraser-tip";

/** The armed tool, as the gesture sees it. */
export type InkToolKind = "draw" | "eraser" | "lasso" | "region" | "none";

/** What a pointer's gesture does from down to up. */
export type InkRoute = "erase" | "intercept" | "drag" | "lasso" | "draw" | "region";

export interface InkDownContext {
  tool: InkToolKind;
  /** Whether the pen's back tip erases on this surface right now. */
  tipErases: boolean;
  /** The surface claims the down for itself (a figure drag); checked before drawing. */
  intercept?: () => boolean;
  /** With the lasso armed, whether the down lands on the current selection. */
  hitSelection?: () => boolean;
  /** Whether this pointer may draw at all (touch-to-draw off, palm, …). */
  admit?: () => boolean;
}

export class InkGesture {
  private readonly sweep: EraserSweep;
  private readonly routes = new Map<number, InkRoute>();

  constructor(eraserCursor: string) {
    this.sweep = new EraserSweep(eraserCursor);
  }

  /** Picks the route for a down and remembers it; null leaves the down to the caller. */
  down(event: EraserSweepEvent, ctx: InkDownContext): InkRoute | null {
    const route = this.pick(event, ctx);
    if (route) this.routes.set(event.pointerId, route);
    else this.routes.delete(event.pointerId);
    return route;
  }

  private pick(event: EraserSweepEvent, ctx: InkDownContext): InkRoute | null {
    if (this.sweep.begin(event, false, ctx.tipErases)) return "erase";
    if (ctx.tool === "lasso") return ctx.hitSelection?.() ? "drag" : "lasso";
    if (ctx.tool === "none") return null;
    if (ctx.admit && !ctx.admit()) return null;
    if (this.sweep.begin(event, ctx.tool === "eraser", false)) return "erase";
    if (ctx.intercept?.()) return "intercept";
    return ctx.tool === "region" ? "region" : "draw";
  }

  /** The route `pointerId` is on, or null when it has none. */
  route(pointerId: number): InkRoute | null {
    return this.routes.get(pointerId) ?? null;
  }

  /** Ends `pointerId`'s gesture and returns the route it was on. */
  up(pointerId: number): InkRoute | null {
    const route = this.routes.get(pointerId) ?? null;
    this.routes.delete(pointerId);
    if (route === "erase") this.sweep.end(pointerId);
    return route;
  }
}

/** One move of a stroke against the paper's edge. */
export type EdgeStep =
  | { kind: "inside" }
  | { kind: "exit"; at: Point }
  | { kind: "outside" }
  | { kind: "enter"; at: Point };

/**
 * Tracks one stroke against the drawable area: the move that leaves it ends
 * the stroke at the crossing, and the move that returns starts a new one there.
 */
export class StrokeEdgeSplit {
  private last: Point | null = null;
  private out = false;

  get outside(): boolean {
    return this.out;
  }

  begin(at: Point): void {
    this.last = at;
    this.out = false;
  }

  /** A null area means everywhere is paper. */
  move(at: Point, area: DrawArea | null): EdgeStep {
    const previous = this.last ?? at;
    this.last = at;
    const onPaper = !area || pointInArea(area, at.x, at.y);
    if (this.out) {
      if (!onPaper) return { kind: "outside" };
      this.out = false;
      const clipped = area ? clipSegmentToArea(area, previous, at) : null;
      return { kind: "enter", at: clipped?.from ?? at };
    }
    if (onPaper) return { kind: "inside" };
    this.out = true;
    const clipped = area ? clipSegmentToArea(area, previous, at) : null;
    return { kind: "exit", at: clipped?.to ?? at };
  }

  /** Forgets the stroke; true when it ended off the paper. */
  end(): boolean {
    const was = this.out;
    this.out = false;
    this.last = null;
    return was;
  }
}
