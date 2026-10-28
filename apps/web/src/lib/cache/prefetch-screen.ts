import type { AppContainer } from "@/container/facades";
import { screenForPath } from "@/lib/screen-for-path";
import type { ScreenId } from "@/lib/screens";

/**
 * Warm screen data on tab hover (Phase 3).
 *
 * Prefetch is a best-effort guess, so a failed warm-up stays silent: the
 * screen reports its own failure when it is opened.
 */
export function prefetchScreenForPath(pathname: string): void {
  const screen = screenForPath(pathname);
  if (!screen) return;

  void import("@/bootstrap")
    .then(({ ensureContainer }) => ensureContainer())
    .then((c) => warmScreen(c, screen))
    .catch(() => {});
}

/**
 * Start the loads a screen renders from and return them, so the caller owns
 * any failure.
 *
 * The switch is exhaustive over {@link ScreenId}: a screen added to the registry
 * without a case here falls through to the `never` assertion and stops
 * compiling, which is the one thing the three hand-kept lists could not do.
 * Whether a screen *should* prefetch is a decision — one with nothing worth
 * warming belongs in the `no-prefetch` group below, not in a missing case.
 */
export function warmScreen(c: AppContainer, screen: ScreenId): Promise<unknown> {
  switch (screen) {
    case "papers":
      return c.papers.loadScreenData();
    case "vault":
      return c.vault.loadScreenData();
    case "graph":
      return c.graph.loadScreenData();
    case "lists":
      return c.readingLists.loadScreenData();
    case "experiments":
      return c.experiments.loadScreenData();
    case "plan":
      return c.plan.loadScreenData();
    case "logbook":
      return c.logbook.loadEntries();
    case "report":
      return c.report.loadScreenData();
    case "report-overleaf":
      // The Overleaf tab renders the report screen's data under its own cache
      // key, plus the full paper rows its export needs. Warming one key does
      // not warm the other, so both loads are started.
      return Promise.all([c.report.loadScreenData(), c.papers.listPapers()]);
    case "shared-with-me":
      return c.sharing.loadSharedWithMeScreen();
    default:
      // Every ScreenId is handled above; this only type-checks while that
      // stays true.
      screen satisfies never;
      return Promise.resolve();
  }
}
