/**
 * Detect section headings using font size, weight, numbering, position and
 * multilingual section words.
 *
 * A line is a heading when it is clearly larger than the body face, or bold
 * and either numbered or a known section word — whichever language the paper
 * is set in. Numbering ("3.1 Retrieval", "IV. Experiments") also fixes the
 * outline depth; unnumbered headings rank by font size. The outline is only
 * produced when the document supplies no bookmarks, and only when what was
 * found is plausible — an empty sidebar beats a misleading one.
 */

import type { ReaderOutlineItem } from "../outline-from-text.js";
import type { TextLine } from "./line-reconstruction.js";

/**
 * Section words worth trusting when bold. English first, then the languages
 * papers are actually submitted in — a Spanish thesis says "Metodología", a
 * German one "Zusammenfassung", and the detector must not need an exact
 * "Introduction".
 */
const SECTION_WORDS = new RegExp(
  String.raw`^(?:` +
    [
      "Abstract", "Introduction", "Related Work", "Background", "Motivation",
      "Method", "Methods", "Methodology", "Approach", "Model", "Experiments",
      "Experimental Setup", "Evaluation", "Results", "Analysis", "Discussion",
      "Conclusion", "Conclusions", "Future Work", "Acknowledg(?:e?)ments?",
      "References", "Appendix",
      // Spanish
      "Resumen", "Introducci[oó]n", "Trabajos relacionados", "Marco te[oó]rico",
      "M[eé]todo", "Metodolog[ií]a", "Experimentos", "Resultados",
      "Discusi[oó]n", "Conclusiones", "Referencias", "Bibliograf[ií]a",
      "Ap[eé]ndice", "Anexo", "Agradecimientos",
      // French
      "R[eé]sum[eé]", "Travaux connexes", "[ÉE]tat de l'art",
      "M[eé]thode", "M[eé]thodologie", "Exp[eé]riences",
      "Discussion", "Conclusion", "Annexe", "Remerciements",
      // German
      "Zusammenfassung", "Einleitung", "Verwandte Arbeiten", "Grundlagen",
      "Methodik", "Implementierung", "Experimente", "Ergebnisse", "Resultate",
      "Fazit", "Schlussfolgerung", "Literatur", "Literaturverzeichnis",
      "Anhang", "Danksagung",
      // Portuguese
      "Trabalhos relacionados", "Experimentos",
      "Conclus[aã]o", "Conclus[oõ]es", "Ap[eê]ndice",
      // Italian
      "Sommario", "Riassunto", "Lavori correlati", "Esperimenti",
      "Risultati", "Conclusioni", "Riferimenti", "Ringraziamenti",
      // Dutch
      "Samenvatting", "Inleiding", "Methode", "Resultaten", "Conclusie",
      "Referenties", "Bijlage",
    ].join("|") +
    String.raw`)\b`,
  "iu",
);

/** "3.1 Retrieval", "IV. Experiments", "A. Proof" — numbering that fixes depth. */
export const HEADING_NUMBER = /^(?:(\d+(?:\.\d+)*)|([IVXLC]+)|([A-Z]))\.?\s+\S/u;

/** A table-of-contents entry: title, a run of dots, a page number. */
const DOTTED_LEADER = /(\.\s*){5,}\d*$/;

export interface HeadingLine {
  line: TextLine;
  /** 1 for top-level, growing with the numbering depth or shrinking size. */
  level: number;
}

function numberOf(line: TextLine): { number: string; depth: number } | null {
  const match = HEADING_NUMBER.exec(line.text);
  if (!match) return null;
  const number = match[1] ?? match[2] ?? match[3]!;
  const depth = match[1] ? number.split(".").length : 1;
  return { number, depth };
}

/**
 * Which of the (furniture-free) lines are headings. `body` is the document's
 * modal font size; a heading is at least 12% larger, or bold and numbered or
 * a known section word. Long lines, dotted leaders and lines that end in a
 * period without numbering are prose.
 */
export function findHeadingLines(
  lines: readonly TextLine[],
  body: number,
  furniture: ReadonlySet<TextLine> = new Set(),
): TextLine[] {
  if (!body) return [];
  return lines.filter((line) => {
    if (furniture.has(line)) return false;
    const numbered = numberOf(line);
    if (line.text.length > 120 || (!numbered && line.text.endsWith("."))) return false;
    if (DOTTED_LEADER.test(line.text)) return false;
    if (line.fontSize >= 1.12 * body) return true;
    return line.bold && (numbered !== null || SECTION_WORDS.test(line.text));
  });
}

/**
 * Outline items from heading lines. Numbered headings take their depth from
 * the number; the rest rank by font size, largest first. The list is cut at
 * the references heading — everything below it is bibliography, not
 * sections.
 */
export function headingOutline(headings: readonly TextLine[]): ReaderOutlineItem[] {
  const decorated: HeadingLine[] = headings.map((line) => {
    const numbered = numberOf(line);
    return { line, level: numbered?.depth ?? 0 };
  });
  const sizes = [...new Set(decorated.filter((h) => !h.level).map((h) => h.line.fontSize))]
    .sort((a, b) => b - a);
  for (const heading of decorated) {
    if (!heading.level) heading.level = sizes.indexOf(heading.line.fontSize) + 1;
  }
  const roots: ReaderOutlineItem[] = [];
  const stack: { level: number; node: ReaderOutlineItem }[] = [];
  for (const { line, level } of decorated) {
    const node: ReaderOutlineItem = { title: line.text, pageNumber: line.page, y: line.y };
    while (stack.length && stack[stack.length - 1]!.level >= level) stack.pop();
    const parent = stack[stack.length - 1]?.node;
    if (parent) (parent.items ??= []).push(node);
    else roots.push(node);
    stack.push({ level, node });
    if (/^(?:\d+(?:\.\d+)*\.?\s+)?(?:References|Bibliography|Referencias|Références|Bibliographie|Literaturverzeichnis?)\b/iu.test(line.text)) break;
  }
  return roots;
}

/**
 * An outline is worth showing when it has at least three sections and no
 * stretch without one longer than half the document — otherwise it is a
 * couple of stray large lines.
 */
export function outlineIsPlausible(headings: readonly TextLine[], pageCount: number): boolean {
  if (headings.length < 3) return false;
  if (pageCount < 4) return true;
  const allowed = Math.ceil(pageCount * 0.5);
  let previous = 1;
  for (const heading of headings) {
    if (heading.page - previous > allowed) return false;
    previous = heading.page;
  }
  return pageCount - previous <= allowed;
}
