"use client";

import { Popover } from "./popover";
import { ToggleButton } from "./controls";

/**
 * One colour picker for every place a mark gets a colour: the reader's
 * highlight toolbar and the pen rail. A swatch shows the current colour and
 * opens a palette; the last row takes any other colour through the native
 * picker. The same component, so the two never drift apart in look or reach.
 */
export function ColourMenu({
  value,
  palette,
  recent = [],
  ariaLabel,
  onChange,
}: {
  value: string;
  palette: readonly string[];
  /** Colours picked lately, shown ahead of the palette; most recent first. */
  recent?: readonly string[];
  ariaLabel: string;
  onChange: (colour: string) => void;
}) {
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  const extra = recent.filter((c) => !palette.some((p) => same(p, c)));
  return (
    <Popover
      iconOnly
      ariaLabel={ariaLabel}
      look="custom"
      triggerClassName="colour-menu-trigger"
      label={<span className="ink-swatch colour-menu-current" style={{ background: value }} aria-hidden />}
    >
      {(close) => {
        const swatch = (entry: string) => (
          <ToggleButton pressed={same(entry, value)}
            key={entry}
            className="ink-swatch"
            style={{ background: entry }}
            aria-label={`Colour ${entry}`}
            title={entry}
            onClick={() => { onChange(entry); close(); }}
          />
        );
        return (
          <div className="colour-menu">
            {extra.length > 0 && (
              <div className="colour-menu-row" role="group" aria-label="Recent colours">
                {extra.map(swatch)}
              </div>
            )}
            <div className="colour-menu-row" role="group" aria-label="Palette">
              {palette.map(swatch)}
            </div>
            <label className="colour-menu-custom">
              <span>Other…</span>
              <input
                type="color"
                value={value}
                aria-label="Other colour"
                onChange={(e) => onChange(e.target.value)}
              />
            </label>
          </div>
        );
      }}
    </Popover>
  );
}
