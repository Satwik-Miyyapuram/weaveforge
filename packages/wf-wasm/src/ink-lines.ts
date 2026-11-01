/**
 * Ink line segmentation and recognition helpers (step 5-2c), re-exported from
 * index.ts. Rust returns stroke indices; these wrappers map them back to the
 * caller's stroke objects. serde_wasm_bindgen sends every f64 as a JS number,
 * so the `number | null` that bindings.ts gives an f64 is narrowed here.
 */
import {
  segmentInkLines as rawSegmentInkLines,
  inkLineRecords as rawInkLineRecords,
  isUnsureConfidence as rawIsUnsureConfidence,
  mapInkConfidence as rawMapInkConfidence,
  inkPageConfidence as rawInkPageConfidence,
  inkVocabularyHints as rawInkVocabularyHints,
} from "../pkg/wf_wasm.js";
import type { InkSegmentationIndices } from "./bindings.js";

/**
 * A page's pen strokes grouped into lines, top to bottom, and the line each
 * input stroke went into (`-1` for none) (Rust `segment_ink_lines`).
 */
export function segmentInkLines<S extends { points: readonly number[]; tool: string; t0: number }>(
  strokes: readonly S[],
  options: { windowMs?: number; bandRatio?: number } = {},
): { lines: { strokes: S[]; yBand: [number, number] }[]; lineOfStroke: number[] } {
  const input = strokes.map(({ points, tool, t0 }) => ({ points, tool, t0 }));
  const raw = rawSegmentInkLines(input, options.windowMs, options.bandRatio) as InkSegmentationIndices;
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
  const lines = rawInkLineRecords(counts, bands, recognised) as ReturnType<typeof applyInkSegmentation>["lines"];
  return { strokes: grouped, lines };
}

/** Whether a line's confidence is too low, or missing, to trust (Rust `is_unsure_confidence`). */
export function isUnsureLine(line: { conf: number }): boolean {
  return rawIsUnsureConfidence(line.conf);
}

/** An engine's raw score mapped to [0, 1] (Rust `map_ink_confidence`). */
export function mapInkConfidence(raw: number, scale = 1): number {
  return rawMapInkConfidence(raw, scale);
}

/** A page's mean line confidence, corrected lines counting as 1 (Rust `ink_page_confidence`). */
export function inkPageConfidence(lines: readonly { conf: number }[]): number {
  return rawInkPageConfidence(Float64Array.from(lines, (line) => line.conf));
}

/** Trimmed, case-insensitively unique hint words, at most `limit` (Rust `ink_vocabulary_hints`). */
export function inkVocabularyHints(sources: readonly (readonly string[])[], limit = 500): string[] {
  return rawInkVocabularyHints(sources, limit) as string[];
}
