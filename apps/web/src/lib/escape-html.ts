/**
 * Text made safe inside HTML or XML markup: the four characters that would
 * otherwise open a tag, an entity or close an attribute. One copy, shared by
 * everything that builds markup as a string (the markdown renderer, the SVG
 * and the print documents).
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
