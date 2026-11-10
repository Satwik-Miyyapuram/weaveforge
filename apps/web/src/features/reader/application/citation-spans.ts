/**
 * Citation underlines, painted *in* the text layer rather than over it.
 *
 * The previous approach measured a mention's geometry and absolutely
 * positioned a box above the page, which was wrong twice over: the box was a
 * guess at where the text was, and being a sibling it sat over the text rather
 * than in it.
 *
 * Here the text layer's own spans are rewritten: each item's span is split at
 * the mention boundaries that fall inside it and the covered pieces become
 * anchors. The text itself never moves, so the rule is under the glyphs by
 * construction. The segment planning is pure and lives in the Rust core
 * (`planCitationSegments`); this module only paints the DOM.
 */

import type { CiteSpan, PageTextItem } from "@weaveforge/wasm";
import { readyCore } from "@/lib/rust-core";

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
  const plan = readyCore().planCitationSegments(items, mentions);
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
      const isUrl = segment.mention.kind === "url" || Boolean(segment.mention.url);
      const isFigure = segment.mention.kind === "figure";

      if (isUrl && segment.mention.url) {
        anchor.href = segment.mention.url;
        anchor.target = "_blank";
        anchor.rel = "noopener noreferrer";
        anchor.className = "pdf-reader-cite pdf-reader-external-link";
        anchor.title = `Open ${segment.mention.url}`;
        anchor.setAttribute("aria-label", `Link: ${segment.mention.url}`);
      } else {
        anchor.href = "#citation-details";
        anchor.className = `pdf-reader-cite${isFigure ? " is-figure-jump" : ""}`;
        anchor.title = segment.mention.label || segment.mention.text || segment.text;
        anchor.setAttribute(
          "aria-label",
          isFigure
            ? `Jump to: ${segment.mention.label || segment.text}`
            : `Reference: ${segment.mention.label || segment.text}`,
        );
      }
      anchor.dataset.mentionKey = segment.mention.key;
      anchor.dataset.from = String(segment.from);
      anchor.dataset.to = String(segment.to);
      anchor.textContent = segment.text;
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
