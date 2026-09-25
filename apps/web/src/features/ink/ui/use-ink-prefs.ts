"use client";

/**
 * The bar's choices: the tool in force, and the colour each tool remembers.
 *
 * The pen and the highlighter keep their own colour, because a return from
 * the highlighter should not hand the pen a fluorescent yellow (§6.3). The
 * bar owns no document state — it is handed these and says what the user
 * asked for — so this is the one place that decides what a choice *means*.
 */

import { useCallback, useRef, useState } from "react";
import type { InkColour } from "@weaveforge/core";

import type { InkBarTool } from "./ink-bar";

/** The two tools that put ink on paper, as opposed to pointing or erasing. */
export const PEN_MODE_TOOLS = ["pen", "highlighter"] as const;
export type PenModeTool = (typeof PEN_MODE_TOOLS)[number];

/**
 * What picking the pen up should do to the tool in force.
 *
 * The rule, from the product: bringing the pen to the screen selects a pen mode.
 * If one is **already** selected it stays — a highlighter that reverted to the
 * pen on every hover would be unusable, because a hover precedes every stroke.
 * Otherwise it returns to the last pen mode the user chose, so putting the pen
 * down to select something and picking it up again resumes what they were doing
 * rather than resetting to the pen.
 *
 * "Last pen mode" is a separate fact from "the tool in force", and that is the
 * whole subtlety: with the eraser or the lasso up, the tool in force is not a
 * pen mode, so recovering the answer from it is impossible.
 *
 * Pure, and exported, because the reasoning above is the kind that is easy to get
 * subtly wrong and cheap to test.
 */
export function toolOnPenApproach(
  current: InkBarTool | "shape",
  lastPenMode: PenModeTool,
): InkBarTool | "shape" {
  if (current === "pen" || current === "highlighter") return current;
  return lastPenMode;
}

/** Whether a tool is one of the two that draw. */
export function isPenMode(tool: InkBarTool | "shape"): tool is PenModeTool {
  return tool === "pen" || tool === "highlighter";
}

export function useInkPrefs() {
  const [tool, setToolState] = useState<InkBarTool | "shape">("pen");
  const [penColour, setPenColour] = useState<InkColour>("text");
  const [highlighterColour, setHighlighterColour] =
    useState<InkColour>("warn");

  /**
   * The last pen mode the user chose, which is what the pen returns to.
   *
   * Held in a ref rather than as state because nothing renders from it: it is
   * only ever read at the moment the pen arrives, and making it state would add a
   * render per tool change for a value no view shows.
   */
  const lastPenMode = useRef<PenModeTool>("pen");

  const setTool = useCallback((next: InkBarTool | "shape") => {
    if (isPenMode(next)) lastPenMode.current = next;
    setToolState(next);
  }, []);

  /**
   * The pen came near the screen: choose a pen mode, per {@link toolOnPenApproach}.
   *
   * Called from the capture hook's pen path, so it fires for a hover as well as
   * for a pen-down — a stroke that begins without ever selecting the pen tool
   * would be invisible, since ink is gated on the tool in force.
   */
  const onPenApproach = useCallback(() => {
    setToolState((current) => toolOnPenApproach(current, lastPenMode.current));
  }, []);

  /** The colour the current tool draws with, whichever tool that is. */
  const colour = tool === "highlighter" ? highlighterColour : penColour;

  /**
   * A colour is chosen for the tool in force; a choice made for the pen
   * while another tool is up also returns the tool to the pen.
   */
  const onColourChange = useCallback(
    (c: InkColour) => {
      if (tool === "highlighter") {
        setHighlighterColour(c);
      } else {
        setPenColour(c);
        if (tool !== "pen") setTool("pen");
      }
    },
    [tool, setTool],
  );

  return { tool, setTool, colour, onColourChange, onPenApproach };
}
