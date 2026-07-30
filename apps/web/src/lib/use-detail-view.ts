"use client";

import { usePathname, useSearchParams } from "next/navigation";

/**
 * True when the current route is an individual detail view — a single paper,
 * note, or experiment — rather than a list.
 *
 * On these the sub-tab strip and the swipe-between-tabs gesture are noise: the
 * detail has its own header and Back control, and a horizontal swipe over a
 * paper should not flip the user to Lists or Graph. The shell hides that chrome
 * and disables the gesture when this is true.
 *
 * Detail state is URL-driven per feature:
 *   - papers:      /papers?paper=<id>
 *   - notes/vault: /notes?page=<id>
 *   - experiments: /experiments/<id>   (a distinct route, not the list)
 */
export function useIsDetailView(): boolean {
  const pathname = usePathname() ?? "";
  const params = useSearchParams();

  if (pathname.startsWith("/papers") && params.get("paper")) return true;
  if (pathname.startsWith("/notes") && params.get("page")) return true;
  // /experiments/<id> — a segment after the base path. The bare list is
  // "/experiments" (optionally with a query string), never "/experiments/".
  if (/^\/experiments\/[^/?#]+/.test(pathname)) return true;

  return false;
}
