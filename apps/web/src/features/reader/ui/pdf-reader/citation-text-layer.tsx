"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PageTextItem } from "@weaveforge/core";
import { decorateCitationSpans, setActiveCitation, type CiteSpan } from "../../application/citation-spans";
import type { MentionHit } from "../../application/reader-references";

export type { MentionHit };

interface CitationTextLayerProps {
  mentions: readonly MentionHit[];
  /** The page's runs, in the order the mention offsets were built from. */
  items: readonly PageTextItem[];
  /**
   * A mention was activated. The anchor's box is passed so the popover can sit
   * against the words rather than at the page origin.
   */
  onOpen: (hit: MentionHit, anchor: DOMRect | null) => void;
  onPrefetch?: (hit: MentionHit) => void;
  /** The mention whose popover is open, for the highlight. */
  selectedKey?: string | null;
}

/**
 * Citation underlines, written into the page's text layer.
 *
 * This used to be an absolutely-positioned overlay: a box per mention, placed
 * from measured geometry, floating above the page. That was wrong in a way no
 * amount of geometry tuning fixes — the box was a *second* rendering of where
 * the words were, so it could disagree with the words, and being a sibling it
 * sat over the text rather than in it, which broke selection across a citation
 * and put the rule wherever the estimate landed.
 *
 * The text layer's own spans are rewritten instead: each span is split at the
 * mention boundaries inside it and the covered pieces become anchors. The text
 * never moves — only the span's contents change, so PDF.js's own font, ascent
 * and transform stay on the element — which is why the underline is under the
 * glyphs by construction, and why selecting across one still copies the
 * citation. See `citation-spans.ts` for the algorithm and `dom-selection-range`
 * for how a decorated span still reports offsets.
 */
export function CitationTextLayer({
  mentions,
  items,
  onOpen,
  onPrefetch,
  selectedKey = null,
}: CitationTextLayerProps) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const current = useRef({ mentions, items, onOpen, onPrefetch });
  current.current = { mentions, items, onOpen, onPrefetch };

  // A zero-size marker inside the page, purely to reach the page's *row*. This
  // component owns no visible DOM of its own: the underline is the text's own
  // decoration, so there is nothing to position.
  //
  // The row, not the page: `usePdfRendering` builds the text layer and appends
  // it to the `[data-page]` element, beside the page rather than inside it. A
  // click on an anchor therefore never reaches the page, and a listener there
  // heard nothing. The row holds one page, so nothing else's layer is caught.
  const attach = useCallback((element: HTMLElement | null) => {
    const page = element?.closest<HTMLElement>(".pdf-reader-page") ?? null;
    setHost(page?.closest<HTMLElement>(".pdf-reader-page-row") ?? page);
  }, []);

  const textLayerOf = useCallback((row: HTMLElement | null): HTMLElement | null => {
    return row?.querySelector<HTMLElement>(".pdf-reader-textlayer") ?? null;
  }, []);

  // Decoration is a layout-time concern: it changes what is painted, and doing
  // it after paint would flash an undecorated page.
  useLayoutEffect(() => {
    if (!host) return;
    const row = host;
    /**
     * Decorating *is* a DOM mutation, and the observer watches for DOM
     * mutations — so without this the two feed each other and spin. The flag is
     * cleared on the next frame rather than synchronously: the observer's own
     * callbacks are delivered as a microtask, after the code that made the
     * change.
     */
    let decorating = false;
    let idle = 0;

    const decorate = () => {
      if (decorating) return;
      // Re-found every time: a page's text layer is rebuilt by clearing its
      // element and refilling it, and the `[data-page]` host itself can be
      // replaced. Holding the element captured at mount meant observing a
      // container that had been emptied and never refilled — so the pages whose
      // layer was built after this mounted kept no underline.
      const layer = textLayerOf(host);
      if (!layer) return;
      // Keyed by item index, with holes: pdf.js keeps a div for every run but
      // only attaches the ones with text, so a run whose string is empty has
      // no span here. Counting the spans against the runs would call every
      // page with such a run stale.
      const ordered: HTMLElement[] = [];
      for (const span of layer.querySelectorAll<HTMLElement>("span[data-item-index]")) {
        const index = Number(span.dataset.itemIndex);
        if (Number.isInteger(index) && index >= 0) ordered[index] = span;
      }
      if (!ordered.length) return;
      const { mentions: hits, items: runs } = current.current;
      // A stale text layer (more runs than the analysis knows) must not be rewritten.
      if (ordered.length > runs.length) return;
      decorating = true;
      try {
        decorateCitationSpans(ordered, runs, hits as unknown as CiteSpan[]);
      } catch {
        // The analysis and the text layer disagree about this page. Leaving it
        // undecorated shows the document as printed; guessing would not.
      } finally {
        idle = window.setTimeout(() => {
          decorating = false;
        }, 0);
      }
    };

    decorate();
    if (typeof MutationObserver === "undefined") return;
    // Watching the row, in subtree, so a rebuilt — or a newly built — text layer
    // is seen either way. The item index is watched too: pdf.js appends the
    // spans first and the renderer numbers them once the layout is done, and
    // it is the numbering, not the append, that makes the layer decoratable.
    const observer = new MutationObserver(decorate);
    observer.observe(row, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-item-index"],
    });
    return () => {
      observer.disconnect();
      window.clearTimeout(idle);
    };
  }, [host, mentions, items, textLayerOf]);

  // Click and hover, on the page host so the anchors stay plain text nodes.
  useEffect(() => {
    const page = host;
    if (!page) return;
    const anchorOf = (target: EventTarget | null): HTMLAnchorElement | null =>
      target instanceof Element ? target.closest<HTMLAnchorElement>("a.pdf-reader-cite") : null;

    const click = (event: MouseEvent) => {
      const anchor = anchorOf(event.target);
      if (!anchor) return;
      const key = anchor.dataset.mentionKey;
      const hit = current.current.mentions.find((candidate) => candidate.key === key);
      if (!hit) return;
      // A click that ends a text selection is a selection, not a citation open.
      const selection = window.getSelection();
      if (event.detail > 0 && selection && !selection.isCollapsed) return;
      event.preventDefault();
      current.current.onOpen(hit, anchor.getBoundingClientRect());
    };
    const over = (event: PointerEvent) => {
      const anchor = anchorOf(event.target);
      if (!anchor) return;
      const hit = current.current.mentions.find((candidate) => candidate.key === anchor.dataset.mentionKey);
      if (hit) current.current.onPrefetch?.(hit);
      setActiveCitation(host, anchor.dataset.mentionKey ?? null, true);
    };
    const leave = () => setActiveCitation(host, null, true);

    host.addEventListener("click", click);
    host.addEventListener("pointerover", over);
    host.addEventListener("pointerleave", leave);
    return () => {
      host.removeEventListener("click", click);
      host.removeEventListener("pointerover", over);
      host.removeEventListener("pointerleave", leave);
    };
  }, [host]);

  useEffect(() => {
    if (host) setActiveCitation(host, selectedKey);
  }, [host, selectedKey, mentions]);

  // The marker is invisible and inert: it exists only so this component can
  // find the page it belongs to. Everything the reader sees is the text layer's
  // own decoration.
  return <i ref={attach} className="pdf-reader-cite-marker" aria-hidden="true" />;
}
