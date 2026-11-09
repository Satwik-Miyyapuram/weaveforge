import type { ShareableType } from "@weaveforge/core";
import type { SharedItem } from "../domain/shared-reader";
import { readyCore } from "@/lib/rust-core";

/** Per-type row mapping: which table, and which columns hold the title/status. */
export const SHARED_SOURCES: Record<
  ShareableType,
  { table: string; title: string; status: string | null }
> = {
  milestone: { table: "milestones", title: "title", status: "status" },
  experiment: { table: "experiments", title: "name", status: "status" },
  report_section: { table: "report_sections", title: "title", status: "status" },
  reading_list: { table: "reading_lists", title: "name", status: null },
  paper: { table: "papers", title: "title", status: "status" },
  vault_page: { table: "vault_pages", title: "title", status: null },
};

/**
 * Shape one row into a `SharedItem`.
 *
 * Shared by the PostgREST and Postgres readers deliberately: they differ in how
 * they *fetch* — PostgREST `.or()` filters against SQL `any($n::uuid[])` — but
 * a shared item must look identical whichever backend produced it, and this
 * mapping had drifted into two copies of the same twelve lines.
 */
export function toSharedItem(kind: ShareableType, row: Record<string, unknown>): SharedItem {
  return readyCore().sharedItem(kind, row, SHARED_SOURCES[kind]);
}
