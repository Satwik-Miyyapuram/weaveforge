/**
 * Mermaid fences (```mermaid) rendered to inline SVG, on demand. The library
 * is large, so it loads on the first diagram and never on notes without one.
 * Rendering needs a DOM (mermaid measures text through the browser), so the
 * server and tests get the escaped source back instead.
 */
import type { ColorMode } from "@/lib/shiki-render";

type MermaidModule = typeof import("mermaid")["default"];

let mermaidPromise: Promise<MermaidModule> | null = null;
let initialisedMode: ColorMode | null = null;
let counter = 0;

function getMermaid(mode: ColorMode): Promise<MermaidModule> {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((m) => m.default);
  }
  return mermaidPromise.then((mermaid) => {
    if (initialisedMode !== mode) {
      // `strict` keeps script/click handlers out of the diagram source.
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: mode === "dark" ? "dark" : "default",
        fontFamily: "inherit",
      });
      initialisedMode = mode;
    }
    return mermaid;
  });
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
export async function renderMermaidBlock(code: string, mode: ColorMode): Promise<string> {
  if (typeof document === "undefined") {
    return `<pre class="md-code md-mermaid-source" data-lang="mermaid"><code>${escapeHtml(code)}</code></pre>`;
  }
  try {
    const mermaid = await getMermaid(mode);
    counter += 1;
    const { svg } = await mermaid.render(`wf-mermaid-${counter}`, code.trim());
    return `<div class="md-mermaid">${svg}</div>`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `<pre class="md-code md-mermaid-error" data-lang="mermaid" title="${escapeHtml(message).replace(/"/g, "&quot;")}"><code>${escapeHtml(code)}</code></pre>`;
  }
}

/**
 * Upgrade every `pre[data-lang="mermaid"]` under `root` (as
 * `renderMarkdownPlain` emits them) into a rendered diagram in place.
 */
export async function upgradeMermaidFences(root: HTMLElement, mode: ColorMode): Promise<void> {
  const fences = Array.from(root.querySelectorAll<HTMLPreElement>('pre[data-lang="mermaid"]:not(.md-mermaid-error)'));
  for (const fence of fences) {
    const code = fence.textContent ?? "";
    const html = await renderMermaidBlock(code, mode);
    if (!fence.isConnected) continue;
    const wrapper = document.createElement("div");
    wrapper.innerHTML = html;
    const next = wrapper.firstElementChild;
    if (next) fence.replaceWith(next);
  }
}
