import { cleanPdfText } from "@weaveforge/core";

/**
 * Clipboard representation shared by paper annotation cards and the report
 * section pane. Annotation persistence now lives on paper metadata; this file
 * intentionally contains no vault-note synchronization.
 *
 * The quote is repaired on the way out, because of where it came from: a
 * highlight's text is the PDF's text layer, so it arrives wrapped at the
 * column the typesetter chose, with words split by hyphens the typesetter
 * added and `fi` and `ffl` as single glyphs. Quoted into a section like that it
 * is wrong as a quotation and unfindable in search. The repair belongs here
 * rather than at the point the annotation is stored: the stored text stays
 * exactly what the file says, and only the rendering for a note is mended.
 */
export function formatQuoteCiteClipboard(quote: string, paperTitle: string): string {
  const repaired = cleanPdfText(quote.replace(/\r\n?/g, "\n"), {
    // Neither guess is safe without a person to confirm it: a lone number in a
    // highlight is as likely to be data as a page number, and a highlight that
    // spans two paragraphs meant to.
    removePageNumbers: false,
    singleParagraph: false,
  }).text;

  const block = repaired
    .trim()
    .split("\n")
    // A blank line inside the quote becomes a bare ">", not "> ": the trailing
    // space is whitespace the writer never typed, and every Markdown linter in
    // a repository flags it.
    .map((line) => (line.length > 0 ? `> ${line}` : ">"))
    .join("\n");
  return `${block}\n\n[[${paperTitle}]]\n`;
}
