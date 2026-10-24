/** Words in plain text: runs of non-whitespace. The paper summary cap and report progress both count this way. */
export function countWords(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}
