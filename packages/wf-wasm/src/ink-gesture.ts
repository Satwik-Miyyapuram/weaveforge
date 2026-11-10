/**
 * The ink pointer gesture (Rust `ink::gesture`): the route picker and the
 * stroke's cut at the paper's edge. The picker asks each question in turn; the
 * caller answers it and feeds the answer back, so a callback runs only when the
 * route needs it. The DOM and pointer events stay in
 * `apps/web/src/features/ink/application/ink-gesture.ts`.
 */
import {
  InkRoutePicker as RawInkRoutePicker,
  StrokeEdgeSplit as RawStrokeEdgeSplit,
} from "../pkg/wf_wasm.js";
import type { DrawArea, Point } from "./bindings.js";

/** The armed tool, by name. */
export type InkToolName = "draw" | "eraser" | "lasso" | "region" | "none";

/** What a pointer's gesture does, or `null` when the caller keeps the down. */
export type InkRouteName = "erase" | "intercept" | "drag" | "lasso" | "draw" | "region";

/** A question the picker asks before it can choose. */
export type InkRouteQuestion = "sweepTip" | "admit" | "hitSelection" | "sweepTool" | "intercept";

/** The picker's next move: a question to answer, or the route. */
export type InkRouteStep =
  | { kind: "ask"; question: InkRouteQuestion }
  | { kind: "route"; route: InkRouteName | null };

/** What the caller knows about a down before any question. */
export interface InkRouteFacts {
  tool: InkToolName;
  tipErases: boolean;
  penBarrel: boolean;
  hasAdmit: boolean;
  hasHitSelection: boolean;
  hasIntercept: boolean;
}

/** One move of a stroke against the paper's edge. */
export type EdgeStepResult =
  | { kind: "inside" }
  | { kind: "outside" }
  | { kind: "exit"; at: Point }
  | { kind: "enter"; at: Point };

function parseStep(text: string): InkRouteStep {
  const separator = text.indexOf(":");
  const head = text.slice(0, separator);
  const name = text.slice(separator + 1);
  if (head === "ask") return { kind: "ask", question: name as InkRouteQuestion };
  return { kind: "route", route: name === "none" ? null : (name as InkRouteName) };
}

/** One down's route picker (Rust `RoutePicker`): built per down, driven to a route. */
export class InkRoutePicker {
  private readonly raw: RawInkRoutePicker;

  constructor(facts: InkRouteFacts) {
    this.raw = new RawInkRoutePicker(
      facts.tool,
      facts.tipErases,
      facts.penBarrel,
      facts.hasAdmit,
      facts.hasHitSelection,
      facts.hasIntercept,
    );
  }

  /** The first step: the back-tip sweep question. */
  start(): InkRouteStep {
    return parseStep(this.raw.start());
  }

  /** Feeds the answer to the last question and returns the next step. */
  answer(yes: boolean): InkRouteStep {
    return parseStep(this.raw.answer(yes));
  }
}

/** One stroke against the drawable area (Rust `StrokeEdgeSplit`). */
export class StrokeEdgeSplit {
  private readonly raw = new RawStrokeEdgeSplit();

  /** Whether the stroke is currently off the paper. */
  get outside(): boolean {
    return this.raw.outside;
  }

  begin(at: Point): void {
    this.raw.begin(at.x, at.y);
  }

  /** A `null` area means everywhere is paper. */
  move(at: Point, area: DrawArea | null): EdgeStepResult {
    return this.raw.move(at.x, at.y, area ?? null) as EdgeStepResult;
  }

  /** Forgets the stroke; true when it ended off the paper. */
  end(): boolean {
    return this.raw.end();
  }
}
