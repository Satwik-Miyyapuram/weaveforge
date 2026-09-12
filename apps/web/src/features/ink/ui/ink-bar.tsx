"use client";

/**
 * The ink bar: every tool, in one row, with the page and pen state at its end.
 *
 * §6.1's layout, and the whole of §6.3's tool table as data. The bar owns no
 * document state — it is handed the tool in force and says what the user asked for
 * — so it can be rendered in a test with nothing behind it, and so the ink host
 * stays the only place that decides what a tool *means*.
 *
 * The three widths and three colours are the plan's "3 token colours, 3 widths";
 * the widths are the pen's, in 0.1 mm, and a highlighter ignores them because its
 * nib is the tool's (§6.3).
 */

import { INK_COLOURS, INK_PEN_WIDTHS, INK_HIGHLIGHTER_WIDTH } from "@weaveforge/core";

/** The tools the bar offers, in the order the plan's sketch draws them. */
export const INK_BAR_TOOLS = ["pen", "highlighter", "eraser", "lasso"] as const;
export type InkBarTool = (typeof INK_BAR_TOOLS)[number];

/** What the highlighter's width is, whatever the pen widths say. */
export const HIGHLIGHTER_NIB = INK_HIGHLIGHTER_WIDTH;

/**
 * The nib a tool draws with.
 *
 * A highlighter is 6 mm because its tool says so; the eraser and the lasso do not
 * draw at all, so their width is only ever read by a test or a status line.
 */
export function nibForTool(tool: InkBarTool | "shape", penWidth: number): number {
  if (tool === "highlighter") return HIGHLIGHTER_NIB;
  if (tool === "eraser") return 0;
  return penWidth;
}

export interface InkBarProps {
  tool: InkBarTool | "shape";
  colour: (typeof INK_COLOURS)[number];
  /** The pen's width, in 0.1 mm. */
  width: number;
  page: number;
  pages: number;
  strokes: number;
  /** Mean recognition confidence, 0 when the page has never been recognised. */
  recognised: number;
  penOnly: boolean;
  penSeen: boolean;
  /** The renderer actually drawing, for the readout at the end of the bar. */
  backend: string | null;
  busy?: boolean;
  onTool: (tool: InkBarTool | "shape") => void;
  onColour: (colour: (typeof INK_COLOURS)[number]) => void;
  onWidth: (width: number) => void;
  onPenOnly: (value: boolean) => void;
  onRecognise: () => void;
  onInsertPage: () => void;
  onExport: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onAddPage: () => void;
}

/** The label a tool shows. `shape` is reachable by chord and by hold, not by tool. */
export function toolLabel(tool: InkBarTool | "shape"): string {
  switch (tool) {
    case "pen":
      return "Pen";
    case "highlighter":
      return "Highlighter";
    case "eraser":
      return "Eraser";
    case "lasso":
      return "Lasso";
    case "shape":
      return "Shape";
  }
}

export function InkBar({
  tool,
  colour,
  width,
  page,
  pages,
  strokes,
  recognised,
  penOnly,
  penSeen,
  backend,
  busy,
  onTool,
  onColour,
  onWidth,
  onPenOnly,
  onRecognise,
  onInsertPage,
  onExport,
  onUndo,
  onRedo,
  onAddPage,
}: InkBarProps) {
  return (
    <div className="ink-bar" role="toolbar" aria-label="Ink tools">
      {INK_BAR_TOOLS.map((entry) => (
        <button
          key={entry}
          type="button"
          className="ink-tool"
          aria-pressed={tool === entry}
          title={`${toolLabel(entry)} (${entry[0]!.toUpperCase()})`}
          onClick={() => onTool(entry)}
        >
          {toolLabel(entry)}
        </button>
      ))}
      <span className="ink-sep" aria-hidden="true" />
      {INK_COLOURS.slice(0, 3).map((entry) => (
        <button
          key={entry}
          type="button"
          className={`ink-swatch ink-swatch-${entry}`}
          aria-pressed={colour === entry}
          aria-label={`Ink colour: ${entry}`}
          title={`Ink colour: ${entry}`}
          onClick={() => onColour(entry)}
        />
      ))}
      <span className="ink-sep" aria-hidden="true" />
      {INK_PEN_WIDTHS.map((entry) => (
        <button
          key={entry}
          type="button"
          className="ink-tool ink-tool-nib"
          aria-pressed={width === entry && tool === "pen"}
          aria-label={`Nib ${(entry / 10).toFixed(1)} mm`}
          title={`Nib ${(entry / 10).toFixed(1)} mm`}
          onClick={() => onWidth(entry)}
        >
          {(entry / 10).toFixed(1)}
        </button>
      ))}
      <span className="ink-sep" aria-hidden="true" />
      <button type="button" className="ink-tool" onClick={onUndo} title="Undo (⌘Z)">
        Undo
      </button>
      <button type="button" className="ink-tool" onClick={onRedo} title="Redo (⌘⇧Z)">
        Redo
      </button>
      <button type="button" className="ink-tool" onClick={onAddPage} title="Add page">
        Add page
      </button>
      <button type="button" className="ink-tool" onClick={onInsertPage} title="Insert PDF page">
        Insert PDF page
      </button>
      <button
        type="button"
        className="ink-tool"
        onClick={onRecognise}
        disabled={busy}
        title="Recognise this page (⌘⇧R)"
      >
        {busy ? "Recognising…" : "Recognise"}
      </button>
      <button type="button" className="ink-tool" onClick={onExport} title="Export page PNG (⌘⇧E)">
        Export PNG
      </button>
      <span className="ink-sep" aria-hidden="true" />
      <label className="ink-pen-only" title="Ignore touch entirely; the wrist guard">
        <input
          type="checkbox"
          className="themed-check"
          checked={penOnly}
          onChange={(event) => onPenOnly(event.target.checked)}
        />
        Pen only
      </label>
      <span className="ink-bar-spacer" />
      {/*
        The readout §6.1 draws at the end of the bar: which page, how many strokes,
        whether a pen is being used, and how much of the page the recogniser is sure
        of. `backend` is appended when it is not WebGL2, because a fallback renderer
        is something the user should be able to see rather than wonder about.
      */}
      <span className="ink-readout" data-backend={backend ?? "starting"}>
        page {page} / {pages} · {strokes} {strokes === 1 ? "stroke" : "strokes"} ·{" "}
        {penSeen ? "pen" : "pointer"} · recognised {Math.round(recognised * 100)} %
        {backend && backend !== "webgl2" ? ` · ${backend}` : ""}
      </span>
    </div>
  );
}
