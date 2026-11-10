# Paste core

The paste core cleans text on its way into a note. It strips tracking from links, repairs text copied out of a PDF, rejoins wrapped lines, and turns a spreadsheet paste into a table.

## What lives in Rust

The module is `wf_core::paste`. Its `mod.rs` says it holds "the rules the old TypeScript paste module applied to clipboard text".

Each file below owns one part:

- `clean_pasted_text`: the paste pipeline that runs the rules in order.
- `control_characters`: escape sequences and control characters that survive a copy.
- `markdown_link`: the bare-URL check, label escaping and `[label](url)` for pasted links. See [markdown_link](markdown_link.md).
- `markdown_ranges`: the parts of a Markdown document that are syntax, data or verbatim.
- `paste_settings`: what the pipeline may do, per user.
- `pdf_text`: repairs text copied out of a PDF.
- `quote_commas`: comma placement next to a closing quotation mark.
- `scholarly_links`: makes a pasted identifier resolvable.
- `tabular_text`: turns a spreadsheet paste into a Markdown table.
- `text_range`: spans of text a cleanup rule must not touch.
- `tracking_parameters`: query parameters that identify the reader, not the page.
- `typography`: character-level cleanups for pasted prose.
- `url_cleanup`: strips tracking from links in a paste.
- `wrapped_text`: puts hard-wrapped text back together.

Offsets in this module are byte offsets. The wasm layer converts the UTF-16 offset from the editor. Lengths use `crate::search::js_text::utf16_len`.

## How the app calls it

The app reaches the core through `readyCore()` from `@/lib/rust-core`. The wasm exports live in `crates/wf-wasm/src/paste.rs`. `packages/wf-wasm/src/paste-text.ts` wraps them.

The exports the app calls:

- `cleanPastedText`: the automatic paste rules.
- `pasteLandsInVerbatimContext`: whether the caret sits in a code block or frontmatter.
- `cleanWrappedText`: rejoins terminal output on demand.
- `cleanPdfText`: repairs PDF text on demand.
- `applyCommaPlacement`: moves commas to one side of a closing quote.
- `tabSeparatedToMarkdownTable`: builds a table from tab-separated text.

Other exports include `cleanUrlsWithRules`, `defaultPasteSettings`, `normalizePasteSettings` and `parseLinkRemovalText`.

The main call site is `apps/web/src/components/markdown/markdown-paste-cleanup.ts`. Its header says "all the judgement lives in the Rust core (`wf_core::paste`)".

## What stays in TypeScript, and why

The editor wiring stays in TypeScript. `markdown-paste-cleanup.ts` decides whether a paste is eligible, reads the clipboard event, and applies the result to CodeMirror.

It applies a cleaned paste as one transaction, so one Ctrl+Z takes the whole paste back. Rust returns text, and TypeScript decides what to do with it. CodeMirror transactions and DOM clipboard events exist only in the browser.

Remote lookups stay in TypeScript too. A pasted address can have its title read or its picture downloaded through `markdown-remote-paste`. That needs the network and the editor, so Rust does not do it.

`cleanPdfText` is reached only through `readyCore()`; no caller imports it from the TypeScript core any more.

Source: `crates/wf-core/src/paste/`
