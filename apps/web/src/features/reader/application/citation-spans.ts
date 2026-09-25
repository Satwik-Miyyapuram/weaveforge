/**
 * Citation underlines, painted *in* the text layer rather than over it.
 *
 * Ported from the reader implementation in `extra stuff to add/` that gets this
 * right. The previous approach measured a mention's geometry and absolutely
 * positioned a box above the page, which was wrong twice over: the box was a
 * guess at where the text was, and being a sibling it sat over the text rather
 * than in it — so a selection crossing a citation could not see the words, and
 * a one-character error in the guess moved the rule off the words it named.
 *
 * Here the text layer's own spans are rewritten: each item's span is split at
 * the mention boundaries that fall inside it and the covered pieces become
 * anchors. The text itself never moves — `span.replaceChildren` keeps the
 * span's font, ascent and transform — so the rule is under the glyphs by
 * construction, and because the anchor *is* the text, selection and copy work
 * across it.
 *
 * `data-from` / `data-to` are the item-local offsets of each piece. They are
 * what makes a selection readable afterwards: a span may now hold several text
 * nodes, so the DOM no longer tells you where in the item a node starts.
 */

import type { PageTextItem } from "@weaveforge/core";

/**
 * The part of a mention this module needs: where it is on the page and what to
 * call it. Kept structural so the decorator does not depend on the reader's
 * `MentionHit`, and the reader does not depend on this.
 */
export interface CiteSpan {
  key: string;
  start: number;
  end: number;
  text?: string;
  label?: string;
}

export interface TextSegment {
  from: number;
  to: number;
  text: string;
  mention?: CiteSpan;
}

interface ItemRange {
  itemIndex: number;
  from: number;
  to: number;
}

/**
 * Map a mention's page offsets onto the runs it covers.
 *
 * The page text is items concatenated with a newline after each `hasEOL` item,
 * which is the convention every offset in the analysis uses.
 */
export function mentionItemRanges(
  items: readonly PageTextItem[],
  start: number,
  end: number,
): ItemRange[] {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
  const ranges: ItemRange[] = [];
  let cursor = 0;
  items.forEach((item, itemIndex) => {
    const from = cursor;
    const to = from + item.str.length;
    cursor = to + (item.hasEOL ? 1 : 0);
    if (to <= start || from >= end || !item.str.length) return;
    ranges.push({
      itemIndex,
      from: Math.max(0, start - from),
      to: Math.min(item.str.length, end - from),
    });
  });
  return ranges;
}

/** Split one item's text at every mention boundary that falls inside it. */
export function planCitationSegments(
  items: readonly PageTextItem[],
  mentions: readonly CiteSpan[],
): TextSegment[][] {
  const byItem = new Map<number, { from: number; to: number; mention: CiteSpan }[]>();
  const length = items.reduce((total, item) => total + item.str.length + (item.hasEOL ? 1 : 0), 0);
  for (const mention of mentions) {
    if (
      !Number.isInteger(mention.start) ||
      !Number.isInteger(mention.end) ||
      mention.start < 0 ||
      mention.end > length
    ) {
      continue;
    }
    for (const range of mentionItemRanges(items, mention.start, mention.end)) {
      const list = byItem.get(range.itemIndex) ?? [];
      list.push({ ...range, mention });
      byItem.set(range.itemIndex, list);
    }
  }
  return items.map((item, itemIndex) => {
    const ranges = (byItem.get(itemIndex) ?? []).sort(
      (a, b) => a.from - b.from || b.to - a.to,
    );
    const boundaries = [
      ...new Set([0, item.str.length, ...ranges.flatMap((range) => [range.from, range.to])]),
    ].sort((a, b) => a - b);
    const segments: TextSegment[] = [];
    for (let i = 1; i < boundaries.length; i++) {
      const from = boundaries[i - 1]!;
      const to = boundaries[i]!;
      if (to <= from) continue;
      const mention = ranges.find((range) => range.from <= from && range.to >= to)?.mention;
      const previous = segments[segments.length - 1];
      if (previous && previous.mention?.key === mention?.key) {
        previous.to = to;
        previous.text += item.str.slice(from, to);
      } else {
        segments.push({ from, to, text: item.str.slice(from, to), ...(mention ? { mention } : {}) });
      }
    }
    return segments;
  });
}

/**
 * Rewrite the text layer's spans so each citation mention is an anchor.
 *
 * Returns how many anchors were made. Throws if rewriting a span changed its
 * text, which would mean the segments disagree with the item they came from —
 * worse than not decorating at all, since the page would then show something
 * other than the document.
 */
export function decorateCitationSpans(
  textDivs: readonly HTMLElement[],
  items: readonly PageTextItem[],
  mentions: readonly CiteSpan[],
): number {
  const plan = planCitationSegments(items, mentions);
  const focused = new Set<string>();
  let count = 0;
  plan.forEach((segments, index) => {
    const span = textDivs[index];
    if (!span) return;
    const fragment = document.createDocumentFragment();
    for (const segment of segments) {
      if (!segment.mention) {
        fragment.append(document.createTextNode(segment.text));
        continue;
      }
      const anchor = document.createElement("a");
      anchor.href = "#citation-details";
      anchor.className = "pdf-reader-cite";
      anchor.dataset.mentionKey = segment.mention.key;
      anchor.dataset.from = String(segment.from);
      anchor.dataset.to = String(segment.to);
      anchor.textContent = segment.text;
      anchor.title = segment.mention.label || segment.mention.text || segment.text;
      anchor.setAttribute("aria-label", `Reference: ${segment.mention.label || segment.text}`);
      anchor.tabIndex = focused.has(segment.mention.key) ? -1 : 0;
      focused.add(segment.mention.key);
      fragment.append(anchor);
      count++;
    }
    // Only the contents change. PDF.js's own font, ascent and transform live on
    // the span, so replacing them would move the text.
    span.replaceChildren(fragment);
    if (span.textContent !== items[index]!.str) {
      throw new Error(`Text changed while linking item ${index}`);
    }
  });
  return count;
}

/** Mark which mention is open or hovered, for the highlight. */
export function setActiveCitation(container: HTMLElement, key: string | null, hover = false): void {
  for (const anchor of container.querySelectorAll<HTMLAnchorElement>("a[data-mention-key]")) {
    anchor.classList.toggle(hover ? "is-hovered" : "is-open", anchor.dataset.mentionKey === key);
  }
}
