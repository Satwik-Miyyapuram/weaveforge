# WeaveForge — design foundations (light)

This is a **foundations-only** design system: the design tokens of the default
light theme. There is no bundled component library here — the app's components
(cards, dropdowns, pills, buttons, nav) are styled entirely by these tokens, so
build on-brand by using the tokens below with your own markup.

## Styling idiom: CSS variables

Every color, radius, and shadow is a CSS custom property on `:root`. **Reference
`var(--token)` — never hard-code hex.** The truth lives in
`tokens/light.css` (imported by `styles.css`); read it before styling.

### Token vocabulary

Core: `--bg` (app background), `--surface` (cards), `--ink` (primary text),
`--muted` (secondary text), `--line` (borders), `--accent` (sage brand),
`--accent-ink` (text on accent), `--clay` (secondary accent), `--danger`.

Surfaces: `--input-bg`, `--pill`, `--hover`, `--chip`, `--neutral`,
`--nav-bg`, `--active-bg` / `--active-fg` (active nav).

Status families (semantic state → a bg+fg pair): `--st-neutral-bg/-fg`,
`--st-positive-bg/-fg`, `--st-info-bg/-fg`, `--st-warn-bg/-fg`,
`--st-danger-bg/-fg`. Use a pair together for a status pill.

Radii: `--radius` (16px, cards), `--radius-sm` (10px, inputs). Pills use
`999px`. Type: `--font` (system sans stack). Elevation: `--shadow`.

## Idioms

- **Card**: `background: var(--surface); border: 1px solid var(--line);
  border-radius: var(--radius); box-shadow: var(--shadow); padding: 16px;`
- **Primary button**: `background: var(--accent); color: #fff;
  border-radius: 999px; padding: 10px 18px; font-weight: 600;`
- **Secondary button**: `background: var(--hover); color: var(--accent-ink);`
- **Status pill**: `background: var(--st-<family>-bg);
  color: var(--st-<family>-fg); border-radius: 999px; padding: 4px 12px;`
- **Muted/meta text**: `color: var(--muted)` (already AA-contrast on `--bg`).

## Build snippet

```html
<article style="background:var(--surface);border:1px solid var(--line);
  border-radius:var(--radius);box-shadow:var(--shadow);padding:16px;
  font-family:var(--font);color:var(--ink)">
  <h3 style="margin:0 0 6px;letter-spacing:-0.01em">Title</h3>
  <p style="margin:0;color:var(--muted);font-size:0.9rem">Supporting copy.</p>
  <span style="display:inline-block;margin-top:10px;padding:4px 12px;
    border-radius:999px;font-size:0.72rem;
    background:var(--st-positive-bg);color:var(--st-positive-fg)">reading</span>
</article>
```

The system also ships dark and Catppuccin/AMOLED themes; this foundation covers
the default light theme only. To theme, override the same variables under a
`[data-theme="…"]` selector — the token names never change.
