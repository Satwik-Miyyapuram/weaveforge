/**
 * Recognition: the contract every handwriting engine implements, and the order
 * they are preferred in (§5.1–§5.2).
 *
 * This module is **pure types and policy** — it imports no engine, names no
 * platform and does no I/O. The engines live behind {@link InkRecogniser} in the
 * layers that can reach them: Windows Ink through the desktop helper, an online
 * stroke model in the web worker, Chromium's own API when a build has it. That
 * keeps "which engine" a runtime decision and lets an ink note with *no* engine
 * stay a valid note: a title, typed links and strokes.
 *
 * The distinction that is load-bearing is `online`. An online engine consumes
 * the trajectory — direction, order, speed, pen-up gaps, pressure — which is
 * exactly what the digitiser already reports. An image engine re-infers all of
 * that from a raster, which is why it needs hundreds of megabytes and seconds
 * per page. Engines that are online are preferred, and the retracted v1 plan's
 * image OCR is not in the order at all.
 */

import type { InkStroke } from "./ink-note.js";

/** A line of strokes, as segmentation hands it to an engine. */
export interface InkLine {
  strokes: InkStroke[];
  yBand: [number, number];
}

/** What an engine returned for one line. */
export interface RecognisedLine {
  text: string;
  /** Engine score mapped to `[0, 1]`; `1` marks a human-corrected line. */
  conf: number;
  /** Other readings the engine offered, best first, for the correction UI. */
  alternatives?: string[];
}

/** What an engine is given besides the strokes. */
export interface InkRecognitionHints {
  /**
   * Words the note is likely to contain — note titles, paper titles, citation
   * keys. Windows Ink takes a word list as a recognition guide, which an image
   * model cannot; where an engine ignores it, `vocab-match.ts` is the post-pass.
   */
  vocabulary: string[];
  /** BCP 47 tag. Engines are told the language rather than guessing. */
  lang: string;
}

export interface InkRecogniser {
  /** Stable id, written into the note's `ink-engine` so a reader knows what ran. */
  readonly id: string;
  /** Whether it works with no network. Everything preferred here does. */
  readonly offline: boolean;
  /** Whether it consumes stroke trajectories rather than bitmaps. */
  readonly online: boolean;
  available(): Promise<boolean>;
  recognise(lines: InkLine[], hints: InkRecognitionHints): Promise<RecognisedLine[]>;
}

/**
 * The engines this build knows of, in the order they are tried (§5.2).
 *
 * One entry, and that is the honest list. `windows-ink` is the desktop engine and
 * costs nothing: `InkAnalyzer` ships with the OS, offline, with its language
 * models and shape recognisers already installed, reached over stdio by a helper
 * executable.
 *
 * **`stroke-ctc-small` and `chromium-hwr` used to be listed here and are gone.**
 * Neither ever existed: there are no stroke-model weights anywhere in this
 * repository, and `chromium-hwr` was described in this very comment as
 * "verified absent even on Windows Chromium, so it is wrapped and never relied
 * on". Listing them made the settings screen report two engines as
 * *unavailable* — "Built-in stroke model — not shipped in this build" — which is
 * a promise in a registry and an admission in the UI, and the reader rightly
 * asked what it was and why it was in their settings at all. A registry of
 * engines the build cannot run is not a plan; it is a list of noes.
 *
 * Their ids are **not** reserved for a later build. That was the original reason
 * for keeping them, and it bought nothing: an id nobody has ever produced a note
 * with does not need recognizing later. If a stroke model is ever trained, it
 * arrives with its own id and its own entry.
 *
 * `myscript` used to be last: a paid cloud recogniser, opt-in through a key in
 * Settings. It is gone, and its absence is a policy rather than a removal — the
 * app's claim about an ink note is that its text is read on the machine, and an
 * engine that has to be switched on is a claim with an exception in it.
 *
 * `trocr` is deliberately **not** here: revision 1's image OCR cost 240–330 MB
 * and 6–20 s a page, and §0.2 retracts it.
 */
export const INK_ENGINES = [
  { id: "windows-ink@1", offline: true, online: true, platform: "desktop-windows" },
] as const;

