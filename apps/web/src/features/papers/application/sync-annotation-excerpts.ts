/**
 * Clipboard representation shared by paper annotation cards and the report
 * section pane. Annotation persistence now lives on paper metadata; this file
 * intentionally contains no vault-note synchronization.
 */
export function formatQuoteCiteClipboard(quote: string, paperTitle: string): string {
  const block = quote
    .trim()
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
  return `${block}\n\n[[${paperTitle}]]\n`;
}
