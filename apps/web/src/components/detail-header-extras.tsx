"use client";

/**
 * What the app shell adds to a detail view's own header. On a phone a detail
 * view hides the shell's top bar, so the shell hands its status (the git sync
 * dot) down through this, and the header shows it beside its own actions.
 *
 * Here rather than in the workspace feature because each detail view lives in
 * its own feature, and a feature reaching into another's `ui/` fails
 * `check:solid`.
 */

import { createContext, useContext, type ReactNode } from "react";

/** null: nothing to add, as on a desktop, where the sidebar shows it. */
export const DetailHeaderExtrasContext = createContext<ReactNode>(null);

export function DetailHeaderExtras() {
  return <>{useContext(DetailHeaderExtrasContext)}</>;
}
