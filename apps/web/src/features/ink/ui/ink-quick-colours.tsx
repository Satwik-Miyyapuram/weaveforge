"use client";

/**
 * Five colours on the bar itself, one tap each, and each one the reader's to
 * change.
 *
 * The pen's full palette sits behind its swatch; these are the colours a page
 * is actually written in, so switching between them costs one tap and no menu.
 * There is one palette, not two: a colour picked there while a quick colour is
 * the pen's replaces that slot (`ink-bar.tsx`). The choice is kept on this
 * device (`use-quick-colours.ts`).
 */

import { INK_COLOURS } from "@weaveforge/core";
import { Swatch } from "@/components/controls";
import { INK_COLOUR_TOKENS, type InkPalette } from "../render/parts-1";
import { readyCore } from "@/lib/rust-core";

type InkColour = (typeof INK_COLOURS)[number];

/** A swatch's fill: the palette's ink when the page draws a fixed one (paper), else the theme token. */
export function inkSwatchFill(entry: InkColour, palette?: InkPalette): string {
  return palette ? readyCore().paletteHex(palette, entry) : `var(${INK_COLOUR_TOKENS[entry]})`;
}

export interface InkQuickColoursProps {
  colours: readonly InkColour[];
  colour: InkColour;
  onColour: (colour: InkColour) => void;
  disabled?: boolean;
  /** The ink the page draws when it is not the theme's (paper). */
  palette?: InkPalette;
}

export function InkQuickColours({ colours, colour, onColour, disabled = false, palette }: InkQuickColoursProps) {
  return (
    <div className="ink-swatches ink-quick-colours" role="group" aria-label="Quick colours">
      {colours.map((entry, slot) => (
        <Swatch
          key={slot}
          label={`Ink colour: ${entry}`}
          selected={!disabled && colour === entry}
          colour={inkSwatchFill(entry, palette)}
          disabled={disabled}
          onClick={() => onColour(entry)}
        />
      ))}
    </div>
  );
}
