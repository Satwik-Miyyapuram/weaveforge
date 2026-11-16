import type { DesktopInkHaptics } from "@/lib/desktop/desktop-bridge";
import { logToApp } from "@/lib/error-report/app-log";
import { readyCore, typedCore } from "@/lib/rust-core";
import type {
  InkHand,
  InkLine,
  InkLineRecord,
  InkPage,
  InkRecogniser,
  InkRecognitionHints,
  InkSegmentation,
  RecognisedLine,
} from "@weaveforge/core";
import type { FilteredNibSample } from "./parts-2";

// --- pen-gate ---
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
/* -------------------------------------------------------------------------
 * The palm rules
 * ------------------------------------------------------------------------- */

/**
 * The palm threshold (mm²) and the CSS pixel scale come from Rust, `inkContactConsts`.
 *
 * `PointerEvent.width`/`height` are **CSS pixels**, not millimetres, so the
 * comparison converts with the CSS definition of a pixel (1/96 inch) rather than
 * pretending the two are the same unit — the trap §3.2 names. A pen nib reports a
 * contact well under a square millimetre; a resting palm reports tens of them.
 *
 * Read once, on first use, and kept for the page's life.
 */
let contactConsts: { cssPxPerMm: number; palmContactAreaMm2: number } | null =
  null;
function palmContactConsts(): {
  cssPxPerMm: number;
  palmContactAreaMm2: number;
} {
  if (contactConsts === null) contactConsts = readyCore().inkContactConsts();
  return contactConsts;
}

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
    if (readyCore().contactAreaMm2(event) > palmContactConsts().palmContactAreaMm2)
      return "area";
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

// --- pen-haptics ---
/**
 * The pen's own haptics (docs/internal/design/ink-native-bridges.md §4).
 *
 * A Surface Slim Pen 2 has an actuator in the barrel; driven with the pencil
 * waveform at an intensity set from pressure and speed, it feels like graphite
 * on paper — and, held still, like nothing, since friction is kinetic. The
 * engine that drives it lives in the desktop app's helper process; this side
 * only decides *what* to send and *how often*: one sample every ~8 ms at most,
 * with the velocity in the units the engine's gate is tuned in, and a stop the
 * moment the pen lifts.
 *
 * Nothing here is used unless the desktop bridge says the OS has the API. A
 * browser, or a Mac, gets a no-op.
 */
/** How often a sample goes down the pipe: 120 Hz, the digitiser's own rate. */
const UPDATE_INTERVAL_MS = 8;

/**
 * Ink units are 0.1 mm; the engine's velocity gate is in CSS px/ms (§4.2),
 * which at 96 dpi is 25.4 / 96 mm per px — so 2.6458 ink units per px.
 */
const INK_UNITS_PER_CSS_PX = (25.4 / 96) * 10;

export interface PenHapticsSink {
  inkHaptics(message: DesktopInkHaptics): void;
}

/** The tools the engine has a waveform for: graphite, felt, rubber. */
export type PenHapticsTool = Extract<
  DesktopInkHaptics,
  { type: "tool" }
>["tool"];

export interface PenHaptics {
  /** The tool the next stroke draws with; the waveform follows it. */
  setTool(tool: PenHapticsTool): void;
  /** One filtered sample of the stroke in flight. Throttled here. */
  update(sample: FilteredNibSample): void;
  /** The pen lifted: silence, at once and unthrottled. */
  stop(): void;
}

export function createPenHaptics(
  sink: PenHapticsSink,
  now: () => number = () =>
    typeof performance === "undefined" ? Date.now() : performance.now(),
): PenHaptics {
  let lastSent = -Infinity;
  let playing = false;
  return {
    setTool(tool) {
      sink.inkHaptics({ type: "tool", tool });
    },
    update(sample) {
      const t = now();
      if (t - lastSent < UPDATE_INTERVAL_MS) return;
      lastSent = t;
      playing = true;
      sink.inkHaptics({
        type: "update",
        pressure: Math.max(0, Math.min(1, sample.pressure)),
        velocity: Math.max(0, sample.velocity) / INK_UNITS_PER_CSS_PX,
      });
    },
    stop() {
      if (!playing) return;
      playing = false;
      lastSent = -Infinity;
      sink.inkHaptics({ type: "stop" });
    },
  };
}

// --- recognise-page ---
/**
 * One page through recognition: segment, recognise line by line, post-match,
 * keep the corrections, and write the result back into the page model and the
 * text layer (§5.4).
 *
 * Two rules carry the design:
 *
 * - **A correction survives.** A line whose stored `confidence` is `1` was
 *   accepted by a person, and re-recognition never overwrites it. The line is
 *   found again by its strokes' y-band — the same strokes in the same place are
 *   the same line, whatever order they come back in — so a page that was
 *   re-segmented after an added margin note still keeps its accepted text.
 * - **Progress is per line.** The first run of a page is on demand and shows
 *   which line it is on (§5.4), so each line is its own engine call. Windows Ink
 *   answers in milliseconds, and it is the only engine that answers at all in
 *   this build.
 */
