import type { WorkshopProject } from "@/features/overleaf/infrastructure/workshop-session-client";
import type { LinkedReport } from "../ui/linked-overleaf-api";

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
  const rows = new Map<string, OverleafProjectRow>();
  for (const p of account ?? []) rows.set(p.id, { id: p.id, name: p.name, inAccount: true, report: null });
  for (const r of linked) {
    const row = rows.get(r.overleaf_project_id);
    if (!row) rows.set(r.overleaf_project_id, { id: r.overleaf_project_id, name: r.title, inAccount: false, report: r });
    else if (!row.report) row.report = r;
  }
  return [...rows.values()].sort(
    (a, b) => Number(!!b.report) - Number(!!a.report) || a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
}

/** Rows whose name or linked title contains the query. */
export function filterOverleafProjects(rows: readonly OverleafProjectRow[], query: string): OverleafProjectRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...rows];
  return rows.filter((r) => r.name.toLowerCase().includes(q) || !!r.report?.title.toLowerCase().includes(q));
}

/** The rows the list shows: linked ones always, account ones only if picked. Null `picked` (nothing chosen yet) shows all. */
export function pickedOverleafProjects(rows: readonly OverleafProjectRow[], picked: ReadonlySet<string> | null): OverleafProjectRow[] {
  return picked ? rows.filter((r) => r.report || picked.has(r.id)) : [...rows];
}
