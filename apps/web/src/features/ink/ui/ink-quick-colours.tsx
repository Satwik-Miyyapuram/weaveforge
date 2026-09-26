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

type InkColour = (typeof INK_COLOURS)[number];

export interface InkQuickColoursProps {
  colours: readonly InkColour[];
  colour: InkColour;
  onColour: (colour: InkColour) => void;
}

export function InkQuickColours({ colours, colour, onColour }: InkQuickColoursProps) {
  return (
    <div className="ink-swatches ink-quick-colours" role="group" aria-label="Quick colours">
      {colours.map((entry, slot) => (
        <button
          key={slot}
          type="button"
          className={`ink-swatch ink-swatch-${entry}`}
          aria-pressed={colour === entry}
          aria-label={`Ink colour: ${entry}`}
          title={entry}
          onClick={() => onColour(entry)}
        />
      ))}
    </div>
  );
}
