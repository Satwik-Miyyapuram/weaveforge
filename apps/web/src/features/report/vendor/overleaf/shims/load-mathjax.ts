import { loadMathRenderer, type MathRenderer } from "@/components/markdown/math-renderer";

/**
 * The slice of MathJax that Overleaf's visual widgets call, done with KaTeX.
 * Macros from the preamble (`\newcommand`) persist across calls through one
 * shared `macros` object, as `globalGroup` lets KaTeX write into it.
 */
export interface MathJaxLike {
  texReset: (args?: unknown) => void;
  tex2svgPromise: (tex: string, options?: { display?: boolean }) => Promise<HTMLElement>;
  getMetricsFor: (element: HTMLElement, display: boolean) => Record<string, never>;
  typesetPromise: (elements: HTMLElement[]) => Promise<void>;
  typesetClear: (elements: HTMLElement[]) => void;
}

type KatexRender = (tex: string, options: Record<string, unknown>) => string;

const macros: Record<string, string> = {};

function render(katex: MathRenderer, tex: string, display: boolean): string {
  return (katex.renderToString as unknown as KatexRender)(tex, {
    displayMode: display,
    throwOnError: false,
    trust: false,
    globalGroup: true,
    macros,
  });
}

/** `$…$`, `\(…\)`, `$$…$$` and `\[…\]` inside plain text, as in a theorem name or title. */
const INLINE_MATH = /\$\$([^$]+)\$\$|\\\[([\s\S]+?)\\\]|\$((?:\\.|[^$\\])+)\$|\\\(([\s\S]+?)\\\)/g;

function typesetText(katex: MathRenderer, node: Text) {
  const text = node.data;
  INLINE_MATH.lastIndex = 0;
  if (!INLINE_MATH.test(text)) return;
  INLINE_MATH.lastIndex = 0;
  const frag = document.createDocumentFragment();
  let at = 0;
  for (const m of text.matchAll(INLINE_MATH)) {
    frag.append(text.slice(at, m.index));
    const span = document.createElement("span");
    const display = m[1] !== undefined || m[2] !== undefined;
    span.innerHTML = render(katex, (m[1] ?? m[2] ?? m[3] ?? m[4])!, display);
    frag.append(span);
    at = m.index + m[0].length;
  }
  frag.append(text.slice(at));
  node.replaceWith(frag);
}

let instance: Promise<MathJaxLike> | null = null;

export function loadMathJax(): Promise<MathJaxLike> {
  instance ??= loadMathRenderer().then((katex) => ({
    texReset: () => {},
    tex2svgPromise: async (tex, options) => {
      const el = document.createElement(options?.display ? "div" : "span");
      el.innerHTML = render(katex, tex, options?.display ?? false);
      return el;
    },
    getMetricsFor: () => ({}),
    typesetPromise: async (elements) => {
      for (const root of elements) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        const texts: Text[] = [];
        while (walker.nextNode()) texts.push(walker.currentNode as Text);
        for (const t of texts) typesetText(katex, t);
      }
    },
    typesetClear: () => {},
  }));
  return instance;
}
