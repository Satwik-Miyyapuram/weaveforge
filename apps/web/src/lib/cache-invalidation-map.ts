/**
 * Scoped cache invalidation map (cache-invalidation-scoping-plan.md).
 */

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
  { repos: readonly ResourceType[]; screens: readonly string[] }
> = {
  paper: { repos: ["paper", "paper_relation", "tag", "paper_tag", "reading_list_item"], screens: ["papers", "graph", "lists", "dashboard"] },
  vault_page: { repos: ["vault_page", "paper_relation", "reading_list_item"], screens: ["vault", "notes", "graph", "lists", "dashboard"] },
  reading_list: { repos: ["reading_list", "reading_list_item"], screens: ["lists", "papers", "vault", "dashboard"] },
  reading_list_item: { repos: ["reading_list_item", "reading_list"], screens: ["lists", "papers", "vault", "dashboard"] },
  log_entry: { repos: ["log_entry"], screens: ["logbook", "dashboard"] },
  report_section: { repos: ["report_section"], screens: ["report", "dashboard"] },
  experiment: { repos: ["experiment"], screens: ["experiments", "dashboard"] },
  milestone: { repos: ["milestone"], screens: ["plan", "dashboard"] },
  paper_relation: { repos: ["paper_relation"], screens: ["graph", "dashboard"] },
  tag: { repos: ["tag", "paper_tag", "paper"], screens: ["papers", "graph", "dashboard"] },
  paper_tag: { repos: ["tag", "paper_tag", "paper"], screens: ["papers", "graph", "dashboard"] },
  comment: { repos: ["comment"], screens: [] },
  share: { repos: ["share"], screens: ["shared-with-me", "dashboard"] },
  library_pin: { repos: ["library_pin"], screens: ["papers", "lists", "dashboard"] },
  citation_alert_track: { repos: ["citation_alert_track"], screens: ["papers", "logbook"] },
  project: { repos: ["project"], screens: ["dashboard"] },
  dashboard_layout: { repos: ["dashboard_layout"], screens: ["dashboard"] },
  graph_settings: { repos: ["graph_settings"], screens: ["graph", "dashboard"] },
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
