"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { SHORTCUTS_EVENT, nextShortcutsOpen } from "@/lib/parts-2";

// Loaded on first open: the sheet reuses the workspace's pane view, and a
// static import here shipped that to every page (WF-P07).
const ShortcutsDialog = dynamic(
  () => import("@/features/editor-workspace/ui/shortcuts-dialog").then((m) => m.ShortcutsDialog),
  { ssr: false },
);

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
