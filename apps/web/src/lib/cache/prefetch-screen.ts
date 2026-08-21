import { screenForPath } from "@/lib/screen-for-path";

/** Warm screen data on tab hover (Phase 3). */
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
      case "shared-with-me":
        void c.sharing.loadSharedWithMeScreen();
        break;
      default:
        break;
    }
  });
}
