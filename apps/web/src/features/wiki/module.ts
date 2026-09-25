import type { FeatureModule } from "@weaveforge/core";

/**
 * The wiki is an action, not a place.
 *
 * It reads the papers and the notes together and proposes pages from them (see
 * `wikiSourceDocuments`), which made it the odd one out in a Library strip whose
 * other entries were things you *have*. It is now a button beside "+ Paper" and
 * "New note" — the same row as the other ways of adding something — and the two
 * buttons lead to this one screen.
 */
export const wikiModule: FeatureModule = {
  id: "wiki",
  title: "Wiki",
  navGroup: "library",
  navItems: [],
  routes: [{ path: "/wiki", component: "wiki/WikiScreen" }],
};
