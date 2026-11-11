# URL meta core module

`crates/wf-core/src/papers/url_meta.rs` holds the pure rules behind reading a
paper from a web address in the desktop shell. The HTTP fetch and the HTML parse
stay in TypeScript.

## What lives in Rust

- `shell_target(value)`: the address the shell relay fetches. A value that already
  has a scheme (`^[a-z][a-z0-9+.-]*:`, ASCII case-insensitive) is kept as is.
  Otherwise `https://` is prefixed.
- `read_failure_message(status, detail)`: the error text for a failed relay read.
  - 415: the not-a-web-page message, ending with `…`, plus ` (detail)` when detail is set.
  - 400: the detail if set, else "That address cannot be fetched. Use an https link."
  - 403: the refused-site message, plus ` (detail)` when detail is set.
  - Other statuses: "Could not read that page: detail." when detail is set, else
    "Could not read that page (N)."

## How the app calls it

- `wf-wasm` exports `urlMetaShellTarget` and `urlMetaReadFailureMessage`
  (`crates/wf-wasm/src/url_meta.rs`). The prefix avoids name collisions.
- `packages/wf-wasm/src/wrappers-9.ts` wraps them, re-exported from `modules.ts`
  and `feature-wrappers.ts`.
- `apps/web/src/features/papers/infrastructure/url-metadata-source.ts`
  (`readInShell`) calls `loadCore()` and uses both functions. The relay's `error`
  is still trimmed and cut to 200 characters in TypeScript before it reaches Rust.

## Parity notes

- The scheme check accepts any `word:` prefix, so `localhost:8080/x` keeps its
  value unchanged, as the TypeScript regex did before.
- The 200-character cut is applied in UTF-16 units in TypeScript, not in Rust.
