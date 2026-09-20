import { screenForPath } from "@/lib/screen-for-path";
import type { ScreenId } from "@/lib/screens";

/**
 * Warm screen data on tab hover (Phase 3).
 *
 * The switch is exhaustive over {@link ScreenId}: a screen added to the registry
 * without a case here falls through to the `never` assertion and stops
 * compiling, which is the one thing the three hand-kept lists could not do.
 * Whether a screen *should* prefetch is a decision — one with nothing worth
 * warming belongs in the `no-prefetch` group below, not in a missing case.
 */
export function prefetchScreenForPath(pathname: string): void {
  const screen = screenForPath(pathname);
  if (!screen) return;

  void import("@/bootstrap").then(async ({ ensureContainer }) => {
    const c = await ensureContainer();
    switch (screen) {
      case "papers":
        void c.papers.loadScreenData();
        break;
      case "vault":
        void c.vault.loadScreenData();
        break;
      case "graph":
        void c.graph.loadScreenData();
        break;
      case "lists":
        void c.readingLists.loadScreenData();
        break;
      case "experiments":
        void c.experiments.loadScreenData();
        break;
      case "plan":
        void c.plan.loadScreenData();
        break;
      case "logbook":
        void c.logbook.loadEntries();
        break;
      case "report":
        void c.report.loadScreenData();
        break;
      case "report-overleaf":
        // The Overleaf tab renders the report screen's data under its own cache
        // key, plus the full paper rows its export needs. Warming one key does
        // not warm the other, so both loads are started.
        void c.report.loadScreenData();
        void c.papers.listPapers();
        break;
      case "shared-with-me":
        void c.sharing.loadSharedWithMeScreen();
        break;
      default:
        // Every ScreenId is handled above; this only type-checks while that
        // stays true.
        screen satisfies never;
        break;
    }
  });
}
