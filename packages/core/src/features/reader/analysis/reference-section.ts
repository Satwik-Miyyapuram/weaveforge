/**
 * Find the bibliography using section scoring rather than one exact heading.
 *
 * Every line is scored as a bibliography-heading candidate: known headings in
 * any of the languages papers are set in, typographic weight, position near
 * the end of the document, and — strongest — whether the lines that follow
 * actually look like numbered entries. The last candidate above threshold
 * wins (documents that mention "References" early in prose still end in the
 * real list). When nothing scores, the fallback looks for a numbered run
 * that starts at 1 and counts up in the last third of the document: some
 * PDFs set the heading as an image, or the text layer splits it.
 */

import { LABEL, labelNumber } from "./bibliography-parser.js";
import type { TextLine } from "./line-reconstruction.js";

/**
 * Bibliography headings, with the section number some templates prefix and
 * the qualifiers journals add ("References and Notes", "Literature Cited").
 * Case-insensitive because many templates set headings in small caps, which
 * the text layer reports as upper case.
 */
export const REFERENCES_HEADING =
  /^(?:\d+\.?\s+|[IVX]+\.?\s+)?(?:References?|Bibliography|Bibliographie|Works Cited|Literature Cited|Literatur(?:verzeichnis)?|Referencias|Références|Riferimenti|Referências|Bibliografia|Bibliografía|Cited Literature|Sources|Notes and References|References and Notes|Referenser|Referenselista|Lähdeluettelo|Viitteet|Litteratur|Källor|Kaynaklar|KAYNAKLAR|Список литературы|Литература|参考文献|引用文献)(?:\s+(?:and|&|y|und|et)\s+(?:Notes|Further Reading|Bibliography|notas))?\s*:?\s*$/iu;

/** Appendix headings that end a bibliography, in the common languages. */
const APPENDIX_HEADING =
  /^(?:[A-Z\d]+\.?\s+)?(?:Appendix|Appendices|Anhang|Annexe[s]?|Ap[eé]ndice|Anexo[s]?|Bijlage[n]?|Приложение)\b/iu;

const HEADING_EVIDENCE_WINDOW = 30;
/** Label + one corroborating signal is enough; prose never scores this. */
const SCORE_THRESHOLD = 4;

export interface ReferenceSectionSpan {
  /** Index of the first entry line (the heading itself is excluded). */
  start: number;
  /** Exclusive index of the first line after the section. */
  end: number;
  /** The heading line's index, when a heading was found. */
  headingIndex: number;
  score: number;
}

function evidenceScore(lines: readonly TextLine[], from: number): number {
  const window = lines.slice(from, from + HEADING_EVIDENCE_WINDOW);
  if (window.length < 3) return 0;
  const labelled = window.filter((line) => LABEL.test(line.text)).length;
  const fraction = labelled / window.length;
  if (fraction >= 0.4) return 2;
  if (fraction >= 0.2) return 1;
  return 0;
}

/**
 * The bibliography's line span within `lines` (already in reading order), or
 * null when the document has no detectable one.
 */
export function findReferenceSection(
  lines: readonly TextLine[],
  options: { bodyFontSize: number; pageCount: number; furniture?: ReadonlySet<TextLine> } = {
    bodyFontSize: 0,
    pageCount: 1,
  },
): ReferenceSectionSpan | null {
  const { bodyFontSize, pageCount, furniture } = options;
  const lastThirdPage = pageCount - Math.max(1, Math.ceil(pageCount / 3)) + 1;

  let best: { index: number; score: number } | null = null;
  lines.forEach((line, index) => {
    if (furniture?.has(line)) return;
    if (!REFERENCES_HEADING.test(line.text)) return;
    let score = 3;
    if (line.page >= lastThirdPage) score += 1;
    if (line.bold || (bodyFontSize > 0 && line.fontSize >= 1.12 * bodyFontSize)) score += 1;
    score += evidenceScore(lines, index + 1);
    if (!best || score >= best.score) best = { index, score };
  });
  const chosen = best as { index: number; score: number } | null;

  if (chosen && chosen.score >= SCORE_THRESHOLD) {
    return {
      start: chosen.index + 1,
      end: sectionEnd(lines, chosen.index),
      headingIndex: chosen.index,
      score: chosen.score,
    };
  }
  return fallbackNumberedRun(lines, pageCount);
}

/** The section ends at the next appendix or an equally prominent heading. */
function sectionEnd(lines: readonly TextLine[], headingIndex: number): number {
  const heading = lines[headingIndex]!;
  for (let i = headingIndex + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (APPENDIX_HEADING.test(line.text)) return i;
    if (
      line.fontSize >= heading.fontSize &&
      line.text.length <= 80 &&
      !LABEL.test(line.text) &&
      (line.bold || line.fontSize > heading.fontSize)
    ) {
      return i;
    }
  }
  return lines.length;
}

/**
 * No heading: scan the last third of the document (two to twenty pages) for
 * a numbered run that starts at 1 and counts up without gaps; that is a
 * bibliography whatever it is called. Gives up when more than two thirds of
 * the lines in that run carry no label — a numbered list in prose, say.
 */
export function fallbackNumberedRun(
  lines: readonly TextLine[],
  pageCount: number,
): ReferenceSectionSpan | null {
  const span = Math.min(20, Math.max(2, Math.ceil(pageCount / 3)));
  const firstPage = Math.max(1, pageCount - span + 1);
  const tailStart = lines.findIndex((line) => line.page >= firstPage);
  if (tailStart < 0) return null;
  const tail = lines.slice(tailStart);
  const one = tail.findIndex((line) => {
    const label = LABEL.exec(line.text);
    return label !== null && labelNumber(label) === 1;
  });
  if (one < 0) return null;
  const candidate = tail.slice(one);
  let expected = 1;
  let end = candidate.length;
  for (let i = 0; i < candidate.length; i++) {
    const label = LABEL.exec(candidate[i]!.text);
    if (!label) continue;
    const n = labelNumber(label);
    if (n === expected + 1) { expected = n; continue; }
    if (n === expected) continue;
    end = i;
    break;
  }
  const run = candidate.slice(0, end);
  if (expected < 3) return null;
  const unlabelled = run.filter((line) => !LABEL.test(line.text)).length;
  if (unlabelled > (run.length * 2) / 3) return null;
  return { start: tailStart + one, end: tailStart + one + end, headingIndex: -1, score: 3 };
}
