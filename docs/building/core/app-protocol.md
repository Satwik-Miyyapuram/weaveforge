# app:// protocol rules

Rust port of the pure rules in `apps/shell/sidecar/src/app-protocol.ts`.

- Rust: `crates/wf-core/src/app_protocol.rs`. Tests: `crates/wf-core/tests/app_protocol.rs`.
- wasm: `crates/wf-wasm/src/app_protocol.rs` exports `appFileCandidates`, `appCanonicalUrl`, `appIsPageRequest`, `appHeaders`, `appContentTypeFor`.
- No TS wrapper: typed by the wasm package's generated declarations (`rust()` in `packages/core/src/shared/rust.ts`).
- Shim: `apps/shell/sidecar/src/app-protocol.ts`. It keeps the `APP_SCHEME`, `APP_HOST` and `APP_ORIGIN` constants, and checks each candidate on disk with `isFile`.

## What Rust decides

- **Candidates** (`app_file_candidates`): the request path is percent-decoded and joined under `root`. A `..` that would leave the root is refused, and so is a malformed escape. A path ending in `/` gives only `index.html`. Any other path gives, in order, the file, `file.html`, `file/index.html` and the Next segment-prefetch file (`__next.a.b.txt` becomes `__next.a/b.txt`). `root` must have no trailing separator.
- **Canonical URL** (`app_canonical_url`): repeated path slashes are collapsed. The query and fragment are left alone. `null` means no redirect.
- **Page or asset** (`app_is_page_request`): a request is a page when its last segment has no dot, or ends in `.html`.
- **Content type** (`app_content_type_for`): by extension. Unknown is `application/octet-stream`. `.map` is served as JSON.
- **Headers** (`app_headers`): `content-type`, `x-content-type-options: nosniff` and `referrer-policy: strict-origin-when-cross-origin`. The CSP is added only when the content type starts with `text/html`.

## What stays in TS

- The disk check. `resolveAppFile` takes the candidates from Rust and returns the first one `isFile` accepts. `isFile` must answer for files only, because a folder handed to the protocol fetch throws instead of returning 404.
- The Electron protocol handler and the file reads.

## The CSP

The web build's policy, plus what only the desktop reaches: the weights host, the Cache API, local model servers on loopback, and workers built from blobs. Two entries exist because of the same mistake made twice, and both cost a long detour to find.

- **`app:`** in `connect-src`. `'self'` is `app://weaveforge`, and the encoder's weights are served from `app://models`, a different origin. Without this the page cannot fetch a model file. The failure shows as transformers.js's `Bad gateway error occurred while trying to load file: "app://models/…/config.json"`, which names this app's own proxy and so points at the handler rather than at the policy. `apps/web/next.config.mjs` carries `app://models` for the same reason. The browser build never reaches this host, which is why the scheme appears only here. The policy was not the only gate: `app:` is not a CORS-enabled scheme, so Chromium blocked the cross-origin fetch anyway. The renderer now asks for `app://weaveforge/models/…`, same-origin, which the shell maps onto the same cache (`modelCacheUrl`). `app:` stays for the other `app:` hosts.
- **`cache:`** in `connect-src`. Electron's Cache API, which Transformers.js uses to store model files. A Cache API lookup is subject to `connect-src`, and a refused one rejects rather than returning a miss, so the library received a rejection where it expected a `Response`.
- **`app://artifacts`** in `img-src` shows SDK uploads kept on this disk.
- **`blob:`** in `frame-src` shows the Overleaf Workshop's compiled PDF.

Both scheme entries are schemes rather than wildcards: `app:` still confines the policy to the app's own protocol, and `cache:` is the whole of what the Cache API needs.

## Known limits

- `\` counts as a path separator on every platform, which is stricter than POSIX Node.
- The `root` passed to `appFileCandidates` must already be normalised, with no trailing separator.

## Tests

`crates/wf-core/tests/app_protocol.rs` ports the 19 cases of `apps/shell/sidecar/test/app-protocol.test.ts`, plus cases for an encoded separator, `%FF`, `%ZZ`, and a Windows-style root. The TS test file still needs wasm preloaded (`test/preload-rust.ts`), or the coordinator retires it.
