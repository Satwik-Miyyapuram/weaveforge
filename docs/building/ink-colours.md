# Ink colours across themes

Ink is drawn in one theme and read in another. A dark stroke written on the
light page must not vanish on a dark page, and a colour must not change in the
file because someone switched theme. WeaveForge solves both the way OneNote's
dark mode does: the stored colour never changes, and the colour on screen is
worked out when the stroke is drawn.

Code: `apps/web/src/features/ink/render/map-ink-colour.ts` (the map) and
`resolve-ink-colour.ts` (what a stored value draws as).

## What is stored

- **A token** (`"text"`, `"red"`, ...) for the quick colours of an ink note.
  It resolves through the live theme's palette, as before.
- **A canonical hex** for everything else: the colour as it looks on the light
  **Paper** theme (`light.css`). Stored data is never migrated or rewritten.

## What is drawn

`resolveInkColour(stored, ink)`:

1. A token draws as the theme's value for that token.
2. A hex within 0.02 OKLab of a Paper slot (`PAPER_INK_SLOTS`) draws as that
   slot's token in the current theme, so the Paper text colour becomes the
   theme's text colour exactly.
3. Any other hex goes through `mapInkColour(hex, Paper, theme)`.
4. Anything that is not a hex is passed through as CSS.

A colour picked in a theme is stored with `canonicalInkColour`, which is the
same map with the themes swapped.

The PDF reader stores Paper palette hexes whatever the theme, because the page
under its marks is white. The freeform page draws through the live theme and
re-renders on a theme switch (`useThemeInk`).

## The map

`mapInkColour(hex, from, to)` works in OKLCH and is closed form:

- **Lightness keeps its place between page and text.**
  `t = (L − L_bg,from) / (L_fg,from − L_bg,from)`, then
  `L' = L_bg,to + t (L_fg,to − L_bg,to)`.
- **Chroma follows the theme's accents.** `C' = C · k_to / k_from`, where `k`
  is the theme's mean accent chroma divided by Paper's. On a dark page `k` is
  capped at 1 (Helmholtz–Kohlrausch, below).
- **Hue is kept.**
- **Gamut:** an out-of-sRGB result loses chroma at constant hue and lightness.
  Rounding to 8-bit picks the nearest neighbour that keeps the hue within 2°.

## Laws (property-tested)

`apps/web/src/features/ink/test/map-ink-colour.test.ts` checks these with
fast-check:

| Law | Bound |
| --- | --- |
| Identity: Paper → Paper | exact |
| Inverse: map there and back | within one JND (ΔE_ok ≤ 0.02), for colours that are not near-black and not at the gamut edge |
| Hue kept | ≤ 3° where C > 0.02 |
| Lightness order kept | within 0.01 (for inks ≥ 0.02 apart in t) |
| Distinct stays distinct | ΔE_ok ≥ 0.04 apart in → ≥ 0.02 apart out (unclamped colours) |
| Output | a valid `#rrggbb`, deterministic |

## Known limits

- **Near black and the gamut edge.** One 8-bit step near black is about 0.07
  in OKLab lightness, and chroma clamped at the edge cannot come back, so those
  colours round-trip only to about a JND.
- **Low-chroma themes.** CRT's status tokens equal its text colour, so its
  accent chroma (k ≈ 0.78) greys mapped colours a little.
- **Light colours on a dark page.** A pale colour sits near the Paper page,
  so the map keeps it near the dark page: it stays visible but dim. Marker
  colours are slots, so they keep their theme value instead.
- **Ink note pages** resolve tokens through the theme, but a plain hex stroke
  there is still drawn as stored.
- **White ink on dark themes.** White drawn on Paper maps to near black on a
  dark theme. This is intended: it keeps its contrast with the page, as on Paper.

## Related work

- **Chameleon** (arXiv 2512.00516) recolours content for a theme by
  optimising a loss of luminance contrast, ΔE2000 colour fidelity and
  adjacent-difference consistency with simulated annealing. WeaveForge keeps a
  closed-form map instead: it is per colour, deterministic, cheap enough to run
  at draw time and has an exact inverse, which an optimiser does not.
- **Helmholtz–Kohlrausch effect.** Saturated colours look brighter than their
  luminance says, more so on a dark surround. Scaling chroma up on a dark
  theme would overshoot, so `k` is capped at 1 there.
- **Chang et al. 2015, "Palette-based Photo Recoloring"** (SIGGRAPH). Their
  gamut handling, reducing chroma at constant hue, is what the clamp does.
- **Why not `L' = 1 − L`.** Inverting lightness pins black to white and white
  to black whatever the theme. The linear t-map instead anchors on the
  theme's own page and text, so a theme whose text is grey or tinted keeps the
  ink's spacing between page and text, and the middle tones do not crush
  together at the ends.
