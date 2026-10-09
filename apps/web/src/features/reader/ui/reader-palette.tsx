"use client";

/**
 * The read palette: what a reader does *to* a paper, in the ink bar's shell.
 *
 * Same element classes, dock and fold as `ink-bar.tsx`, so in the chrome it is
 * a row and in focus mode it floats at the dock the ink palette uses
 * (`palette-dock.tsx`). Colours work like the pen's: five quick ones, and the
 * current swatch opens all eight; a pick replaces the quick colour in use.
 */

import { useState } from "react";

import { PaletteDockButton, PaletteFoldButton, usePaletteDock } from "@/components/palette-dock";
import { Popover } from "@/components/popover";
import { READER_ANNOTATION_COLORS, type ReaderCreateTool } from "../application/reader-annotation-helpers";

/** The palette's tools, in order, each drawn rather than named. */
export const READER_PALETTE_TOOLS: ReadonlyArray<{ value: ReaderCreateTool; label: string; path: string }> = [
  { value: "select", label: "Select text to highlight, underline or comment", path: "M9 4h6M9 20h6M12 4v16" },
  { value: "image", label: "Clip a region", path: "M6 2v14a2 2 0 0 0 2 2h14M18 22V8a2 2 0 0 0-2-2H2" },
  { value: "text", label: "Type a text box on the page", path: "M5 6V4h14v2M12 4v16M9 20h6" },
];

export interface ReaderPaletteProps {
  tool: ReaderCreateTool;
  colour: string;
  /** The five quick colours (`use-reader-quick-colours.ts`), held by the reader so its phone pill shows the same. */
  quickColours: readonly string[];
  onQuickColour: (slot: number, colour: string) => void;
  onTool: (tool: ReaderCreateTool) => void;
  onColour: (colour: string) => void;
}

export function ReaderPalette({ tool, colour, quickColours, onQuickColour, onTool, onColour }: ReaderPaletteProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [dock, setDock] = usePaletteDock();

  return (
    <div
      className="ink-bar ink-palette reader-palette"
      role="toolbar"
      aria-label="Annotation tools"
      data-collapsed={collapsed || undefined}
      data-dock={dock}
    >
      <div className="ink-palette-handles">
        <PaletteDockButton dock={dock} onDock={setDock} />
        <PaletteFoldButton collapsed={collapsed} onToggle={() => setCollapsed((was) => !was)} />
      </div>

      <div className="ink-bar-group ink-bar-tools" role="radiogroup" aria-label="Annotation tool">
        {READER_PALETTE_TOOLS.map((entry) => (
          <button
            key={entry.value}
            type="button"
            className="ink-tool ink-tool-icon-only"
            aria-pressed={tool === entry.value}
            aria-label={entry.label}
            title={entry.label}
            onClick={() => onTool(entry.value)}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d={entry.path} />
            </svg>
          </button>
        ))}
      </div>

      <span className="ink-sep" aria-hidden="true" />

      <div className="ink-swatches ink-quick-colours" role="group" aria-label="Quick colours">
        {quickColours.map((entry, slot) => (
          <button
            key={slot}
            type="button"
            className="ink-swatch"
            style={{ background: entry }}
            aria-pressed={colour === entry}
            aria-label={`Annotation colour ${entry}`}
            title={entry}
            onClick={() => onColour(entry)}
          />
        ))}
      </div>

      <div className="ink-swatches ink-pen-pick">
        <Popover
          iconOnly
          portal
          ariaLabel="All annotation colours"
          triggerClassName="colour-menu-trigger ink-pen-trigger"
          label={<span className="ink-swatch colour-menu-current" style={{ background: colour }} aria-hidden />}
        >
          {(close) => (
            <div className="colour-menu ink-pen-menu">
              <div className="colour-menu-row" role="group" aria-label="Annotation colours">
                {READER_ANNOTATION_COLORS.map((entry) => (
                  <button
                    key={entry}
                    type="button"
                    className="ink-swatch"
                    style={{ background: entry }}
                    aria-pressed={colour === entry}
                    aria-label={`Annotation colour ${entry}`}
                    title={entry}
                    onClick={() => {
                      // The quick colour in use takes the pick, as on the ink bar.
                      const slot = quickColours.indexOf(colour);
                      if (slot >= 0 && !quickColours.includes(entry)) onQuickColour(slot, entry);
                      onColour(entry);
                      close();
                    }}
                  />
                ))}
              </div>
            </div>
          )}
        </Popover>
      </div>
    </div>
  );
}