export interface RecognisePageInput {
  page: InkPage;
  recogniser: InkRecogniser;
  hints: InkRecognitionHints;
  /** Called after each line, so the bar can say "line 3 of 12". */
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

export interface RecognisedPage {
  /** The page with strokes in line order and the line table filled in. */
  page: InkPage;
  /** The text-layer page: one paragraph per line, in reading order. */
  text: string;
  /** The lines as the text layer shows them, with their confidence. */
  lines: RecognisedLine[];
  /** The page's mean confidence, which `ink-recognised` records. */
  confidence: number;
  /** How many lines are below the unsure threshold. */
  unsure: number;
  engine: string;
}

/** The accepted (`confidence === 1`) lines of a page, by their band. */
export function acceptedLines(
  page: InkPage,
): { band: [number, number]; text: string }[] {
  const out: { band: [number, number]; text: string }[] = [];
  for (const line of page.lines) {
    if (line.confidence < 1 || !line.text) continue;
    const strokes = typedCore().inkLineStrokes(page.strokes, line);
    const bands: number[] = [];
    for (const stroke of strokes) {
      const b = typedCore().inkStrokeBand(stroke);
      if (b) bands.push(b[0], b[1]);
    }
    const band = readyCore().inkBandUnion(Float64Array.from(bands));
    out.push({ band: band ?? [line.yMin, line.yMax], text: line.text });
  }
  return out;
}

/** The lines and records a recognised page reduces to; split out for tests. */
export function assembleRecognisedPage(
  page: InkPage,
  segmentation: InkSegmentation,
  results: readonly RecognisedLine[],
  engine: string,
): RecognisedPage {
  const applied = readyCore().applyInkSegmentation(
    page.strokes,
    segmentation,
    results.map((line) => ({ text: line.text, confidence: line.conf })),
  );
  const lines: InkLineRecord[] = applied.lines;
  const next: InkPage = { ...page, strokes: applied.strokes, lines };
  const summary = readyCore().inkPageSummary(results);
  return {
    page: next,
    text: summary.text,
    lines: [...results],
    confidence: summary.confidence,
    unsure: summary.unsure,
    engine,
  };
}

export async function recognisePage(
  input: RecognisePageInput,
): Promise<RecognisedPage> {
  const { page, recogniser, hints } = input;
  const segmentation = readyCore().segmentInkLines(page.strokes);
  const accepted = acceptedLines(page);
  const total = segmentation.lines.length;
  const results: RecognisedLine[] = [];

  for (const [index, line] of segmentation.lines.entries()) {
    if (input.signal?.aborted)
      throw new DOMException("Recognition was cancelled.", "AbortError");
    const kept = accepted.find((entry) =>
      readyCore().bandsCoincide(entry.band, line.yBand),
    );
    if (kept) {
      results.push({ text: kept.text, conf: 1 });
    } else {
      results.push(await recogniseLine(recogniser, line, hints));
    }
    input.onProgress?.(index + 1, total);
  }
  return assembleRecognisedPage(page, segmentation, results, recogniser.id);
}

/** One line through the engine and the post-match. A throw is an empty line. */
async function recogniseLine(
  recogniser: InkRecogniser,
  line: InkLine,
  hints: InkRecognitionHints,
): Promise<RecognisedLine> {
  let raw: RecognisedLine | undefined;
  try {
    [raw] = await recogniser.recognise([line], hints);
  } catch (err) {
    logToApp({ level: "warn", source: "ink", message: `Handwriting engine ${recogniser.id} failed on a line`, detail: String(err) });
    raw = undefined;
  }
  if (!raw) return { text: "", conf: 0 };
  const matched = readyCore().matchVocabulary(raw.text, hints.vocabulary);
  return {
    text: matched.text,
    // Never `1` from an engine: that is the mark of a correction, which the
    // next run keeps instead of recognising again.
    conf: readyCore().cappedEngineConfidence(raw.conf),
    ...(raw.alternatives?.length ? { alternatives: raw.alternatives } : {}),
  };
}

/**
 * Accept a correction: the body line becomes the person's text and the page's
 * record is marked certain, which is what keeps it through the next run.
 */
export function acceptLine(
  recognised: RecognisedPage,
  index: number,
  text: string,
): RecognisedPage {
  const lines = recognised.lines.map((line, i) =>
    i === index ? { text, conf: 1 } : line,
  );
  const records = recognised.page.lines.map((record, i) =>
    i === index ? { ...record, text, confidence: 1 } : record,
  );
  const page: InkPage = { ...recognised.page, lines: records };
  const summary = readyCore().inkPageSummary(lines);
  return {
    ...recognised,
    page,
    lines,
    text: summary.text,
    confidence: summary.confidence,
    unsure: summary.unsure,
  };
}

/**
 * The text layer a page already carries, without an engine: its line table as
 * recognised lines, for a page opened after an earlier run. The engine name is
 * the note's, since the table does not record it.
 */
export function recognisedPageFromModel(
  page: InkPage,
  engine: string | null,
): RecognisedPage {
  const lines: RecognisedLine[] = page.lines.map((record) => ({
    text: record.text,
    conf: record.confidence,
  }));
  const summary = readyCore().inkPageSummary(lines);
  return {
    page,
    text: summary.text,
    lines,
    confidence: summary.confidence,
    unsure: summary.unsure,
    engine: engine ?? "",
  };
}
