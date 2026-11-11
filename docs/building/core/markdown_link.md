# Markdown link helpers

The helpers behind pasting a URL into a note: whether the paste is one bare address, how a selection becomes a link label, and building `[label](url)`.

## What lives in Rust

The module is `wf_core::paste::markdown_link` in `crates/wf-core/src/paste/markdown_link.rs`. It has four functions:

- `is_bare_url`: one `http://` or `https://` address with no whitespace. Replaces the TypeScript `BARE_URL` regex.
- `escape_link_label`: backslashes `\`, `[` and `]` in a label.
- `markdown_link`: `[label](url)`, with CR/LF runs folded to one space, then escaped and trimmed.
- `link_label`: the escaped label for a selection, or `None` when the selection is empty or spans lines.

Whitespace follows JavaScript (`\S` and `trim`), using `crate::search::js_text::is_js_whitespace`.

## How the app calls it

The wasm exports are `isBareUrl`, `escapeLinkLabel`, `markdownLink` and `linkLabel` in `crates/wf-wasm/src/paste.rs`. The typed wrappers are in `packages/wf-wasm/src/wrappers-5.ts`. The app reaches them through `readyCore()` from `@/lib/rust-core`.

`linkLabel` returns `null` for "no label". The wasm side returns `undefined`, and the wrapper maps it to `null`.

Callers:

- `apps/web/src/components/markdown/markdown-paste-cleanup.ts`: `isBareUrl` decides whether a cleaned paste is a link, and `linkLabel` labels each selection range.
- `apps/web/src/components/markdown/markdown-remote-paste.ts`: `isBareUrl` gates the title and image lookups, and `markdownLink` writes the title link once it is read.

## What stays in TypeScript, and why

The paste handler, the CodeMirror transactions and the title or image fetches stay in TypeScript. They need the editor and the network, so Rust does not do them.

`nameFromUrl` in `markdown-remote-paste.ts` stays TypeScript. It is URL parsing for a picture's filename and is not part of this port.

Source: `crates/wf-core/src/paste/markdown_link.rs`
