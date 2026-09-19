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
 * A word a PDF may set in small caps, as a pattern matching it either solid or
 * with the space the text layer puts after the initial.
 *
 * A small-caps heading is two fonts, so pdf.js reports "R EFERENCES" (IWAE) or
 * "1 I NTRODUCITON" — and a pattern written as a literal word matches neither,
 * which is how a paper's real reference list goes missing entirely. Only the
 * *first* letter is separated, because that is what small caps produce: the
 * initial is a full capital and the remainder is a smaller face.
 *
 * Each letter becomes its own character class, so a single pattern covers both
 * "References" and "R EFERENCES". Offering the whole tail as optional is not
 * the same thing — it matched the bare initial, and `k` (the bolded index of
 * `L_k`, its own line inside a display equation) then read as a bibliography
 * heading. `findReferenceSection` keeps the last candidate, so those equations
 * beat the real heading and a paper's references came back as algebra.
 */
function smallCaps(word: string): string {
  // Each letter becomes its own case class with an optional gap after it, so one
  // pattern matches the solid word and the small-caps one. The caller's own
  // spaces are gaps too — a literal space is *not* equivalent, because the
  // `\s*` before it can already have taken that space, and "Related Work" then
  // stopped matching at the gap.
  //
  // The replacement is a function, not a string: in a string replacement `\s`
  // is not a recognised escape and the backslash is dropped, which silently
  // turned the intended `\s*` into a literal "s*" — "Introduction" became
  // "…n]s*" and matched nothing.
  const letters = word.replace(/([A-Za-z])(s?\?)?/g, (_m, letter: string, suffix: string) =>
    `[${letter.toLowerCase()}${letter.toUpperCase()}]${suffix ?? ""}`,
  );
  return letters
    .replace(/(\])(?=.)/g, (_m, close: string) => `${close}\\s*`)
    .replace(/ /g, "\\s*");
}

const REFERENCES_WORD = [
  "References?",
  "Bibliography",
  "Bibliographie",
  "Works Cited",
  "Literature Cited",
  "Literatur(?:verzeichnis)?",
  "Referencias",
  "Références",
  "Riferimenti",
  "Referências",
  "Bibliografia",
  "Bibliografía",
  "Cited Literature",
  "Sources",
  "Notes and References",
  "References and Notes",
  "Referenser",
  "Referenselista",
  "Lähdeluettelo",
  "Viitteet",
  "Litteratur",
  "Källor",
  "Kaynaklar",
  "KAYNAKLAR",
  "Список литературы",
  "Литература",
  "参考文献",
  "引用文献",
]
  .map(smallCaps)
  .join("|");

/**
 * Bibliography headings, with the section number some templates prefix and
 * the qualifiers journals add ("References and Notes", "Literature Cited").
 * Case-insensitive because many templates set headings in small caps, which
 * the text layer reports as upper case — and often as two runs.
 */
export const REFERENCES_HEADING = new RegExp(
  String.raw`^(?:\d+\.?\s+|[IVX]+\.?\s+)?(?:${REFERENCES_WORD})(?:\s+(?:and|&|y|und|et)\s+(?:${smallCaps("Notes")}|${smallCaps("Further Reading")}|${smallCaps("Bibliography")}|notas))?\s*:?\s*$`,
  "iu",
);

/** Appendix headings that end a bibliography, in the common languages. */
export const APPENDIX_HEADING = new RegExp(
  String.raw`^(?:[A-Z\d]+\.?\s+)?(?:${smallCaps("Appendix")}|${smallCaps("Appendices")}|${smallCaps("Anhang")}|${smallCaps("Annexe")}s?|${smallCaps("Apéndice")}|${smallCaps("Anexo")}s?|${smallCaps("Bijlage")}n?|${smallCaps("Приложение")})\b`,
  "iu",
);

/**
 * A section heading that structures the document, whatever else is true of it.
 *
 * Asked by the furniture pass, which must never delete one: a heading is
 * content even when it sits in a page's margin band and even when it recurs on
 * several pages. A paper that prints its reference list in an appendix, or one
 * whose heading is set in small caps, is exactly where that went wrong.
 */
const STRUCTURAL_WORD = [
  "Abstract",
  "Introduction",
  "Background",
  "Related Work",
  "Preliminaries",
  "Method",
  "Methods",
  "Methodology",
  "Model Architecture",
  "Experiments",
  "Experimental Setup",
  "Evaluation",
  "Results",
  "Discussion",
  "Limitations",
  "Conclusion",
  "Conclusions",
  "Acknowledgments",
  "Acknowledgements",
  "References",
  "Bibliography",
  "Appendix",
  "Appendices",
]
  .map(smallCaps)
  .join("|");

export const STRUCTURAL_HEADING = new RegExp(
  String.raw`^(?:\d+(?:\.\d+)*\.?\s+|[A-Z]\.?\s+)?(?:${STRUCTURAL_WORD})\b`,
  "iu",
);

const HEADING_EVIDENCE_WINDOW = 30;
/** Labelled lines per point of evidence. */
const EVIDENCE_PER_ENTRY = 6;
/** Most evidence points one heading can earn, however long its list. */
const EVIDENCE_MAX = 3;
/** A heading with a few entries under it scores ≥ 4; prose never does. */
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

/** Labelled lines in the heading's evidence window (capped by its length). */
function labelledNear(lines: readonly TextLine[], from: number): number {
  return lines
    .slice(from, from + HEADING_EVIDENCE_WINDOW)
    .filter((line) => LABEL.test(line.text)).length;
}

/**
 * How strongly the lines under a heading look like a bibliography: how many
 * entries there are, capped.
 *
 * A *fraction* was the wrong measure. It flatters a short list — six entries in
 * a six-line window is a perfect score — and it punishes a long one that simply
 * outruns the window, so InfoGAN's 30-entry bibliography scored below the
 * appendix's 6-entry re-listing as soon as position was counted. Entries are
 * what a bibliography is made of, so the count is what this scores; the cap
 * stops one very long list from dominating every other signal.
 */
function evidenceScore(lines: readonly TextLine[], from: number): number {
  const window = lines.slice(from, from + HEADING_EVIDENCE_WINDOW);
  if (window.length < 3) return 0;
  return Math.min(EVIDENCE_MAX, Math.floor(labelledNear(lines, from) / EVIDENCE_PER_ENTRY));
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

  let best: { index: number; score: number; labelled: number } | null = null;
  lines.forEach((line, index) => {
    if (furniture?.has(line)) return;
    if (!REFERENCES_HEADING.test(line.text)) return;
    let score = 3;
    if (line.page >= lastThirdPage) score += 1;
    if (line.bold || (bodyFontSize > 0 && line.fontSize >= 1.12 * bodyFontSize)) score += 1;
    score += evidenceScore(lines, index + 1);
    // How many entries actually follow, as the tie-break. A document can print
    // two "References" headings — InfoGAN lists its bibliography after the
    // conclusion and then labels the appendix's re-listing the same way — and
    // they score identically on position and weight. The list is the one with
    // the entries under it: 30 against 6 here, so picking the later heading
    // (the old rule) returned the appendix's six references and said the paper
    // had almost none. Only an *equal* count falls back to recency.
    const labelled = labelledNear(lines, index + 1);
    if (!best || score > best.score || (score === best.score && labelled > best.labelled)) {
      best = { index, score, labelled };
    }
  });
  const chosen = best as { index: number; score: number; labelled: number } | null;

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
