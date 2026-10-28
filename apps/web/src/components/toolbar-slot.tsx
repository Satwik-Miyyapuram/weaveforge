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

/** `inline` keeps the bar in place even in the Editor (the reader's own focus). */
export function ToolbarSlot({ children, inline = false }: { children: ReactNode; inline?: boolean }) {
  const slot = useContext(ToolbarSlotContext);
  if (slot === undefined || inline) return <>{children}</>;
  return slot ? createPortal(children, slot) : null;
}
