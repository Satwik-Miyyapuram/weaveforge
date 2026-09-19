import type { TextSelectionRange } from "@weaveforge/core";

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
 *
 * The text layer's spans are decorated: a citation mention becomes an anchor,
 * so one span can hold several text nodes and the node's own offset no longer
 * says where in the item it starts. Every piece therefore carries `data-from`
 * / `data-to` — its item-local bounds — and the offset is read from those. The
 * reading is what keeps a selection that crosses a citation honest: the words
 * are the same text nodes they always were, so the browser selects them as
 * usual, and this maps the endpoints back onto the item.
 */
export function selectionRangeFromDom(
  selection: Selection | null,
  textLayer: Element,
): TextSelectionRange | null {
  if (!selection || selection.isCollapsed || selection.rangeCount < 1) return null;
  const range = selection.getRangeAt(0);
  if (!textLayer.contains(range.commonAncestorContainer)) return null;

  const start = offsetInTextLayer(range.startContainer, range.startOffset, textLayer, "start");
  const end = offsetInTextLayer(range.endContainer, range.endOffset, textLayer, "end");
  if (!start || !end) return null;
  return textSelectionFromOffsets(start, end);
}

/** The decorated piece a node belongs to: its bounds and its item. */
function pieceOf(node: Node, textLayer: Element): { span: HTMLElement; from: number; to: number } | null {
  let cur: Node | null = node;
  while (cur && cur !== textLayer) {
    if (cur instanceof HTMLElement && cur.hasAttribute("data-item-index")) {
      const from = Number(cur.dataset.from);
      const to = Number(cur.dataset.to);
      return {
        span: cur,
        from: Number.isFinite(from) ? from : 0,
        to: Number.isFinite(to) ? to : (cur.textContent?.length ?? 0),
      };
    }
    cur = cur.parentElement;
  }
  return null;
}

function offsetInTextLayer(
  node: Node,
  offset: number,
  textLayer: Element,
  edge: "start" | "end",
): ItemTextOffset | null {
  const piece = pieceOf(node, textLayer);
  if (!piece) return null;
  const raw = piece.span.getAttribute("data-item-index");
  if (raw == null) return null;
  const itemIndex = Number(raw);
  if (!Number.isInteger(itemIndex) || itemIndex < 0) return null;

  if (node.nodeType === Node.TEXT_NODE && node.parentElement === piece.span) {
    // A plain, undecorated span: the offset is into the item as written.
    const from = piece.span.dataset.from ? piece.from : 0;
    return { itemIndex, offset: from + Math.max(0, offset) };
  }

  if (node === piece.span) {
    // Between two pieces: an offset of `n` means the selection starts after the
    // first `n` child pieces, so it begins at the n-th piece's first character.
    const children = [...piece.span.childNodes];
    let chars = 0;
    for (let i = 0; i < offset && i < children.length; i++) {
      chars += children[i]!.textContent?.length ?? 0;
    }
    return { itemIndex, offset: piece.from + chars };
  }

  // Inside a decorated anchor: walk up to the anchor and use its own bounds.
  let anchor: Node | null = node;
  while (anchor && anchor !== piece.span) {
    if (anchor instanceof HTMLElement && anchor.hasAttribute("data-from")) {
      const from = Number(anchor.dataset.from);
      const base = Number.isFinite(from) ? from : piece.from;
      return { itemIndex, offset: base + Math.max(0, offset) };
    }
    anchor = anchor.parentElement;
  }
  return { itemIndex, offset: edge === "end" ? piece.to : piece.from };
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
