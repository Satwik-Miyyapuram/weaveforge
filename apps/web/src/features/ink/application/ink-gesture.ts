/**
 * Where a pointer gesture goes, and where a stroke crosses the paper's edge.
 *
 * Notes and the reader route a down the same way — back tip first, then the
 * armed tool — and cut a stroke where it leaves the page, so one place decides
 * both and a bug in either shows up on both surfaces.
 */

import { readyCore } from "@/lib/rust-core";
import type {
  DrawArea,
  EdgeStepResult,
  InkRouteQuestion,
  Point,
  StrokeEdgeSplit as WasmStrokeEdgeSplit,
} from "@weaveforge/wasm";
import { EraserSweep, isPenBarrelPointer, type EraserHoverEvent, type EraserSweepEvent } from "./eraser-tip";

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
    if (route !== "erase") this.sweep.release(event.pointerId);
    if (route) this.routes.set(event.pointerId, route);
    else this.routes.delete(event.pointerId);
    return route;
  }

  /** Drives the Rust route picker, answering each question from the context. */
  private pick(event: EraserSweepEvent, ctx: InkDownContext): InkRoute | null {
    const Picker = readyCore().InkRoutePicker;
    const picker = new Picker({
      tool: ctx.tool,
      tipErases: ctx.tipErases,
      penBarrel: isPenBarrelPointer(event),
      hasAdmit: ctx.admit !== undefined,
      hasHitSelection: ctx.hitSelection !== undefined,
      hasIntercept: ctx.intercept !== undefined,
    });
    let step = picker.start();
    while (step.kind === "ask") step = picker.answer(this.answer(step.question, event, ctx));
    return step.route;
  }

  /** The caller's answer to one picker question; the sweep questions also start the sweep. */
  private answer(question: InkRouteQuestion, event: EraserSweepEvent, ctx: InkDownContext): boolean {
    switch (question) {
      case "sweepTip":
        return this.sweep.begin(event, false, ctx.tipErases);
      case "admit":
        return ctx.admit?.() ?? true;
      case "hitSelection":
        return ctx.hitSelection?.() ?? false;
      case "sweepTool":
        return this.sweep.begin(event, ctx.tool === "eraser", false);
      case "intercept":
        return ctx.intercept?.() ?? false;
    }
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

  /** A move with no gesture under way: keeps a lifted back tip's eraser cursor showing. */
  hover(event: EraserHoverEvent): void {
    if (!this.routes.has(event.pointerId)) this.sweep.hover(event);
  }

  /** The pointer left the surface (or the pen left range). */
  leave(pointerId: number): void {
    this.sweep.leave(pointerId);
  }
}

/** One move of a stroke against the paper's edge. */
export type EdgeStep = EdgeStepResult;

/**
 * Tracks one stroke against the drawable area: the move that leaves it ends
 * the stroke at the crossing, and the move that returns starts a new one there.
 * The split itself is Rust (`ink::gesture::StrokeEdgeSplit`); this holds it lazily.
 */
export class StrokeEdgeSplit {
  private core: WasmStrokeEdgeSplit | null = null;

  private get split(): WasmStrokeEdgeSplit {
    if (!this.core) {
      const Split = readyCore().StrokeEdgeSplit;
      this.core = new Split();
    }
    return this.core;
  }

  get outside(): boolean {
    return this.split.outside;
  }

  begin(at: Point): void {
    this.split.begin(at);
  }

  /** A null area means everywhere is paper. */
  move(at: Point, area: DrawArea | null): EdgeStep {
    return this.split.move(at, area);
  }

  /** Forgets the stroke; true when it ended off the paper. */
  end(): boolean {
    return this.split.end();
  }
}
