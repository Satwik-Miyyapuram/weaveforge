# UI layers and memory

Each composited layer costs GPU tiles. WebView2 runs a memory-tight app, so keep the layer count low.

## Budgets (WeaveForge Dev, 1440×900, dpr 1.5)

| What | Budget |
| --- | --- |
| Composited layers, reader | ≤ 6 |
| Composited layers, other screens | ≤ 8 |
| Renderer `cc/tile_memory` | < 30 MB |
| GPU `gpu/shared_images` | < 50 MB |
| Dev idle private bytes (WebView2 + shell, no Postgres) | < 220 MB |

Check with Dev running: `node scripts/perf/budget.mjs` (add `--idle` after the app has been idle). It exits 1 and prints one `OVER` line per broken budget. The numbers live in `scripts/lib/ui-budget.mjs`.

## Rules

- No fixed full-window overlays (`position: fixed; inset: 0` with paint, `body::after` effects). Paint effects such as the CRT scanlines as `background-image` on `body`.
- No `mix-blend-mode` or `filter` on anything over a scroller. Each forces its own layer and repaints on scroll.
- Put `contain: paint` on panes that scroll their own content (the reader has it on `.pdf-reader-scroll`). Check that popovers and menus inside still show, since it clips overflow.
- Don't add `isolation: isolate` or `will-change` to make something "faster". Measured, they raised tile memory.
- Canvases off screen get 0×0 so they hold no backing store.
- Menus, dialogs and palettes mount only while open.
- Long lists use `content-visibility: auto` with `contain-intrinsic-size`.

## Finding why something is a layer

Over CDP, `LayerTree.enable` then `LayerTree.compositingReasons` for each layer gives the reason (Overlap, ScrollDependentPosition, ...). An "Overlap" layer means something composited sits under it; fix the one underneath.
