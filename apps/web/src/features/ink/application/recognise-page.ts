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
 *   which line it is on (§5.4), so each line is its own engine call. Windows
 *   Ink answers in milliseconds; MyScript is one request per line, which is the
 *   price of opting into it.
 */

import {
  applyInkSegmentation,
  inkPageConfidence,
  inkLineStrokes,
  inkStrokeBand,
  isUnsureLine,
  segmentInkLines,
  type InkLine,
  type InkLineRecord,
  type InkPage,
  type InkRecogniser,
  type InkRecognitionHints,
  type RecognisedLine,
} from "@weaveforge/core";

import { matchVocabulary } from "./vocab-match";

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

/** Whether two y-bands overlap by at least half of the smaller one. */
export function bandsCoincide(a: readonly [number, number], b: readonly [number, number]): boolean {
  const overlap = Math.min(a[1], b[1]) - Math.max(a[0], b[0]);
  const smaller = Math.min(a[1] - a[0], b[1] - b[0]);
  return smaller <= 0 ? overlap >= 0 : overlap >= smaller / 2;
}

/** The accepted (`confidence === 1`) lines of a page, by their band. */
export function acceptedLines(page: InkPage): { band: [number, number]; text: string }[] {
  const out: { band: [number, number]; text: string }[] = [];
  for (const line of page.lines) {
    if (line.confidence < 1 || !line.text) continue;
    const strokes = inkLineStrokes(page.strokes, line);
    let band: [number, number] | null = null;
    for (const stroke of strokes) {
      const b = inkStrokeBand(stroke);
      if (!b) continue;
      band = band ? [Math.min(band[0], b[0]), Math.max(band[1], b[1])] : b;
    }
    out.push({ band: band ?? [line.yMin, line.yMax], text: line.text });
  }
  return out;
}

/** The lines and records a recognised page reduces to; split out for tests. */
export function assembleRecognisedPage(
  page: InkPage,
  segmentation: ReturnType<typeof segmentInkLines>,
  results: readonly RecognisedLine[],
  engine: string,
): RecognisedPage {
  const applied = applyInkSegmentation(
    page.strokes,
    segmentation,
    results.map((line) => ({ text: line.text, confidence: line.conf })),
  );
  const lines: InkLineRecord[] = applied.lines;
  const next: InkPage = { ...page, strokes: applied.strokes, lines };
  const shown = results.filter((line) => line.text.trim().length > 0);
  return {
    page: next,
    text: shown.map((line) => line.text.trim()).join("\n"),
    lines: [...results],
    confidence: inkPageConfidence(results),
    unsure: results.filter((line) => line.text && isUnsureLine(line)).length,
    engine,
  };
}

export async function recognisePage(input: RecognisePageInput): Promise<RecognisedPage> {
  const { page, recogniser, hints } = input;
  const segmentation = segmentInkLines(page.strokes);
  const accepted = acceptedLines(page);
  const total = segmentation.lines.length;
  const results: RecognisedLine[] = [];

  for (const [index, line] of segmentation.lines.entries()) {
    if (input.signal?.aborted) throw new DOMException("Recognition was cancelled.", "AbortError");
    const kept = accepted.find((entry) => bandsCoincide(entry.band, line.yBand));
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
  } catch {
    raw = undefined;
  }
  if (!raw) return { text: "", conf: 0 };
  const matched = matchVocabulary(raw.text, hints.vocabulary);
  return {
    text: matched.text,
    conf: raw.conf,
    ...(raw.alternatives?.length ? { alternatives: raw.alternatives } : {}),
  };
}

/**
 * Accept a correction: the body line becomes the person's text and the page's
 * record is marked certain, which is what keeps it through the next run.
 */
export function acceptLine(recognised: RecognisedPage, index: number, text: string): RecognisedPage {
  const lines = recognised.lines.map((line, i) => (i === index ? { text, conf: 1 } : line));
  const records = recognised.page.lines.map((record, i) =>
    i === index ? { ...record, text, confidence: 1 } : record,
  );
  const page: InkPage = { ...recognised.page, lines: records };
  const shown = lines.filter((line) => line.text.trim().length > 0);
  return {
    ...recognised,
    page,
    lines,
    text: shown.map((line) => line.text.trim()).join("\n"),
    confidence: inkPageConfidence(lines),
    unsure: lines.filter((line) => line.text && isUnsureLine(line)).length,
  };
}

/**
 * The text layer a page already carries, without an engine: its line table as
 * recognised lines, for a page opened after an earlier run. The engine name is
 * the note's, since the table does not record it.
 */
export function recognisedPageFromModel(page: InkPage, engine: string | null): RecognisedPage {
  const lines: RecognisedLine[] = page.lines.map((record) => ({
    text: record.text,
    conf: record.confidence,
  }));
  const shown = lines.filter((line) => line.text.trim().length > 0);
  return {
    page,
    text: shown.map((line) => line.text.trim()).join("\n"),
    lines,
    confidence: inkPageConfidence(lines),
    unsure: lines.filter((line) => line.text && isUnsureLine(line)).length,
    engine: engine ?? "",
  };
}
