# Relays (`wf-relay`, `wf-relay-server`)

The relay has two members of the root Cargo workspace. reqwest and tokio bring duplicate crate versions, so the relay's `cargo-deny` bans are in `apps/relay/deny.toml`.

| Crate | Path | Purpose |
| --- | --- | --- |
| `wf-relay` | `apps/relay/wf-relay` | The fetches a browser page cannot make itself (papers, pages, APIs), and pasted-link fetches. Shared by [`apps/shell`](shell.md) and the server, so both run one copy of the URL safety checks. |
| `wf-relay-server` | `apps/relay/server` | The relay server on OCI, behind Caddy at `/relay/*`. It also serves the SDK, org, blob, settings, account, admin, Overleaf, Zotero and MCP relay routes under `/api/*`. |

- `wf-relay` modules: `fetch` (page titles, paste, remote fetch, URL safety and shape), `relay` (arXiv, Semantic Scholar, PDF, HTML, blob, account, Overleaf, routes) and `tls`.
- TLS: desktops and the server use `native-tls`. Phones use `rustls` with `webpki-root-certs` (`apps/relay/wf-relay/src/tls.rs`).
- Feature `specta` on `wf-relay`: TypeScript types for the title and image fetch replies. The shell turns it on.
- `wf-relay-server` uses `axum`, `tower-http`, `reqwest` and [`wf-core`](wf-core.md). `src/main.rs` reads the environment, binds, and serves until Ctrl-C.
- Image: `apps/relay/Dockerfile`.
- Tests: `apps/relay/wf-relay/tests/` (only `common/`) and `apps/relay/server/tests/` (one file per module).

Source: `apps/relay/wf-relay/src/`, `apps/relay/server/src/`
