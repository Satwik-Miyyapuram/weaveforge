import type { WorkshopProject } from "@/features/overleaf/infrastructure/workshop-session-client";
import type { LinkedReport } from "../ui/linked-overleaf-api";
import { readyCore } from "@/lib/rust-core";

/** One Overleaf project in the tab's list: from the signed-in account, linked to this project, or both. */
export interface OverleafProjectRow {
  /** The Overleaf project id. */
  id: string;
  name: string;
  /** The signed-in account can open it (live editing and the PDF need this). */
  inAccount: boolean;
  /** Its link to this WeaveForge project (git token), if any. */
  report: LinkedReport | null;
}

/** Account projects and linked reports as one list, matched on the Overleaf id; linked first, then by name. */
export function mergeOverleafProjects(account: readonly WorkshopProject[] | null, linked: readonly LinkedReport[]): OverleafProjectRow[] {
  const rows: OverleafProjectRow[] = readyCore()
    .mergeOverleafProjects(account ?? [], linked)
    .map((m) => ({ id: m.id, name: m.name, inAccount: m.inAccount, report: m.linkedIndex === null ? null : (linked[m.linkedIndex] ?? null) }));
  return rows.sort(
    (a, b) => Number(!!b.report) - Number(!!a.report) || a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
}

/** Rows whose name or linked title contains the query. */
export function filterOverleafProjects(rows: readonly OverleafProjectRow[], query: string): OverleafProjectRow[] {
  return rows.filter((r) => readyCore().overleafProjectMatches(r.name, r.report?.title ?? null, query));
}

/** The rows the list shows: linked ones always, account ones only if picked. Null `picked` (nothing chosen yet) shows all. */
export function pickedOverleafProjects(rows: readonly OverleafProjectRow[], picked: ReadonlySet<string> | null): OverleafProjectRow[] {
  if (!picked) return [...rows];
  const ids = [...picked];
  return rows.filter((r) => readyCore().overleafProjectShown(!!r.report, r.id, ids));
}
