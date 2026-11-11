# local_api_guard

Rust home: `crates/wf-core/src/local_api_guard.rs`.

## What it owns

- `is_loopback_host(host, port)`: the `Host` header names this machine on `port`, as `127.0.0.1:{port}`, `localhost:{port}` or `[::1]:{port}`. The header is trimmed and lowercased first. Anything else, including a missing header, is not loopback. This is the DNS-rebinding guard.
- `bearer_token(header)`: the credential after `Bearer `, or `None` when the header is missing, is not a Bearer header, or the credential is empty or contains a line break (`\n`, `\r`, `\u2028`, `\u2029`).
- `is_legacy_token_hex(stored)`: exactly 64 characters, all `0-9` or `a-f`. Such a value is a pre-hash plaintext token that the caller rewrites.

## Where it is called

- wasm exports `isLoopbackHost`, `bearerToken` and `isLegacyTokenHex` in `crates/wf-wasm/src/local_api_guard.rs`.
- Wrapper `packages/wf-wasm/src/wrappers-9.ts`, typed through `rust()` in `packages/core/src/shared/rust.ts`.
- `apps/shell/sidecar/src/local-api-server.ts`: `isLoopbackHost` and the legacy check in `parseLocalApiTokens`.
- `apps/shell/sidecar/src/local-api.ts`: the credential parse in `tokenMatches` and `grantPermissions`.

## What stays in TS

- Token hashing (`hashLocalApiToken`) and token creation (`newLocalApiToken`), both on `node:crypto`.
- The constant-time compare (`timingSafeEqual`) and the sha256 grant lookup. The Rust side only extracts the credential.
- The HTTP server, socket, and the `LOCAL_API_PORT` value.
