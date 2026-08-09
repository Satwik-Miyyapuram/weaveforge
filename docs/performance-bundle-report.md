# Production bundle baseline

Measured with `npm run build --workspace @weaveforge/web` on 2026-07-14.

- Shared first-load JavaScript: **89.6 kB**
- Largest route first-load bundles: papers **552 kB**, notes **551 kB**, dashboard **511 kB**, graph **510 kB**
- Heavy runtimes already deferred: uPlot, force graph, CodeMirror, Shiki language/theme loading, collaboration editor, and full crypto container after disclaimer acceptance.

## The lazy boundary that leaked (2026-08-09)

"CodeMirror already deferred" was true of the *component* and false of the
route. `/notes` shipped **217 kB** of route JavaScript against `/log`'s 9 kB,
though both render the same lazily-loaded collaborative editor. The difference:
`vault-screen` built the editor's extension array itself and passed it down as
`extraExtensions`, which is a value import of `@codemirror/*` — plus
`@codemirror/language-data` — in a screen module. Webpack cannot defer what a
screen imports at module scope, so every reader who opened a note downloaded the
whole editor before deciding whether to edit.

The fix moves the construction inside `CollabBodyHost`, which is already behind
a `dynamic()` boundary, and gives it a data-shaped `markdownEditing` prop
(placeholder, titles, completions, citation format) so screens name what they
want instead of building it.

| | route JS | first load |
|---|---|---|
| `/notes` before | 217 kB | 623 kB |
| `/notes` after | **7.83 kB** | **411 kB** |

No other route moved. The lesson generalises: *a `dynamic()` import only defers
the module it names.* If a screen also imports the heavy library to construct
arguments for that component, the boundary is decorative — check the route's own
size against a comparable route, not the presence of a lazy wrapper.

The remaining route size is primarily feature code and encrypted-client dependencies. The service worker intentionally caches only immutable `/_next/static/` chunks. It does not cache HTML, API responses, signed URLs, encrypted blobs, or decrypted content, so offline caching cannot become a plaintext or stale-data channel.
