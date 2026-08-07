# Theming Architecture

WeaveForge uses a pure CSS-variable theming system to maintain high performance without JavaScript layout thrashing. All colors in the app are controlled through semantic design tokens.

## How it works

1. **Tokens**: All colors are defined in `apps/web/src/app/themes.css`. No hardcoded hex values exist in `globals.css` or component files.
2. **Dual Mode**: The app tracks two distinct states:
   - `data-mode`: `"light"` or `"dark"`.
   - `data-theme`: The specific palette applied to that mode (e.g., `"mocha"`, `"amoled"`, `"latte"`).
3. **No-Flash Boot**: `layout.tsx` contains an inline `<script>` that reads `localStorage` before the DOM parses, instantly applying the correct `data-mode` and `data-theme` to the `<html>` root. This prevents any white-flash on load.

## Adding a New Theme

To add a completely new theme (e.g., "Nord"):

1. **Define the CSS Variables**
   Open `apps/web/src/app/themes.css` and add your block:
   ```css
   [data-theme="nord"] {
     --bg: #2e3440;
     --surface: #3b4252;
     --ink: #eceff4;
     --muted: #d8dee9;
     --line: #4c566a;
     --accent: #88c0d0;
     --accent-ink: #8fbcbb;
     --clay: #ebcb8b;
     --input-bg: #2e3440;
     --pill: #434c5e;
     --hover: #4c566a;
     --chip: #3b4252;
     --neutral: #434c5e;
     --status-neutral: #4c566a;
     --active-bg: #4c566a;
     --nav-bg: rgba(46, 52, 64, 0.92);
     --sel-ring: rgba(236, 239, 244, 0.16);

     /* Status colors - foreground text on colored pills should have high contrast */
     --st-positive-bg: #a3be8c; --st-positive-fg: #2e3440;
     --st-info-bg: #81a1c1;     --st-info-fg: #2e3440;
     --st-warn-bg: #ebcb8b;     --st-warn-fg: #2e3440;
     --st-danger-bg: #bf616a;   --st-danger-fg: #2e3440;

     /* Standard dark mode shadow */
     --shadow: 0 1px 2px rgba(0, 0, 0, 0.3), 0 8px 24px rgba(0, 0, 0, 0.45);
   }
   ```

2. **Add it to the Settings UI**
   Open `apps/web/src/features/settings/ui/settings-screen.tsx`. Add your new theme as an `<option>` in either the Light Theme or Dark Theme dropdown:
   ```tsx
   <option value="nord">Nord</option>
   ```

## Design Token Definitions

- `--bg`: The lowest background layer (page root).
- `--surface`: Elevated cards and modal backgrounds.
- `--input-bg`: Background for text inputs and dropdowns.
- `--ink`: Primary text color.
- `--muted`: Secondary/tertiary text color.
- `--line`: Borders and dividers.
- `--accent`: Primary action color (buttons, active tabs).
- `--accent-ink`: Hover state for accents or text on accent backgrounds.
- `--btn-text`: (Optional) specifically overrides the text color inside primary buttons if `--accent` contrast is too low.

## The Catppuccin Implementation

Our Catppuccin themes (Latte, Frappé, Mocha) are mapped exactly to the official Catppuccin style guide:
- `Base` -> `--bg`
- `Surface0` -> `--surface` (cards)
- `Mantle` -> `--chip`, `--nav-bg` (sidebars/shells)
- `Crust` -> `--input-bg` (deepest inset fields)

## Depth, surfaces, and the reactive motion layer

Three appearance controls sit alongside the theme pickers in
**Settings → Appearance**. All three are attributes on `<html>`, applied before
first paint by the boot script in `apps/web/src/lib/theme.ts`.

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