export type InkEngineId = (typeof INK_ENGINES)[number]["id"];

/** Where an engine can run, so a selector does not offer a desktop-only one. */
export type InkEnginePlatform = (typeof INK_ENGINES)[number]["platform"];

/** The order engines are preferred in, which is the declaration order. */
export const INK_ENGINE_ORDER: readonly InkEngineId[] = INK_ENGINES.map((engine) => engine.id);

/** Whether an engine id is one this build was written against. */
export function isInkEngineId(id: string): id is InkEngineId {
  return INK_ENGINE_ORDER.includes(id as InkEngineId);
}

/** The declared facts about an engine, or `null` for an id we do not know. */
export function inkEngineInfo(
  id: string,
): (typeof INK_ENGINES)[number] | null {
  return INK_ENGINES.find((engine) => engine.id === id) ?? null;
}

/**
 * The first engine that says it is available, or `null`.
 *
 * `available()` is asked in preference order and may be slow — it probes a
 * helper process or a model cache — so the winner is the caller's to keep for
 * the session rather than re-probing per page. An opt-in engine is passed in by
 * the caller that decided to opt in; this selector does not enable anything by
 * itself, which is what keeps the privacy line honest.
 */
export async function selectInkRecogniser(
  candidates: readonly InkRecogniser[],
): Promise<InkRecogniser | null> {
  const rank = (recogniser: InkRecogniser): number => {
    const index = INK_ENGINE_ORDER.indexOf(recogniser.id as InkEngineId);
    return index < 0 ? INK_ENGINE_ORDER.length : index;
  };
  const ordered = [...candidates].sort((a, b) => rank(a) - rank(b));
  for (const recogniser of ordered) {
    try {
      if (await recogniser.available()) return recogniser;
    } catch {
      // An engine that throws while probing is an engine that is not available.
      // The next one gets its turn rather than the page losing its text layer.
    }
  }
  return null;
}

/** Below this a line is shown dotted in the text layer and can be corrected. */
export const INK_UNSURE_CONFIDENCE = 0.75;

/** Whether a recognised line should be marked unsure. */
export function isUnsureLine(line: RecognisedLine): boolean {
  return !Number.isFinite(line.conf) || line.conf < INK_UNSURE_CONFIDENCE;
}

/**
 * An engine's own score, mapped to `[0, 1]`.
 *
 * Engines report confidence on scales of their own — a 0–100 integer, a log
 * probability, a raw score with no bounds. This clamps and normalises so the
 * threshold above means one thing everywhere; an engine with a genuinely
 * different calibration should pass `scale`.
 */
export function mapInkConfidence(raw: number, scale = 1): number {
  if (!Number.isFinite(raw)) return 0;
  const value = scale === 0 ? 0 : raw / scale;
  return Math.max(0, Math.min(1, value));
}

/**
 * The mean confidence of a page's lines, which is what the note's
 * `ink-recognised` records and the status bar shows.
 *
 * Lines the user corrected count as certain — a correction is the strongest
 * signal available, and averaging the engine's original doubt back in would
 * make the number go *down* after a fix.
 */
export function inkPageConfidence(lines: readonly RecognisedLine[]): number {
  if (lines.length === 0) return 0;
  const total = lines.reduce((sum, line) => sum + (line.conf >= 1 ? 1 : mapInkConfidence(line.conf)), 0);
  return total / lines.length;
}

/**
 * The vocabulary hints handed to an engine, from what the workspace already
 * knows.
 *
 * Titles and citation keys are what a research note is full of and what no
 * general recogniser has ever seen, so they do double duty: Windows Ink takes
 * them as a guide, and the post-match in `vocab-match.ts` uses the same list.
 * Deduplicated, trimmed and capped, because an engine's word list has a budget.
 */
export function inkVocabularyHints(
  sources: readonly (readonly string[])[],
  limit = 500,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const source of sources) {
    for (const entry of source) {
      const word = entry.trim();
      if (!word) continue;
      const key = word.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(word);
      if (out.length >= limit) return out;
    }
  }
  return out;
}
