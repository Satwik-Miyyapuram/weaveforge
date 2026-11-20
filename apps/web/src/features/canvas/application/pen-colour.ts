import { PAPER_INK_SLOTS } from "@/features/ink/render/map-ink-colour";

/**
 * The pen colour a freeform page starts with: the text slot in canonical
 * (Paper) form. Strokes store canonical hex and draw through
 * `resolveInkColour`, so this shows as the theme's text colour on any theme
 * and exports as dark ink on white.
 */
export const DEFAULT_PEN_COLOUR = PAPER_INK_SLOTS.text;

/** Where the freeform page's pen colour lives in `.weaveforge/settings.json`. */
export const CANVAS_PEN_COLOUR_KEY = ["canvas", "penColour"] as const;

/** A stored pen colour, or the default when it is missing or not a `#rrggbb` hex. */
export function penColourFrom(raw: unknown): string {
  return typeof raw === "string" && /^#[0-9a-f]{6}$/i.test(raw) ? raw.toLowerCase() : DEFAULT_PEN_COLOUR;
}
