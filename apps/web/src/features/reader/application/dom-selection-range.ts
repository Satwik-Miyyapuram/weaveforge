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

function resolveTargetNode(
  node: Node,
  offset: number,
  textLayer: Element,
  edge: "start" | "end",
): { node: Node; offset: number } {
  if (node === textLayer) {
    const children = textLayer.querySelectorAll<HTMLElement>("span[data-item-index]");
    if (children.length === 0) return { node, offset };
    if (edge === "start") {
      const idx = Math.min(Math.max(0, offset), children.length - 1);
      const child = children[idx]!;
      return { node: child, offset: 0 };
    } else {
      const idx = Math.max(0, Math.min(offset > 0 ? offset - 1 : 0, children.length - 1));
      const child = children[idx]!;
      return { node: child, offset: child.childNodes.length };
    }
  }
  return { node, offset };
}

function offsetInTextLayer(
  rawNode: Node,
  rawOffset: number,
  textLayer: Element,
  edge: "start" | "end",
): ItemTextOffset | null {
  const { node, offset } = resolveTargetNode(rawNode, rawOffset, textLayer, edge);
  const piece = pieceOf(node, textLayer);
  if (!piece) return null;
  const raw = piece.span.getAttribute("data-item-index");
  if (raw == null) return null;
  const itemIndex = Number(raw);
  if (!Number.isInteger(itemIndex) || itemIndex < 0) return null;

  // 1. Exact measurement using DOM Range in browser environments
  if (typeof document !== "undefined" && typeof document.createRange === "function") {
    try {
      const subRange = document.createRange();
      subRange.selectNodeContents(piece.span);
      const maxOffset =
        node.nodeType === Node.TEXT_NODE
          ? (node.textContent?.length ?? 0)
          : node.childNodes.length;
      subRange.setEnd(node, Math.min(Math.max(0, offset), maxOffset));
      const charOffset = subRange.toString().length;
      const base = piece.span.dataset.from ? piece.from : 0;
      return { itemIndex, offset: base + charOffset };
    } catch {
      // Fall through to manual offset calculation if Range throws
    }
  }

  // 2. Tree-traversal fallback: sum preceding text node lengths inside piece.span
  let offsetInSpan = 0;
  function traverse(n: Node): boolean {
    if (n === node) {
      if (n.nodeType === Node.TEXT_NODE) {
        offsetInSpan += Math.min(Math.max(0, offset), n.textContent?.length ?? 0);
      } else {
        const children = [...n.childNodes];
        for (let i = 0; i < offset && i < children.length; i++) {
          offsetInSpan += children[i]!.textContent?.length ?? 0;
        }
      }
      return true;
    }
    if (n.nodeType === Node.TEXT_NODE) {
      offsetInSpan += n.textContent?.length ?? 0;
      return false;
    }
    for (const child of n.childNodes) {
      if (traverse(child)) return true;
    }
    return false;
  }

  if (traverse(piece.span)) {
    const base = piece.span.dataset.from ? piece.from : 0;
    return { itemIndex, offset: base + offsetInSpan };
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
