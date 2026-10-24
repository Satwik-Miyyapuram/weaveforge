/**
 * Mermaid fences (```mermaid) rendered to inline SVG with pele, on demand. The
 * renderer loads on the first diagram and never on notes without one. pele
 * measures text itself rather than through the browser, so the same source
 * always gives the same markup, and its colours are CSS variables (`--pele-*`,
 * set from the theme in markdown.css), so a light/dark switch needs no
 * re-render. The server gets the escaped source back; diagrams draw on the
 * client.
 */
import { errorMessage } from "@weaveforge/core";

export type MermaidModule = Pick<typeof import("pele/lazy"), "renderAsync">;

const MAX_CACHE_ENTRIES = 32;
// Bounded LRU cache of rendered diagram markup so route transitions do not re-run layout.
const renderCache = new Map<string, string>();

let customLoader: (() => Promise<MermaidModule>) | null = null;
let mermaidPromise: Promise<MermaidModule> | null = null;

/** @internal for tests */
export function setMermaidLoaderForTests(load: (() => Promise<MermaidModule>) | null): void {
  customLoader = load;
  mermaidPromise = null;
}

/** @internal for tests */
export function mermaidCacheSize(): number {
  return renderCache.size;
}

/** @internal for tests */
export function clearMermaidCache(): void {
  renderCache.clear();
}

/**
 * An id for a diagram from its source, so the same fence renders to the same
 * markup every time. A running counter made each render a different string,
 * which made React rewrite the body — and kill any link mid-click — whenever
 * a note with a diagram re-rendered for a reason that changed nothing.
 */
function diagramId(code: string): string {
  let hash = 0;
  for (let i = 0; i < code.length; i++) hash = (hash * 31 + code.charCodeAt(i)) | 0;
  return `wf-mermaid-${(hash >>> 0).toString(36)}`;
}

/**
 * Mermaid rejects `(`, `)` and `|` inside an unquoted `[label]` or `{label}`,
 * and a note about a VAE writes `Q[q(z|x)]` without thinking twice. Such a
 * label is quoted before it goes to the parser, which is what the author
 * meant; a label already quoted, or a shape whose brackets carry meaning
 * (`[(cylinder)]`, `[[subroutine]]`, `[/parallelogram/]`), is left alone.
 */
export function quoteAwkwardLabels(code: string): string {
  return code.replace(/([[{])([^[\]{}"\n]*?)([\]}])/g, (match, open: string, label: string, close: string) => {
    if (!/[()|]/.test(label) || /^[(/\\]/.test(label) || /[(/\\]$/.test(label)) return match;
    if ((open === "[" && close !== "]") || (open === "{" && close !== "}")) return match;
    return `${open}"${label.replace(/"/g, "#quot;")}"${close}`;
  });
}

function getMermaid(): Promise<MermaidModule> {
  mermaidPromise ??= customLoader ? customLoader() : import("pele/lazy");
  return mermaidPromise;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** True when the fence's info string names a mermaid diagram. */
export function isMermaidFence(info: string): boolean {
  return (info.trim().split(/\s+/)[0] ?? "").toLowerCase() === "mermaid";
}

/**
 * Render a mermaid source to an SVG wrapper. Invalid diagrams come back as
 * the escaped source with an error class rather than throwing, so one bad
 * fence never blanks the whole note.
 */
export async function renderMermaidBlock(code: string): Promise<string> {
  if (typeof document === "undefined") {
    return `<pre class="md-code md-mermaid-source" data-lang="mermaid"><code>${escapeHtml(code)}</code></pre>`;
  }
  const source = quoteAwkwardLabels(code.trim());
  const hit = renderCache.get(source);
  if (hit !== undefined) {
    renderCache.delete(source);
    renderCache.set(source, hit);
    return hit;
  }
  try {
    const pele = await getMermaid();
    const { svg } = await pele.renderAsync(source, { idPrefix: diagramId(source) });
    const html = `<div class="md-mermaid">${svg}</div>`;
    renderCache.set(source, html);
    if (renderCache.size > MAX_CACHE_ENTRIES) {
      const oldest = renderCache.keys().next().value;
      if (oldest !== undefined) renderCache.delete(oldest);
    }
    return html;
  } catch (error) {
    const message = errorMessage(error);
    // The message is shown, not tucked into a tooltip: a diagram that comes
    // back as its own source with nothing said looks like a renderer that
    // did not run, when it is a typo on line 3.
    return `<div class="md-mermaid md-mermaid-error"><pre class="md-code" data-lang="mermaid"><code>${escapeHtml(code)}</code></pre><p class="md-mermaid-message">Mermaid: ${escapeHtml(message)}</p></div>`;
  }
}

/**
 * Upgrade every `pre[data-lang="mermaid"]` under `root` (as
 * `renderMarkdownPlain` emits them) into a rendered diagram in place.
 */
export async function upgradeMermaidFences(root: HTMLElement): Promise<void> {
  const fences = Array.from(root.querySelectorAll<HTMLPreElement>('pre[data-lang="mermaid"]:not(.md-mermaid-error > pre)'));
  for (const fence of fences) {
    const code = fence.textContent ?? "";
    const html = await renderMermaidBlock(code);
    if (!fence.isConnected) continue;
    const wrapper = document.createElement("div");
    wrapper.innerHTML = html;
    const next = wrapper.firstElementChild;
    if (next) fence.replaceWith(next);
  }
}
