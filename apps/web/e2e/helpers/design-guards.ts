import type { Page } from "@playwright/test";

/**
 * The two design guards that need a laid-out page (design D20, R9):
 *
 * - G5, targets: anything you can press is at least 24px each way, and 44px in
 *   a reader toolbar under a finger. A link inside a sentence is exempt, as
 *   WCAG 2.5.8 exempts it.
 * - G6, overflow: no text is cut off without an ellipsis, and the page itself
 *   never scrolls sideways.
 *
 * Each returns what it found, so a failing spec names the element instead of
 * printing a count.
 */

export const TARGET_MIN = 24;
export const READER_TOOLBAR_MIN = 44;

const PRESSABLE = [
  "button",
  "a[href]",
  "summary",
  "select",
  "textarea",
  "input:not([type=hidden])",
  "[role=button]",
  "[role=tab]",
  "[role=menuitem]",
  "[role=checkbox]",
  "[role=switch]",
  "[role=option]",
].join(",");

// Surfaces that draw their own content: the text editor, canvases, the ink
// layer and the PDF page. Their insides are not app chrome.
const DRAWN = ".cm-editor, canvas, svg, [class*=ink-canvas], [class*=pdf-reader-page]";

/** G5: pressable things smaller than their bar, as "label WxH (min N)". */
export function smallTargets(page: Page): Promise<string[]> {
  return page.evaluate(
    ({ pressable, drawn, min, readerMin }) => {
      const coarse = matchMedia("(pointer: coarse)").matches;
      const out: string[] = [];
      for (const el of document.querySelectorAll<HTMLElement>(pressable)) {
        if (el.closest(drawn) && !el.closest("[role=toolbar]")) continue;
        const style = getComputedStyle(el);
        if (style.visibility !== "visible" || el.closest("[inert], [aria-hidden=true]")) continue;
        // A checkbox or radio is pressed through its label.
        const box = (el instanceof HTMLInputElement && /checkbox|radio/.test(el.type) && el.closest("label")) || el;
        const r = box.getBoundingClientRect();
        // Not on screen, or a screen-reader-only control (1px, clipped).
        if (r.width <= 1 || r.height <= 1 || r.bottom <= 0 || r.right <= 0) continue;
        if (r.top >= innerHeight || r.left >= innerWidth) continue;
        // WCAG 2.5.8: a link in a line of text is exempt.
        if (el.tagName === "A" && style.display === "inline") continue;
        const reader = coarse && el.closest("[role=toolbar]")?.closest(".reader-screen, [class*=reader]");
        const bar = reader ? readerMin : min;
        if (r.width + 0.5 < bar || r.height + 0.5 < bar) {
          const label = (el.getAttribute("aria-label") || el.textContent || el.tagName).trim().slice(0, 40);
          out.push(`${label} ${Math.round(r.width)}x${Math.round(r.height)} (min ${bar})`);
        }
      }
      return out;
    },
    { pressable: PRESSABLE, drawn: DRAWN, min: TARGET_MIN, readerMin: READER_TOOLBAR_MIN },
  );
}

/** G6: text cut off without an ellipsis or line clamp, as "class: text". */
export function clippedText(page: Page): Promise<string[]> {
  return page.evaluate((drawn) => {
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>("body *")) {
      if (!el.offsetParent || el.closest(drawn)) continue;
      const own = [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim());
      if (!own) continue;
      const s = getComputedStyle(el);
      if (!/hidden|clip/.test(s.overflowX) || el.scrollWidth <= el.clientWidth + 1) continue;
      if (s.textOverflow === "ellipsis" || s.webkitLineClamp !== "none") continue;
      const name = el.className.toString() || el.tagName;
      out.push(`${name.slice(0, 40)}: ${el.textContent!.trim().slice(0, 40)}`);
    }
    return out;
  }, DRAWN);
}

/** G6: how far the page scrolls sideways (0 when it does not). */
export function sidewaysScroll(page: Page): Promise<number> {
  return page.evaluate(() => {
    const doc = document.scrollingElement ?? document.documentElement;
    return Math.max(0, doc.scrollWidth - innerWidth);
  });
}
