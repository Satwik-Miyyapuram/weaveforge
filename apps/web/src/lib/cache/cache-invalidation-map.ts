/**
 * Scoped cache invalidation map (cache-invalidation-scoping-plan.md).
 *
 * `screens` is typed as {@link ScreenId}, so a name that is not a real screen is
 * a compile error rather than a delete of a key nothing ever wrote.
 */

import type { ScreenId } from "@/lib/screens";

export type ResourceType =
  | "paper"
  | "vault_page"
  | "reading_list"
  | "reading_list_item"
  | "log_entry"
  | "report_section"
  | "experiment"
  | "milestone"
  | "paper_relation"
  | "tag"
  | "paper_tag"
  | "comment"
  | "share"
  | "library_pin"
  | "citation_alert_track"
  | "project"
  | "dashboard_layout"
  | "graph_settings";

export const WRITE_INVALIDATION_MAP: Record<
  ResourceType,
  { repos: readonly ResourceType[]; screens: readonly ScreenId[] }
> = {
  paper: { repos: ["paper", "paper_relation", "tag", "paper_tag", "reading_list_item"], screens: ["papers", "graph", "lists"] },
  vault_page: { repos: ["vault_page", "paper_relation", "reading_list_item"], screens: ["vault", "graph", "lists"] },
  reading_list: { repos: ["reading_list", "reading_list_item"], screens: ["lists", "papers", "vault"] },
  reading_list_item: { repos: ["reading_list_item", "reading_list"], screens: ["lists", "papers", "vault"] },
  log_entry: { repos: ["log_entry"], screens: ["logbook"] },
  report_section: { repos: ["report_section"], screens: ["report", "report-overleaf"] },
  experiment: { repos: ["experiment"], screens: ["experiments"] },
  milestone: { repos: ["milestone"], screens: ["plan"] },
  paper_relation: { repos: ["paper_relation"], screens: ["graph"] },
  tag: { repos: ["tag", "paper_tag", "paper"], screens: ["papers", "graph"] },
  paper_tag: { repos: ["tag", "paper_tag", "paper"], screens: ["papers", "graph"] },
  comment: { repos: ["comment"], screens: [] },
  share: { repos: ["share"], screens: ["shared-with-me"] },
  library_pin: { repos: ["library_pin"], screens: ["papers", "lists"] },
  citation_alert_track: { repos: ["citation_alert_track"], screens: ["papers", "logbook"] },
  // A project or its dashboard layout changing is not a *screen* cache's
  // business: the dashboard has its own facade and never calls `useScreenData`,
  // so these two named a name nothing wrote.
  project: { repos: ["project"], screens: [] },
  dashboard_layout: { repos: ["dashboard_layout"], screens: [] },
  graph_settings: { repos: ["graph_settings"], screens: ["graph"] },
};

export function isScopedCacheInvalidationEnabled(): boolean {
  if (typeof process !== "undefined" && process.env.SCOPED_CACHE_INVALIDATION === "0") {
    return false;
  }
  return true;
}

export function isKnownResourceType(value: string): value is ResourceType {
  return value in WRITE_INVALIDATION_MAP;
}
