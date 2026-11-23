import { useCallback, useEffect, useState } from "react";
import { formatError } from "@/lib/format-error";
import type { LinkedReport } from "./linked-overleaf-api";

/** Where linked reports (git-token links made before 0.9.8) are kept. No new ones are made. */
export interface LinkedReportsGateway {
  list(projectId: string): Promise<LinkedReport[]>;
  unlink(id: string): Promise<void>;
}

/**
 * 0.9.8 keeps no Git links anywhere: the relay's /api/overleaf/reports and
 * /connections answer 410, and a copy with no account has no local database.
 * So there are no rows to list. Overleaf sign-in (the
 * workshop routes) is unaffected.
 */
export const linkedReportsGateway: LinkedReportsGateway = {
  list: async () => [],
  unlink: async () => { throw new Error("Git links to Overleaf are no longer kept."); },
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
