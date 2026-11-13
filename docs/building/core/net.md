# Net core module

The `net` module holds the pure checks that guard outbound and inbound network
use: whether a host is private, whether a URL is a public HTTPS address, which
hosts count as the API, which external links may open, where a model download
goes, and how a page's title is read. It makes no requests. The app asks the
question, makes the request or does not, and handles the answer.

## What lives in Rust

Each file under `crates/wf-core/src/net/` covers one job:

- `mod.rs`: registers the submodules and states that the module holds pure network helpers.
- `private_host.rs`: decides whether a host is private, and whether a URL is a public HTTPS address.
- `url_safety.rs`: the address and URL-shape checks, such as the IP address and IPv6 rules, and `rejection_copy`, the sentence shown for each refused-URL reason (moved from the old TypeScript rejection-copy table).
- `api_host.rs`: decides whether a host is the app's API host.
- `open_external.rs`: decides whether a link may open outside the app.
- `model_cache.rs`: decides which request is a model-weights request, and the cache path segments.
- `semantic_scholar_relay.rs`: the upstream address for a Semantic Scholar relay path.
- `page_title.rs`: reads a page's title out of its HTML and decodes HTML entities.
- `image_url.rs`: decides whether a URL looks like an image.

## How the app calls it

The wasm exports live in `crates/wf-wasm/src` (for example `net_private_host.rs`,
`url_safety.rs`, `net_api_host.rs`, `net_open_external.rs`,
`net_model_cache.rs` and `net_semantic_scholar_relay.rs`). The TypeScript
wrappers in `packages/wf-wasm/src` import the raw names from
`../pkg/wf_wasm.js` and re-export them. The main names are:

- Hosts and addresses: `isPrivateHost`, `isPublicHttpsUrl`, `isApiHost`, `checkUrlShape`, `isIpAddress`, `isPublicAddress`, `expandIpv6`.
- Refusal copy: `describeUrlRejection(reason)`, which takes a reason code such as `"scheme"` and returns the sentence for it.
- Links and images: `mayOpenExternally`, `looksLikeImageUrl`.
- Model cache: `modelCacheUrl`, `cachePathSegments`.
- Relay: `semanticScholarTarget`.

`page_title.rs` and `image_url.rs` have no `js_name` of their own. The ink
engine's title code in `ink_engine_title.rs` calls `page_title` from Rust. Code
in `apps/web` reads the exported names
through `readyCore()` or `typedCore()` from `apps/web/src/lib/rust-core.ts`, or
through the wrappers in `packages/wf-wasm`. The desktop app imports the wasm
directly. `readyCore()` throws until `loadCore()` has resolved, so call it only
after the core has loaded.

## What stays in TypeScript, and why

- **Requests and proxies.** The HTTP calls, the proxy and the model downloads
  stay in TypeScript and the desktop app. Rust answers whether a request may
  go; it sends nothing.
- **Desktop shell.** The `app://` relays that wrap these checks now live in Rust, in
  `apps/relay/wf-relay/src/relay/` (`shared.rs` and the per-route modules), not in the
  retired Electron main process.
- **Opening links.** The desktop shell opens the link. Rust only decides whether
  it may open (`mayOpenExternally`).
- **Caching on disk.** Writing model files and reading the cache directory stay in
  the desktop app. Rust gives the cache path segments and the URL.
- **Orchestration.** Choosing when to call a relay, when to retry and what to show
  on failure stay in TypeScript use cases.
- **Thin wrappers.** The files in `packages/wf-wasm/src` (for example
  `net-private-host.ts` and `url-safety.ts`) only forward to the raw exports, so
  they keep no rules of their own.

Source: `crates/wf-core/src/net/`

## More net modules

| Module | Rust fn | wasm export | TS caller |
| --- | --- | --- | --- |
| `paste_content` | `paste_image_type`, `is_html_content_type` | `pasteImageType`, `isPasteHtmlContentType` | `apps/web/src/backend/net/fetch-for-paste.ts` |
| `redirect` | `next_redirect`, `declared_length_over_cap` | `nextRedirect`, `declaredLengthOverCap` | `apps/web/src/backend/net/safe-fetch.ts` |
| `semantic_scholar_retry` | `should_retry`, `retry_wait_ms` | `semanticScholarShouldRetry`, `semanticScholarRetryWaitMs` | `apps/web/src/lib/semantic-scholar-fetch.ts` |

Rules:

- `paste_content`: only PNG, JPEG, GIF, WebP, AVIF, BMP and TIFF pass, by the header type without parameters. SVG is refused, not sniffed, because it can carry script.
- `paste_content`: a body is read for a title only when its header starts with `text/html` or `application/xhtml`, case-insensitively.
- `redirect`: a status outside 300 to 399 is not a redirect. A redirect with no `location`, or with an unresolved one, fails with a message. Once the hop count reaches `max_redirects`, the next redirect fails.
- `redirect`: `declared_length_over_cap` refuses only a finite length above the cap. The byte count is still capped while reading.
- `semantic_scholar_retry`: retries a 429 or a network error (no status), up to `RETRIES` (3) times. Waits are 1 s, 2 s, then 3 s. `RETRIES` is not exported.
