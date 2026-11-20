import { PAPER_INK_SLOTS } from "@/features/ink/render/map-ink-colour";

/**
 * The pen colour a freeform page starts with: the text slot in canonical
 * (Paper) form. Strokes store canonical hex and draw through
 * `resolveInkColour`, so this shows as the theme's text colour on any theme
 * and exports as dark ink on white.
 */
export const DEFAULT_PEN_COLOUR = PAPER_INK_SLOTS.text;
