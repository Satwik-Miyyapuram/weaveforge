/**
 * KaTeX, loaded only by the surfaces that actually contain maths.
 *
 * The renderer used to import KaTeX at module scope, so every route whose screens
 * render markdown carried it in first-load JS: six routes, and the chunk is
 * **75 KB gzipped** — by itself about a sixth of `/papers` (483 KB) and `/report`
 * (475 KB). Nobody was choosing that; it followed from one static import.
 *
 * Two properties make the split work:
 *
 *   * `renderProseMarkdown` is synchronous and stays synchronous. A pending
 *     renderer emits a placeholder holding the escaped TeX — which is also what a
 *     reader sees if the chunk never arrives — and the caller re-renders once
 *     `load()` resolves. No async render pipeline, no change to the string
 *     contract the four screens depend on.
 *   * `contains()` decides whether to load at all. `$` in prose is common enough
 *     (prices, shell variables) but the check is on the delimiters the renderer
 *     itself recognises, so a note without maths never fetches the chunk.
 *
 * `import("katex")` is the whole mechanism: a static import is what put it in
 * first-load JS, and a dynamic one is what takes it out.
 */

/** The slice of KaTeX this codebase uses. */
export interface MathRenderer {
  renderToString: (
    source: string,
    options: { displayMode: boolean; throwOnError: boolean; trust: boolean; macros: Record<string, string> },
  ) => string;
}

let loaded: MathRenderer | null = null;
let inFlight: Promise<MathRenderer> | null = null;

/** The renderer if it is already in memory, else null. Never triggers a load. */
export function loadedMathRenderer(): MathRenderer | null {
  return loaded;
}

/** Load KaTeX once, however many callers ask. */
export function loadMathRenderer(): Promise<MathRenderer> {
  inFlight ??= import("katex").then((module) => {
    loaded = { renderToString: module.renderToString as MathRenderer["renderToString"] };
    return loaded;
  });
  return inFlight;
}

/**
 * A test seam: put a renderer in place without loading the real one.
 *
 * Used by the tests that assert *what* is rendered for maths; the loading
 * behaviour is asserted separately, on `contains` and on the placeholder.
 */
export function setMathRendererForTest(renderer: MathRenderer | null): void {
  loaded = renderer;
  inFlight = renderer ? Promise.resolve(renderer) : null;
}

/**
 * Whether this text has anything the renderer would treat as maths.
 *
 * Mirrors the delimiters `renderProseMarkdown` recognises: `$$…$$`, a single-line
 * `$…$`, and a backslash-escaped `$` is not a delimiter. Deliberately
 * conservative — a false positive costs a 75 KB fetch, a false negative costs the
 * reader their formula — so an unclosed `$` counts, and the renderer decides what
 * to do with it.
 */
export function containsMath(md: string): boolean {
  let index = 0;
  while (index < md.length) {
    const dollar = md.indexOf("$", index);
    if (dollar === -1) return false;
    // `\$` is a literal dollar sign, not a delimiter.
    if (dollar > 0 && md[dollar - 1] === "\\") {
      index = dollar + 1;
      continue;
    }
    return true;
  }
  return false;
}

/**
 * What to show while the renderer is loading, or forever if it never loads.
 *
 * The TeX itself, escaped and in a span that says what it is: a reader with no
 * KaTeX sees the formula the author wrote rather than an empty box, and the
 * re-render replaces this node wholesale.
 */
export function mathPlaceholder(source: string, displayMode: boolean, escape: (text: string) => string): string {
  const tag = displayMode ? "div" : "span";
  return `<${tag} class="math-pending" data-tex="${escape(source).replace(/"/g, "&quot;")}">${escape(source)}</${tag}>`;
}
