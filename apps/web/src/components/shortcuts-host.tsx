"use client";

import { useEffect, useState } from "react";
import { ShortcutsDialog } from "@/features/editor-workspace/ui/shortcuts-dialog";
import { SHORTCUTS_EVENT, nextShortcutsOpen } from "@/lib/palette-actions";

/** The one keyboard shortcuts sheet: `⌘/` in the workspace, Help menu and palette all open it. */
export function ShortcutsHost() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onRequest = (event: Event) => setOpen((now) => nextShortcutsOpen(now, (event as CustomEvent).detail));
    window.addEventListener(SHORTCUTS_EVENT, onRequest);
    return () => window.removeEventListener(SHORTCUTS_EVENT, onRequest);
  }, []);
  return open ? <ShortcutsDialog onClose={() => setOpen(false)} /> : null;
}
