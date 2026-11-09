/**
 * Dashboard stats rules (Rust `dashboard::stats`), re-exported from index.ts. Each function
 * is an unchecked cast of the raw export; the typed signatures live in
 * packages/core/src/features/dashboard/domain/dashboard-stats.ts.
 */
import {
  dashboardNeedsAttention as rawNeedsAttention,
  dashboardSuperviseeCounts as rawSuperviseeCounts,
  dashboardTeamAttention as rawTeamAttention,
  dashboardTopTags as rawTopTags,
} from "../pkg/wf_wasm.js";

export function dashboardNeedsAttention<Item>(
  papers: unknown,
  milestones: unknown,
  experiments: unknown,
  today: string,
): Item[] {
  return rawNeedsAttention(papers, milestones, experiments, today) as Item[];
}

export function dashboardTopTags<Tag>(tags: unknown, limit: number): Tag[] {
  return rawTopTags(tags, limit) as Tag[];
}

export function dashboardSuperviseeCounts<Counts>(
  milestones: unknown,
  logs: unknown,
  today: string,
): Counts {
  return rawSuperviseeCounts(milestones, logs, today) as Counts;
}

export function dashboardTeamAttention<Item>(supervisees: unknown, today: string): Item[] {
  return rawTeamAttention(supervisees, today) as Item[];
}
