# Production bundle baseline

Measured with `npm run build --workspace @weaveforge/web` on 2026-07-14.

- Shared first-load JavaScript: **89.6 kB**
- Largest route first-load bundles: papers **552 kB**, notes **551 kB**, dashboard **511 kB**, graph **510 kB**
- Heavy runtimes already deferred: uPlot, force graph, CodeMirror, Shiki language/theme loading, collaboration editor, and full crypto container after disclaimer acceptance.

The remaining route size is primarily feature code and encrypted-client dependencies. The service worker intentionally caches only immutable `/_next/static/` chunks. It does not cache HTML, API responses, signed URLs, encrypted blobs, or decrypted content, so offline caching cannot become a plaintext or stale-data channel.
