import { useCallback, useEffect, useState } from "react";
import { authHeaders } from "@/lib/auth-headers";
import { formatError } from "@/lib/format-error";
import { type LinkedReport, type ReportContent, local, api } from "./linked-overleaf-api";

/** Where linked reports (git-token links) are kept: the local database and shell, or the app's API. */
export interface LinkedReportsGateway {
  list(projectId: string): Promise<LinkedReport[]>;
  unlink(id: string): Promise<void>;
  setTargets(id: string, targets: Record<string, number>): Promise<void>;
  readContent(report: LinkedReport): Promise<ReportContent>;
}

export const linkedReportsGateway: LinkedReportsGateway = {
  async list(projectId) {
    const gateway = local();
    const rows = gateway
      ? await gateway.listReports(projectId)
      : ((await api(`/api/overleaf/reports?projectId=${encodeURIComponent(projectId)}`)).reports ?? []);
    return (rows as LinkedReport[]).filter((report) => report.project_id === projectId);
  },
  async unlink(id) {
    const gateway = local();
    if (gateway) await gateway.deleteReport(id);
    else await api(`/api/overleaf/reports?id=${encodeURIComponent(id)}`, { method: "DELETE" });
  },
  async setTargets(id, sectionTargets) {
    const gateway = local();
    if (gateway) await gateway.patchReport({ id, sectionTargets });
    else await api("/api/overleaf/reports", { method: "PATCH", body: JSON.stringify({ id, sectionTargets }) });
  },
  async readContent(report) {
    const gateway = local();
    if (gateway) return (await gateway.readContent(report)) as ReportContent;
    const response = await fetch(`/api/overleaf/reports/${encodeURIComponent(report.id)}/content`, { headers: await authHeaders(), cache: "no-store" });
    const payload = (await response.json()) as ReportContent & { error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Could not fetch the Overleaf report.");
    return payload;
  },
};

/** The linked reports of one WeaveForge project. */
export function useLinkedReports(projectId: string | null, gateway: LinkedReportsGateway) {
  const [reports, setReports] = useState<LinkedReport[]>([]);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    if (!projectId) { setReports([]); return; }
    try {
      setReports(await gateway.list(projectId));
      setError("");
    } catch (err) { setError(formatError(err)); }
  }, [projectId, gateway]);
  useEffect(() => { void reload(); }, [reload]);

  /** Removes the link row only; the Overleaf project is never touched. */
  async function unlink(report: LinkedReport): Promise<boolean> {
    setError("");
    try {
      await gateway.unlink(report.id);
      await reload();
      return true;
    } catch (err) { setError(formatError(err)); return false; }
  }

  /** Saves one report's word targets; the row updates once saved. */
  async function saveTargets(report: LinkedReport, targets: Record<string, number>): Promise<boolean> {
    try {
      await gateway.setTargets(report.id, targets);
      setReports((rs) => rs.map((r) => (r.id === report.id ? { ...r, section_targets: targets } : r)));
      return true;
    } catch (err) { setError(formatError(err)); return false; }
  }

  return { reports, error, setError, reload, unlink, saveTargets };
}
