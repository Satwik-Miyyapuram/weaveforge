"use client";

import { usePathname } from "next/navigation";

/** The editor workspace route, the one screen the shell renders full-bleed. */
export const WORKSPACE_PATH = "/workspace";

/**
 * True on the editor workspace route.
 *
 * `/workspace` is the one screen that is a workspace rather than a page: it
 * owns the whole window (a 48px icon rail, its own explorer, panes down to a
 * status bar on the bottom edge). The shell therefore changes shape there —
 * the primary nav renders as the rail, the content gets no padding and no
 * sub-nav strip, and the screen sizes itself against `100dvh` instead of
 * against a horizontal inset token.
 *
 * Deliberately reads `usePathname` rather than the nav-pending effective path:
 * the shell must not go full-bleed while a navigation *towards* `/workspace`
 * is still in flight, or the screen being left would collapse on its way out.
 */
export function useWorkspaceRoute(): boolean {
  const pathname = usePathname() ?? "";
  return pathname === WORKSPACE_PATH || pathname.startsWith(`${WORKSPACE_PATH}/`);
}
