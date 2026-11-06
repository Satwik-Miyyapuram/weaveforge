import { useCallback, useEffect, useState } from "react";
import { formatError } from "@/lib/format-error";
import { type LinkedReport, local, api } from "./linked-overleaf-api";

/** Where linked reports (git-token links) are kept: the local database and shell, or the app's API. */
export interface LinkedReportsGateway {
  list(projectId: string): Promise<LinkedReport[]>;
  unlink(id: string): Promise<void>;
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

  return { reports, error, setError, reload, unlink };
}
