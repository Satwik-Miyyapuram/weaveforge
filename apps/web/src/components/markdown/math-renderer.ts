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
