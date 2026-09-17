"use client";

/**
 * The bar's choices: the tool in force, and the colour each tool remembers.
 *
 * The pen and the highlighter keep their own colour, because a return from
 * the highlighter should not hand the pen a fluorescent yellow (§6.3). The
 * bar owns no document state — it is handed these and says what the user
 * asked for — so this is the one place that decides what a choice *means*.
 */

import { useCallback, useState } from "react";
import type { InkColour } from "@weaveforge/core";

import type { InkBarTool } from "./ink-bar";

export function useInkPrefs() {
  const [tool, setTool] = useState<InkBarTool | "shape">("pen");
  const [penColour, setPenColour] = useState<InkColour>("text");
  const [highlighterColour, setHighlighterColour] =
    useState<InkColour>("warn");

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
    [tool],
  );

  return { tool, setTool, colour, onColourChange };
}
