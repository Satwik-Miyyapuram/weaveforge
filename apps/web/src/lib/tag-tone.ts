/** Six tag colours per theme (`--tag-N-*`); a tag keeps its slot everywhere. */
const TAG_TONES = 6;

export function tagTone(tag: string): number {
  let h = 0;
  for (const ch of tag.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (h % TAG_TONES) + 1;
}
