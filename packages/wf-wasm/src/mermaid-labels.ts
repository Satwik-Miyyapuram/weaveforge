import { quoteAwkwardMermaidLabels as rawQuoteAwkwardMermaidLabels } from "../pkg/wf_wasm.js";

/** Quotes Mermaid labels that hold `(`, `)` or `|` (Rust `markdown_mermaid_labels`). */
export function quoteAwkwardMermaidLabels(code: string): string {
  return rawQuoteAwkwardMermaidLabels(code);
}
