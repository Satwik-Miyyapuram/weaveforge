"use client";

import { ColourMenu } from "@/components/colour-menu";

/**
 * The pen rail: one strip with everything a hand holding a stylus needs.
 *
 * Pen, highlighter, eraser and select; the recent colours as swatches; the
 * nib sizes as dots; undo and redo. It is a strip and not a dialog because the
 * reader's tool picker was a dropdown and a colour input — three taps and a
 * native picker between a person and a different colour, which on a tablet
 * is long enough to lose the thought they wanted to write down.
 *
 * It borrows the ink note's glyphs and classes (`ink-tool-icons`, `.ink-tool`,
 * `.ink-swatch`, `.ink-nib-dot`) so the two surfaces look like one product;
 * it does not borrow the `InkBar` component, whose props are the ink note's
 * whole state.
 */

import { INK_NIB_WIDTHS_PT, INK_PEN_WIDTHS } from "@weaveforge/core";
import { toolIcon } from "@/components/ink-tool-icons";
import { READER_ANNOTATION_COLORS } from "../../application/reader-annotation-helpers";
import { PEN_RAIL_TOOLS, type PenRailTool } from "./use-pen-prefs";

export interface PenRailProps {
  tool: PenRailTool;
  color: string;
  /** Nib in PDF points; one of `INK_NIB_WIDTHS_PT`. */
  nib: number;
  /** The swatches shown; most recent first. */
  recent: readonly string[];
  canUndo: boolean;
  canRedo: boolean;
  onTool: (tool: PenRailTool) => void;
  onColor: (color: string) => void;
  onNib: (nib: number) => void;
  onUndo: () => void;
  onRedo: () => void;
  onClose: () => void;
}

const TOOL_LABEL: Record<PenRailTool, string> = {
  select: "Select",
  ink: "Pen",
  highlighter: "Highlighter",
  erase: "Eraser",
};

function railToolIcon(tool: PenRailTool) {
  switch (tool) {
    case "ink":
      return toolIcon("pen");
    case "highlighter":
      return toolIcon("highlighter");
    case "erase":
      return toolIcon("eraser");
    case "select":
      return (
        <svg
          width="17"
          height="17"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M4 3l7 17 2.5-6.5L20 11z" />
        </svg>
      );
  }
}

export function PenRail({
  tool,
  color,
  nib,
  recent,
  canUndo,
  canRedo,
  onTool,
  onColor,
  onNib,
  onUndo,
  onRedo,
  onClose,
}: PenRailProps) {
  // The full palette is one more tap away: a datalist on the colour input
  // offers the eight reader colours as presets in the native picker, which
  // is the one place the picker is worth its taps.
  const swatches = recent.length ? recent : READER_ANNOTATION_COLORS.slice(0, 4);
  return (
    <div className="pdf-reader-tools pdf-pen-rail" role="toolbar" aria-label="Pen">
      <div className="ink-bar-group" role="radiogroup" aria-label="Pen tool">
        {PEN_RAIL_TOOLS.map((entry) => (
          <button
            key={entry}
            type="button"
            className="ink-tool ink-tool-icon-only"
            aria-pressed={tool === entry}
            aria-label={TOOL_LABEL[entry]}
            title={TOOL_LABEL[entry]}
            onClick={() => onTool(entry)}
          >
            {railToolIcon(entry)}
          </button>
        ))}
      </div>

      <span className="ink-sep" aria-hidden="true" />

      <div className="ink-swatches" role="radiogroup" aria-label="Pen colour">
        {swatches.map((entry) => (
          <button
            key={entry}
            type="button"
            className="ink-swatch"
            style={{ background: entry }}
            aria-pressed={color.toLowerCase() === entry.toLowerCase()}
            aria-label={`Colour ${entry}`}
            title={entry}
            onClick={() => onColor(entry)}
          />
        ))}
        <ColourMenu
          value={color}
          palette={READER_ANNOTATION_COLORS}
          recent={recent}
          ariaLabel="Other colour"
          onChange={onColor}
        />
      </div>

      <span className="ink-sep" aria-hidden="true" />

      <div
        className="ink-bar-group"
        role="radiogroup"
        aria-label="Nib width"
        title="Nib width"
        style={{ opacity: tool === "ink" ? 1 : 0.45 }}
      >
        {INK_NIB_WIDTHS_PT.map((entry, i) => {
          const tenths = INK_PEN_WIDTHS[i] ?? 3;
          const label = `Nib ${(tenths / 10).toFixed(1)} mm`;
          return (
            <button
              key={entry}
              type="button"
              className="ink-tool ink-tool-icon-only ink-tool-nib"
              aria-pressed={nib === entry}
              aria-label={label}
              title={label}
              onClick={() => onNib(entry)}
            >
              <span
                className="ink-nib-dot"
                style={{ width: `${3 + tenths}px`, height: `${3 + tenths}px` }}
              />
            </button>
          );
        })}
      </div>

      <span className="ink-sep" aria-hidden="true" />

      <div className="ink-bar-group">
        <button
          type="button"
          className="ink-tool ink-tool-icon-only"
          onClick={onUndo}
          disabled={!canUndo}
          title="Undo (Ctrl+Z)"
          aria-label="Undo"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M3 7v6h6" />
            <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
          </svg>
        </button>
        <button
          type="button"
          className="ink-tool ink-tool-icon-only"
          onClick={onRedo}
          disabled={!canRedo}
          title="Redo (Ctrl+Shift+Z)"
          aria-label="Redo"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M21 7v6h-6" />
            <path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7" />
          </svg>
        </button>
      </div>

      <span className="ink-bar-spacer" />

      <button
        type="button"
        className="ink-tool"
        onClick={onClose}
        title="Put the pen down"
        aria-label="Close pen rail"
      >
        Done
      </button>
    </div>
  );
}
