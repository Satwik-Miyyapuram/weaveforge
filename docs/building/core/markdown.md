# Markdown input rules (wf-core `markdown_input`)

Pure text rules the markdown editor and renderer share, ported from
`apps/web/src/components/markdown/markdown-editor-extensions.ts`,
`math-renderer.ts` and `apps/web/src/lib/mermaid-render.ts`. Renderer calls,
CodeMirror wiring, DOM and keymaps stay in TypeScript.

## Modules

| Rust module | What it does |
| --- | --- |
| `markdown_input::cite_links` | `finished_links` (the `[[link]]` targets the caret has left), `matching_completions` (cite menu filter, at most 20, returns indices) |
| `markdown_input::math_input` | `contains_math`: whether the renderer would treat the text as maths (`$` not escaped by `\`, `\(`, `\[`) |
| `markdown_input::mermaid_source` | `render_source` (JS trim, then label quoting), `diagram_id` (31-hash over UTF-16 code units, base36, `wf-mermaid-` prefix) |

## Wasm exports

| Export | Rust wrapper | Replaces |
| --- | --- | --- |
| `finishedLinks(doc, caret)` | `wf-wasm/src/markdown_input_cite_links.rs` | TS `finishedLinks`; caret `-1` means no focus |
| `filterCiteCompletions(items, query)` | same file | TS `filterCompletions`; returns indices, callers map back to objects |
| `containsMath(md)` | `wf-wasm/src/markdown_input_math.rs` | TS `containsMath` |
| `mermaidRenderSource(code)` | `wf-wasm/src/markdown_input_mermaid.rs` | trim step of `renderMermaidBlock` |
| `mermaidDiagramId(source)` | same file | TS `diagramId` |

Caret positions and link indices are UTF-16 offsets, as CodeMirror reports them.

## Tests

The four TS cases that covered these functions moved to Rust
(`// it: ported` in the Rust source). `markdown-typed-links.test.ts` was
deleted; its two cases now live in `cite_links.rs`. `mermaid-cache.test.ts`
loads the core in a `before` hook.

## GAPs (not moved)

- GAP: `insertForCompletion` template literal stays in TS (CodeMirror insert text).
- GAP: `AT_BOUNDARY` regex stays in TS (used only by the CodeMirror decoration path).
- GAP: `themePeleSvg` stays in TS (operates on the pele SVG DOM output).
- GAP: `mathPlaceholder` stays in TS (depends on the escape callback and the DOM class contract).
- GAP: the math loader and KaTeX renderer calls (`import("katex")`) stay in TS by design.
- GAP: the mermaid renderer call (`pele/lazy`) stays in TS by design.
- GAP: lowercase Unicode caveat: the TS filter used `toLowerCase`; Rust uses `to_lowercase` on the same strings, which can differ for a few special-casing code points.

## Markdown input (`markdown_input`)

| Module | Rust fn | wasm export | TS caller |
| --- | --- | --- | --- |
| `markdown_input` (`mod.rs`) | — (declares `cite_links`, `math_input`, `mermaid_source`) | native only | — |
| `math_input` | `contains_math` | `containsMath` | `apps/web/src/components/markdown/markdown.tsx`, `apps/web/src/features/ink/ui/ink-sheet-underlay.tsx`, `apps/web/src/features/ink/ui/use-page-export.ts` |
| `mermaid_source` | `render_source`, `diagram_id` | `mermaidRenderSource`, `mermaidDiagramId` | `apps/web/src/lib/mermaid-render.ts` |

Rules:

- `markdown_input` (`mod.rs`): string rules only. CodeMirror, the DOM and the renderers stay in TS.
- `math_input`: a `$` is a delimiter unless backslash-escaped; `\(` and `\[` also count. An unclosed `$` counts.
- `mermaid_source`: `render_source` JS-trims, then quotes awkward labels. `diagram_id` is a 31-hash over UTF-16 code units, base 36, with the `wf-mermaid-` prefix.
