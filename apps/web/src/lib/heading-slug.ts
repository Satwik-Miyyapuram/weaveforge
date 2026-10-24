/**
 * The anchor id for a heading: lowercased, every run of non-letters and
 * non-digits one hyphen, both ends trimmed. The read view writes it as the
 * heading's id and the outline links to it, so saved `[[Note#Heading]]` links
 * depend on it staying exactly this.
 */
export function headingSlug(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}
