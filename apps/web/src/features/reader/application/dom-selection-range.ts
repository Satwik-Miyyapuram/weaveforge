import type { TextSelectionRange } from "@thesis/core";

export interface ItemTextOffset {
  itemIndex: number;
  offset: number;
}

/** Build a TextSelectionRange from two item offsets; returns null if empty. */
export function textSelectionFromOffsets(
  start: ItemTextOffset,
  end: ItemTextOffset,
): TextSelectionRange | null {
  if (
    !Number.isInteger(start.itemIndex) ||
    !Number.isInteger(end.itemIndex) ||
    start.itemIndex < 0 ||
    end.itemIndex < 0 ||
    start.offset < 0 ||
    end.offset < 0
  ) {
    return null;
  }
  if (start.itemIndex === end.itemIndex && start.offset === end.offset) return null;
  return {
    startItemIndex: start.itemIndex,
    startOffset: start.offset,
    endItemIndex: end.itemIndex,
    endOffset: end.offset,
  };
}

/**
 * Map a DOM Selection inside a `.pdf-reader-textlayer` to item/offset indices.
 * Spans must carry `data-item-index` matching PageTextGeometry.items order.
 */
export function selectionRangeFromDom(
  selection: Selection | null,
  textLayer: Element,
): TextSelectionRange | null {
  if (!selection || selection.isCollapsed || selection.rangeCount < 1) return null;
  const range = selection.getRangeAt(0);
  if (!textLayer.contains(range.commonAncestorContainer)) return null;

  const start = offsetInTextLayer(range.startContainer, range.startOffset, textLayer);
  const end = offsetInTextLayer(range.endContainer, range.endOffset, textLayer);
  if (!start || !end) return null;
  return textSelectionFromOffsets(start, end);
}

function offsetInTextLayer(
  node: Node,
  offset: number,
  textLayer: Element,
): ItemTextOffset | null {
  const span = nearestItemSpan(node, textLayer);
  if (!span) return null;
  const raw = span.getAttribute("data-item-index");
  if (raw == null) return null;
  const itemIndex = Number(raw);
  if (!Number.isInteger(itemIndex) || itemIndex < 0) return null;

  if (node === span || span.contains(node)) {
    if (node.nodeType === Node.TEXT_NODE) {
      return { itemIndex, offset: Math.max(0, offset) };
    }
    let chars = 0;
    const kids = node.childNodes;
    for (let i = 0; i < offset && i < kids.length; i++) {
      chars += kids[i]!.textContent?.length ?? 0;
    }
    return { itemIndex, offset: chars };
  }
  return { itemIndex, offset: 0 };
}

function nearestItemSpan(node: Node, textLayer: Element): HTMLElement | null {
  let cur: Node | null = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
  while (cur && cur !== textLayer) {
    if (cur instanceof HTMLElement && cur.hasAttribute("data-item-index")) return cur;
    cur = cur.parentElement;
  }
  return null;
}

/** Resolve which page host owns the selection (1-based page number). */
export function pageNumberFromSelection(
  selection: Selection | null,
  scrollRoot: Element,
): number | null {
  if (!selection || selection.rangeCount < 1) return null;
  const node = selection.getRangeAt(0).commonAncestorContainer;
  const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  const host = el?.closest?.("[data-page]");
  if (!host || !scrollRoot.contains(host)) return null;
  const n = Number((host as HTMLElement).dataset.page);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Parse `data-page` from a page host element. */
export function pageNumberFromHost(host: { dataset?: DOMStringMap | { page?: string } } | null): number | null {
  if (!host?.dataset) return null;
  const n = Number(host.dataset.page);
  return Number.isInteger(n) && n > 0 ? n : null;
}
