"use client";

/**
 * Where a document's own tools go. In the Editor they sit in the one toolbar
 * on top, and only the focused document's show; anywhere else a document keeps
 * its bar above itself.
 *
 * Here rather than in the editor workspace because the ink feature renders
 * into it, and a feature reaching into another's `ui/` fails `check:solid`.
 */

import { createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** undefined: not in the Editor. null: in it, but not the focused document. */
export const ToolbarSlotContext = createContext<HTMLElement | null | undefined>(undefined);

export function ToolbarSlot({ children }: { children: ReactNode }) {
  const slot = useContext(ToolbarSlotContext);
  if (slot === undefined) return <>{children}</>;
  return slot ? createPortal(children, slot) : null;
}
