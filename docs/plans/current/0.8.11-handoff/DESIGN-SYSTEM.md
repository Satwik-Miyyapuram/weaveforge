# WeaveForge

Read, note and weave research into one graph. Loud where it helps, quiet where you read.

## Themes

**CRT is the primary theme.** It is a warm phosphor screen with ink outlines, pixel display type, scanlines and cards that lean. The other themes are secondary:

| Theme | id | Character |
|---|---|---|
| CRT | `crt` | Primary. Cream ground, 3px ink, Jersey 10 titles, blue accent, red active nav |
| Poster light | `brutal` | Neo-brutalist paper with 2px ink, diagonal offset shadows and a yellow accent |
| Poster dark | `brutal-dark` | Poster on near-black with cream ink |
| Mocha | `mocha` | Soft dark (Catppuccin), hairlines, no hard shadows |
| Paper | `light` | Soft warm light, blue accent |
| Amoled | `amoled` | True black for OLED |
| Honey | `honey` | Soft warm light, amber accent |

Tokens that only exist in the Poster and CRT stylesheets (nav fill, tints, chips, toast, well, danger fill) are mapped onto each soft theme's own palette: the accent for nav, the status washes for tints.

## Principles

- **Hard edges.** Outlines are ink: 3px on CRT, 2px on Poster. Shadows are offset and never blur.
- **Hover changes brightness only.** Nothing moves on hover.
- **Icon buttons sit flush.** At rest an icon button (the card ⋮ menu, share, open) has a transparent border and no fill. On hover it pops: ink border, a light fill and `sh-sm`. While its menu is open it becomes the accent tile. On paper cards it rests at 35% opacity until the card is hovered.
- **Press drops into the shadow.** On press, a button translates by its shadow (CRT `translate(5px,5px)`, Poster `translate(4px,4px)`) and the shadow goes to none.
- **The focused field lifts.** While you type, the field fills with `type-bg`, outlines in `type-line` and gains `type-sh`.
- **Focus rings are ink, never browser blue.**
- **Sentence case everywhere.** Write "Add paper", not "Add Paper".
- Say **Notes**, never "vault".

## Type

- **Rubik** for all UI and reading text. Poster display uses weight 800.
- **Jersey 10** is the CRT pixel face. Use it only for titles and buttons: 2.75rem for screen titles, 1.6rem for card and modal titles, 1.25rem for buttons and 1.15rem for ghost buttons, all at weight 400.
- **JetBrains Mono** for code, DOIs and identifiers.

All three load from Google Fonts.

## Shape

| | CRT | Poster | Soft themes |
|---|---|---|---|
| Card radius | 12px | 6px | 14px |
| Control radius | 8px | 4px | 10px |
| Border | 3px ink | 2px ink | 1px hairline |
| Card shadow | `6px 6px 0` ink | `5px 5px 0` ink | faint or none |

## CRT extras

- Scanlines over the page: a fixed, pointer-transparent overlay of 1px ink lines (`rgba(43,34,43,.06)`) every 3px, plus a soft vignette darkening the edges to 18%. It never moves, hides in print, and a "Scanlines" setting turns it off (`data-scanlines="off"`).
- Leaning cards that sit at a slight tilt.
- Card tint modes: full, bar, border and none. A card's tint comes from its reading state (`tint-*`) or its tag (`tag-*-tint`).

## Reading states

| State | Chip | Tint |
|---|---|---|
| To read | `chip-to-read` | `tint-to-read` |
| Reading | `chip-reading` | `tint-reading` |
| Read | `chip-read` | `tint-read` |
| Skimmed | `chip-skimmed` | `tint-skimmed` |
| Dropped | `chip-danger` | — |

## Logo

The weave mark is `apps/web/public/icons/weave_forge.svg` in the repo.
