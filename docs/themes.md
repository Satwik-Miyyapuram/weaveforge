# Theming Architecture

WeaveForge uses a pure CSS-variable theming system to maintain high performance without JavaScript layout thrashing. All colors in the app are controlled through semantic design tokens.

## How it works

1. **Tokens**: All colors are defined in `apps/web/src/app/themes.css`. No hardcoded hex values exist in `globals.css` or component files.
2. **Dual Mode**: The app tracks two distinct states:
   - `data-mode`: `"light"` or `"dark"`.
   - `data-theme`: The specific palette applied to that mode (e.g., `"mocha"`, `"amoled"`, `"latte"`).
3. **No-Flash Boot**: `layout.tsx` contains an inline `<script>` that reads `localStorage` before the DOM parses, instantly applying the correct `data-mode` and `data-theme` to the `<html>` root. This prevents any white-flash on load.

## Adding a New Theme

A theme sets **source tokens**. It must not set the aliases at the top of
`themes.css` (`--ink`, `--line`, `--pill`, `--chip`, `--panel`, `--accent-ink`,
…) — those are defined once on `:root` as `var()` indirections onto the source
tokens and are theme-agnostic by design. Overriding an alias in a theme block
sets the derived value while leaving its source unset, which is how you get a
theme that looks right in some components and unstyled in others.

1. **Define the source tokens.** Every one of these, or the theme inherits a
   value from the default palette and mismatches itself:

   ```css
   [data-theme="nord"] {
     --bg: #2e3440;          /* page root */
     --surface: #3b4252;     /* cards, modals */
     --surface2: #434c5e;    /* recessed rows, chips, pills */
     --elev: #434c5e;        /* raised panels, inputs */
     --border: #4c566a;
     --border-strong: #5b6982;
     --text: #eceff4;
     --muted: #d8dee9;       /* secondary text */
     --faint: #a9b3c4;       /* tertiary text */
     --accent: #88c0d0;
     --accent-fg: #2e3440;   /* text ON an accent fill */
     --accent-soft: #434c5e; /* hover / active wash */

     /* Status pairs — foreground colour and its background wash. */
     --s-neutral: #81a1c1;  --s-neutral-bg: #3b4252;
     --s-info: #88c0d0;     --s-info-bg: #3b4252;
     --s-good: #a3be8c;     --s-good-bg: #3b4252;
     --s-warn: #ebcb8b;     --s-warn-bg: #3b4252;
     --s-danger: #bf616a;   --s-danger-bg: #3b4252;
     --s-mute: #6c7a94;     --s-mute-bg: #3b4252;

     --sel-ring: rgba(236, 239, 244, 0.16);
     --shadow: 0 1px 2px rgba(0, 0, 0, 0.35), 0 10px 28px rgba(0, 0, 0, 0.5);
   }
   ```

2. **Join the dark elevation scale**, if the theme is dark. Add its selector to
   the shared `--e1`…`--e4` / `--rim` block in `themes.css`; a dark theme
   outside it gets the light elevation scale and its cards lose their edges.

3. **Register the id.** `apps/web/src/lib/theme/theme.ts` — add to
   `LIGHT_THEMES` or `DARK_THEMES` and to the matching `*_THEME_OPTIONS` list
   with the label users see. The Settings dropdown renders from those lists, so
   there is no per-theme edit in the UI.

4. **Map the editor theme.** `apps/web/src/lib/theme/codemirror-theme.ts` keys a
   `Record` by the theme id union, so the build fails until the new id has a
   CodeMirror factory. Pick the closest existing one.

## Confetti — per-card colour

`confetti-light` and `confetti-dark` do something the other themes do not: each
card takes the next hue from a six-colour pastel rotation instead of the shared
`--surface`.

The rotation lives in `globals.css`. Position picks the colour — not the
component, and not the data. Nothing in the domain says a paper is pink, so a
list can filter or re-order and the colours simply re-flow.

Position reaches the CSS two ways, because there are two kinds of card list:

- **`:nth-child(6n + k)`** for cards that are siblings, which is most of them.
- **`[data-card-hue]`** for the masonry grids. `CardColumns` deals cards
  round-robin into one wrapper each, so every card is its own wrapper's only
  child and `nth-child` sees position 1 for all of them — the first version of
  this theme shipped a papers list that was entirely one colour. Only the
  component knows a card's index in the flat list, so it writes the number onto
  the wrapper; `--card-tint` and `--card-edge` are custom properties, so they
  inherit down to the card.

A card with no card siblings and no wrapper index lands on hue 1, which is the
intended fallback: one card has nothing to be distinguished from.

Each hue is a pair — `--confetti-N-bg` for the fill and `--confetti-N-edge` for
the border, defined in the theme block as `oklch()`. All six share one lightness
and one chroma and differ only in hue, which is what keeps them reading as a set:
perceived contrast against the surface is mostly lightness, so six colours at
equal lightness sit at equal weight. The first pass picked each colour by eye in
hex and the yellows and pinks shouted over the blues. The border is a stronger
tone of the same hue so it reads as part of the colour rather than a grey line
drawn on top. In the dark variant the fill sits a hair above the dark surface
and the edge carries the recognisable colour, because a pastel at full lightness
glares against a dark page.

`.card` itself reads `var(--card-tint, var(--surface))` and
`var(--card-edge, var(--border))`. Both custom properties are unset in every
other theme, so the fallback applies and nothing outside Confetti changes.

## Design Token Definitions

Source tokens — set these in a theme block:

- `--bg`: the lowest background layer (page root).
- `--surface`: elevated cards and modal backgrounds.
- `--surface2`: recessed surfaces — rows, code blocks, chips, pills.
- `--elev`: raised surfaces (banners, tips) and input backgrounds.
- `--border` / `--border-strong`: hairlines and dividers; the strong variant for
  emphasis and focus.
- `--text`: primary text colour.
- `--muted`: secondary text.
- `--faint`: tertiary text.
- `--accent`: primary action colour (buttons, active tabs).
- `--accent-fg`: text drawn on top of an accent fill.
- `--accent-soft`: hover and active wash.
- `--s-*` / `--s-*-bg`: status foreground and background pairs.
- `--sel-ring`, `--shadow`: selection ring and the theme's drop shadow.

Aliases — defined once on `:root`, **never** in a theme block:
`--ink` (→ `--text`), `--line` (→ `--border`), `--panel` (→ `--elev`),
`--surface-alt` (→ `--surface2`), `--input-bg`, `--pill`, `--chip`,
`--neutral`, `--status-neutral`, `--hover`, `--active-bg`, `--active-fg`,
`--accent-ink`, `--clay`, `--danger`, `--nav-bg`.

## The Catppuccin Implementation

Our Catppuccin themes (Latte, Frappé, Mocha) are mapped exactly to the official Catppuccin style guide:
- `Base` -> `--bg`
- `Surface0` -> `--surface` (cards)
- `Mantle` -> `--chip`, `--nav-bg` (sidebars/shells)
- `Crust` -> `--input-bg` (deepest inset fields)

## Depth, surfaces, and the reactive motion layer

Three appearance controls sit alongside the theme pickers in
**Settings → Appearance**. All three are attributes on `<html>`, applied before
first paint by the boot script in `apps/web/src/lib/theme/theme.ts`.

### Surfaces — `data-surfaces`

- `borderless` (default): panels drop their hairline (`border-color` goes
  transparent, so nothing reflows) and get their edge from the `--e1`…`--e4`
  elevation scale plus the `--rim` top highlight. Buttons, inputs and other
  controls keep their borders — a borderless input has no affordance telling
  you where to click.
- `bordered`: the entire depth layer in `globals.css` is scoped to
  `[data-surfaces="borderless"]`, so this restores every hairline at once.
  Pair it with the High Contrast theme: a drop shadow carries almost no
  contrast ratio, so the answer for a high-contrast user is the line back, not
  a heavier shadow.

