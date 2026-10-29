import { useCallback } from "react";

import type { InkColour } from "@weaveforge/core";

import { setToolQuickSlot, useToolColours, type ToolColourId } from "./use-tool-colours";

/** One tool's five quick colours, and a setter for one slot that remembers it on this device. */
export function useQuickColours(
  tool: ToolColourId = "pen",
): [InkColour[], (slot: number, colour: InkColour) => void] {
  const quick = useToolColours()[tool].quick;
  const setSlot = useCallback(
    (slot: number, colour: InkColour) => setToolQuickSlot(tool, slot, colour),
    [tool],
  );
  return [quick, setSlot];
}
