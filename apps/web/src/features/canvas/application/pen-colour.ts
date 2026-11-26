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

/** The widths the freeform page's pen offers, in page pixels. */
export const PEN_WIDTHS = [2, 4, 8, 16] as const;

/** The pen width a freeform page starts with: thin, like the notes' pen. */
export const DEFAULT_PEN_WIDTH = 2;

/** Where the freeform page's pen width lives in `.weaveforge/settings.json`. */
export const CANVAS_PEN_WIDTH_KEY = ["canvas", "penWidth"] as const;

/** A stored pen width, or the default when it is missing or not one of `PEN_WIDTHS`. */
export function penWidthFrom(raw: unknown): number {
  return PEN_WIDTHS.find((w) => w === raw) ?? DEFAULT_PEN_WIDTH;
}
