/**
 * Ink line segmentation and recognition helpers (steps 5-2c, 5-2d), re-exported from
 * index.ts. Rust returns stroke indices; these wrappers map them back to the
 * caller's stroke objects. serde_wasm_bindgen sends every f64 as a JS number,
 * so the `number | null` that bindings.ts gives an f64 is narrowed here.
 */
import {
  segmentInkLines as rawSegmentInkLines,
  inkLineRecords as rawInkLineRecords,
  isUnsureConfidence as rawIsUnsureConfidence,
  inkPageConfidence as rawInkPageConfidence,
  decodeInkWords as rawDecodeInkWords,
  bandsCoincide as rawBandsCoincide,
  inkPageSummary as rawInkPageSummary,
  inkBandUnion as rawInkBandUnion,
} from "../pkg/wf_wasm.js";
import type {
  InkSegmentationIndices,
} from "./bindings.js";

export {
  cappedEngineConfidence,
  inkUnsureConfidence,
  inkVocabularyHints,
  mapInkConfidence,
} from "../pkg/wf_wasm.js";

/**
 * A page's pen strokes grouped into lines, top to bottom, and the line each
 * input stroke went into (`-1` for none) (Rust `segment_ink_lines`).
 */
export function segmentInkLines<S extends { points: readonly number[]; tool: string; t0: number }>(
  strokes: readonly S[],
  options: { windowMs?: number; bandRatio?: number } = {},
): { lines: { strokes: S[]; yBand: [number, number] }[]; lineOfStroke: number[] } {
  const offsets = new Uint32Array(strokes.length + 1);
  strokes.forEach((stroke, i) => {
    offsets[i + 1] = offsets[i]! + stroke.points.length;
  });
  const points = Float64Array.from(strokes.flatMap((stroke) => stroke.points));
  const pen = Uint8Array.from(strokes, (stroke) => (stroke.tool === "pen" ? 1 : 0));
  const t0s = Float64Array.from(strokes, (stroke) => stroke.t0);
  const raw = rawSegmentInkLines(points, offsets, pen, t0s, options.windowMs, options.bandRatio) as InkSegmentationIndices;
  return {
    lines: raw.lines.map((line) => ({
      strokes: line.strokeIndices.map((index) => strokes[index]!),
      yBand: line.yBand as [number, number],
    })),
    lineOfStroke: raw.lineOfStroke,
  };
}

/**
 * Strokes reordered so each line's are contiguous, tagged with their line
 * (unsegmented ones last, `-1`), and the line records the container stores
 * (Rust `ink_line_records`).
 */
export function applyInkSegmentation<S extends object>(
  strokes: readonly S[],
  segmentation: { lines: readonly { strokes: readonly S[]; yBand: readonly [number, number] }[]; lineOfStroke: readonly number[] },
  recognised: readonly ({ text: string; confidence: number } | undefined)[] = [],
): {
  strokes: (S & { lineIndex: number })[];
  lines: { strokeStart: number; strokeCount: number; yMin: number; yMax: number; text: string; confidence: number }[];
} {
  const grouped: (S & { lineIndex: number })[] = [];
  segmentation.lines.forEach((line, lineIndex) => {
    for (const stroke of line.strokes) grouped.push({ ...stroke, lineIndex });
  });
  for (const [index, stroke] of strokes.entries()) {
    if (segmentation.lineOfStroke[index] === -1) grouped.push({ ...stroke, lineIndex: -1 });
  }
  const counts = Uint32Array.from(segmentation.lines, (line) => line.strokes.length);
  const bands = Float64Array.from(segmentation.lines.flatMap((line) => [line.yBand[0], line.yBand[1]]));
  return { strokes: grouped, lines: inkLineRecords(counts, bands, recognised) };
}

/**
 * The stored line records: `counts[i]` strokes in line `i`, `bands` its flat
 * `yMin, yMax` pairs, `recognised` its text and confidence (Rust `ink_line_records`).
 */
export function inkLineRecords(
  counts: Uint32Array,
  bands: Float64Array,
  recognised: readonly ({ text: string; confidence: number } | undefined)[] = [],
): { strokeStart: number; strokeCount: number; yMin: number; yMax: number; text: string; confidence: number }[] {
  return rawInkLineRecords(counts, bands, recognised) as ReturnType<typeof inkLineRecords>;
}

/** Whether a line's confidence is too low, or missing, to trust (Rust `is_unsure_confidence`). */
export function isUnsureLine(line: { conf: number }): boolean {
  return isUnsureConfidence(line.conf);
}

/** Whether a confidence is too low, or missing (NaN), to trust (Rust `is_unsure_confidence`). */
export function isUnsureConfidence(conf: number): boolean {
  return rawIsUnsureConfidence(conf);
}

/** Whether two y-bands overlap by at least half of the smaller one (Rust `bands_coincide`). */
export function bandsCoincide(a: readonly [number, number], b: readonly [number, number]): boolean {
  return rawBandsCoincide(a[0], a[1], b[0], b[1]);
}

/**
 * The `[start, end]` band spanning the flat `start, end` pairs given, or `null` when
 * there are none (Rust `band_union`).
 */
export function inkBandUnion(bands: Float64Array): [number, number] | null {
  const united = rawInkBandUnion(bands);
  return united.length === 2 ? [united[0]!, united[1]!] : null;
}

/**
 * The page summary: the trimmed non-empty line texts joined by newlines, the page's
 * confidence, and the count of unsure lines (Rust `ink_page_summary`).
 */
export function inkPageSummary(
  lines: readonly { text: string; conf: number }[],
): { text: string; confidence: number; unsure: number } {
  return rawInkPageSummary(lines) as ReturnType<typeof inkPageSummary>;
}

/** A page's mean line confidence, corrected lines counting as 1 (Rust `ink_page_confidence`). */
export function inkPageConfidence(lines: readonly { conf: number }[]): number {
  return rawInkPageConfidence(Float64Array.from(lines, (line) => line.conf));
}

/**
 * One line from its words' readings: the chosen text, a confidence under
 * `INK_ENGINE_MAX_CONFIDENCE`, and whole-line alternatives (Rust `decode_ink_words`).
 */
export function decodeInkWords(
  words: readonly { candidates: readonly string[]; known?: readonly boolean[] | null; join?: string | null }[],
  vocabulary: readonly string[],
  engineText?: string,
): { text: string; conf: number; alternatives?: string[] } {
  return rawDecodeInkWords(words, vocabulary, engineText) as ReturnType<typeof decodeInkWords>;
}
