/**
 * Splitting a document into passages an encoder can actually read.
 *
 * Sentence encoders truncate at a few hundred tokens. Feeding a whole note to
 * one does not fail loudly — it silently embeds the first paragraph and throws
 * the rest away, so a workspace looks indexed while most of it is not
 * searchable. Chunking is what makes the vector half honest.
 *
 * Boundaries are chosen by structure first (blank lines, then sentences, then
 * whitespace) because a passage cut mid-sentence embeds to a worse vector than
 * one that ends where a thought does.
 */

export interface TextChunk {
  text: string;
  /** Offset in the source, so a hit can point at the passage it matched. */
  start: number;
  end: number;
}

export interface ChunkOptions {
  /**
   * Characters per passage. Roughly four per token, so 1 000 sits under the
   * 256-token window the small sentence encoders use.
   */
  maxChars?: number;
  /**
   * Characters repeated between neighbours, so a sentence spanning a boundary
   * lands whole in one of them.
   */
  overlapChars?: number;
  /** Below this a trailing fragment is merged back rather than embedded alone. */
  minChars?: number;
}

const DEFAULTS = { maxChars: 1_000, overlapChars: 120, minChars: 80 } as const;

/** Last structural boundary in `text` at or before `limit`, or -1. */
function boundaryBefore(text: string, from: number, limit: number): number {
  for (const pattern of [/\n\s*\n/g, /(?<=[.!?])\s/g, /\s/g]) {
    let best = -1;
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const at = match.index + match[0].length;
      if (at <= from) continue;
      if (at > limit) break;
      best = at;
    }
    // A boundary is only useful if it leaves a passage worth embedding.
    if (best > from + DEFAULTS.minChars) return best;
  }
  return -1;
}

/**
 * Split text into overlapping passages.
 *
 * Text short enough to fit is returned as one chunk rather than padded or
 * split — the common case for a note is a single passage, and paying for the
 * boundary search there would be waste.
 */
export function chunkForEmbedding(text: string, options: ChunkOptions = {}): TextChunk[] {
  const maxChars = options.maxChars ?? DEFAULTS.maxChars;
  const overlapChars = options.overlapChars ?? DEFAULTS.overlapChars;
  const minChars = options.minChars ?? DEFAULTS.minChars;

  const trimmed = text.trim();
  if (trimmed === "") return [];
  if (trimmed.length <= maxChars) return [{ text: trimmed, start: 0, end: trimmed.length }];

  const chunks: TextChunk[] = [];
  let start = 0;

  while (start < trimmed.length) {
    const hardEnd = Math.min(start + maxChars, trimmed.length);
    const end =
      hardEnd === trimmed.length ? hardEnd : (boundaryBefore(trimmed, start, hardEnd) ?? -1);
    const cut = end > start ? end : hardEnd;

    const slice = trimmed.slice(start, cut).trim();
    if (slice) chunks.push({ text: slice, start, end: cut });

    if (cut >= trimmed.length) break;
    // Step back by the overlap, but never far enough to repeat a whole chunk —
    // that would loop forever on text with no boundaries.
    start = Math.max(cut - overlapChars, start + 1);
  }

  // A final scrap carries no meaning on its own; fold it into its neighbour.
  const last = chunks[chunks.length - 1];
  if (chunks.length > 1 && last && last.text.length < minChars) {
    const previous = chunks[chunks.length - 2]!;
    chunks.splice(chunks.length - 2, 2, {
      text: `${previous.text} ${last.text}`.trim(),
      start: previous.start,
      end: last.end,
    });
  }

  return chunks;
}
