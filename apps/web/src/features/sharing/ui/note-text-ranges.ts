import type { TextSpan } from "../domain/text-anchor";

/**
 * DOM helpers for comment anchors: mapping between character offsets in the
 * rendered note text and DOM ranges, and lighting passages with the CSS Custom
 * Highlight API. Nothing here writes into the note's DOM, which React owns.
 */

export const HL = "wf-comment";
export const HL_ACTIVE = "wf-comment-active";

/** Where a span starts and ends, as [text node index, offset within it]. */
export interface SpanPoints {
  start: [number, number];
  end: [number, number];
}

/**
 * Locate `span` across text nodes of the given lengths, or null when the text
 * is shorter than the span (it has moved on). A boundary that falls between two
 * nodes lands at the end of the earlier one, as the DOM walk always did.
 */
export function spanPoints(lengths: readonly number[], span: TextSpan): SpanPoints | null {
  let seen = 0;
  let start: [number, number] | null = null;
  for (let i = 0; i < lengths.length; i++) {
    const len = lengths[i] ?? 0;
    if (!start && span.start <= seen + len) start = [i, span.start - seen];
    if (start && span.end <= seen + len) return { start, end: [i, span.end - seen] };
    seen += len;
  }
  return null;
}

/** Character offset of a DOM point within `root`'s text. */
export function offsetOf(root: Node, node: Node, offset: number): number {
  const range = document.createRange();
  range.selectNodeContents(root);
  range.setEnd(node, offset);
  return range.toString().length;
}

/** A DOM range over `span` of `root`'s text, or null when the text has moved on. */
export function rangeAt(root: Node, span: TextSpan): Range | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Node[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n);
  const points = spanPoints(nodes.map((n) => n.nodeValue?.length ?? 0), span);
  if (!points) return null;
  const startNode = nodes[points.start[0]];
  const endNode = nodes[points.end[0]];
  if (!startNode || !endNode) return null;
  const range = document.createRange();
  range.setStart(startNode, points.start[1]);
  range.setEnd(endNode, points.end[1]);
  return range;
}

/**
 * Light `spans` in `root`, the `activeId` one more strongly. Returns the
 * cleanup, or undefined where the Highlight API is missing (threads still work;
 * they just aren't lit). A null root clears both highlights while mounted.
 */
export function paintHighlights(
  root: Node | null,
  spans: readonly { id: string; span: TextSpan | null }[],
  activeId: string | null,
): (() => void) | undefined {
  const reg = typeof CSS !== "undefined" ? (CSS as unknown as { highlights?: Map<string, unknown> }).highlights : undefined;
  const HighlightCtor = (globalThis as { Highlight?: new (...r: Range[]) => unknown }).Highlight;
  if (!reg || !HighlightCtor) return undefined;
  const all: Range[] = [];
  const active: Range[] = [];
  if (root) {
    for (const { id, span } of spans) {
      if (!span) continue;
      const range = rangeAt(root, span);
      if (range) (id === activeId ? active : all).push(range);
    }
  }
  reg.set(HL, new HighlightCtor(...all));
  reg.set(HL_ACTIVE, new HighlightCtor(...active));
  return () => {
    reg.delete(HL);
    reg.delete(HL_ACTIVE);
  };
}
