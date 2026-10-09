import { isOfflineBuild } from "@/deployment/build-target";

/**
 * Where an experiment opens.
 *
 * The served app has a page per experiment. The desktop bundle cannot: a static
 * export needs every path at build time, and experiment ids are made at run
 * time by whatever is training. So there the same experiment opens *on* the
 * list, as `?experiment=<id>`, and the list shows the detail over itself.
 *
 * One function rather than a branch at each link, because a link that guessed
 * wrong is a 404 in a shell with no back-end to explain it.
 */
export function experimentHref(id: string): string {
  return isOfflineBuild()
    ? `/experiments/?experiment=${encodeURIComponent(id)}`
    : `/experiments/${id}`;
}

/** Where "close the detail" goes. */
export const EXPERIMENTS_HREF = "/experiments/";