### Reactive motion — `data-motion="reactive"`

Off by default and purely additive. Everything the app animated before this
flag existed still animates in both states; the flag gates only the
pointer-reactive layer (card tilt, cursor sheen, press physics, entrance
rise). `apps/web/src/app/reactive-motion.tsx` publishes the pointer position
inside the hovered surface as `--rx` / `--ry` (0–1) from a single delegated,
rAF-coalesced listener — and attaches no listeners at all when the toggle is
off, the pointer is coarse, or the OS asks for reduced motion. The OS
preference always wins over the app toggle.

Four things are load-bearing in that CSS block, and each is easy to
accidentally undo:

- **`@property` registration.** `--rx`, `--ry` and `--rm-glow` are registered,
  which gives them a type and therefore makes them *interpolable*. An
  unregistered custom property is a string, and a gradient stop built from one
  snaps rather than animates. The sheen animates its radius, blooming out of
  and back into the point where the pointer entered. The position variables
  are registered but never transitioned — a transition there would make the
  light lag the cursor.
- **Identity `translate` / `rotate` / `scale` on the base state.** Without
  them, the first hover introduces a transform, creating a stacking context
  and containing block mid-interaction, which can visibly reorder overlapping
  cards.
- **Separate transform channels.** Tilt is on `transform` (two-axis rotation
  cannot be expressed with the single-axis `rotate` property), lift is on
  `translate`, press is on `scale`. They compose; a single `transform` chain
  meant `:active` replaced the tilt and snapped a pressed card flat.
- **Scroll-driven entrance.** Cards rise on an `animation-timeline: view()`
  timeline over `cover 0%`–`cover 22%`, so each animates as it actually scrolls
  in, off the main thread, with no per-item index. A mount animation would run
  for all 200 rows of a list at once — including the 190 offscreen — and re-run
  on every filter change. Firefox has no view timelines yet and gets a mount
  animation through `@supports not`.

`--rm-spring` is a `cubic-bezier` overshoot upgraded to a real multi-oscillation
`linear()` spring inside `@supports`. The upgrade is gated rather than declared
as two back-to-back values, because a custom property accepts almost any token
sequence: a browser without `linear()` would still accept the declaration and
then fail at substitution time, silently dropping the timing function to `ease`.

### Uploaded themes — `config.json`

A user can load a theme file instead of hand-editing `themes.css`. Download the
starter file from Settings → Appearance. Shape:

```json
{
  "version": 1,
  "name": "My theme",
  "mode": "dark",
  "surfaces": "borderless",
  "motion": { "reactive": true, "scale": 1 },
  "colors": { "bg": "#0b0d12", "accent": "#6ea8fe" },
  "fonts": { "sans": "IBM Plex Sans, system-ui, sans-serif" },
  "radius": { "card": "14px", "control": "10px", "chip": "999px" }
}
```

The file is untrusted input and is validated by `parseThemeConfig`
(`packages/core/src/features/settings/domain/theme-config.ts`) before anything
is applied:

- A byte cap is enforced *before* `JSON.parse`.
- Keys come from allowlists; an unknown key is an error, not something ignored,
  so a typo surfaces instead of silently doing nothing.
- Values must match a grammar — hex / numeric `rgb()` / `hsl()` colors, font
  stacks built from bounded family names, lengths in `px|rem|em` within range.
- Accepted values are **re-serialized from the parsed pieces**, never passed
  through verbatim.
- Prototype-polluting keys reject the whole file.
- Validation is all-or-nothing: one bad color rejects the file, because half a
  palette is unreadable. Every problem is listed at once.

The applier only ever calls `style.setProperty()` with a name from the same
allowlist, so config text never reaches a stylesheet as text — a value cannot
break out of its declaration and a key cannot become a selector or an
`@import`. Configs read back from the settings row are re-validated on load
rather than trusted for having passed once.
