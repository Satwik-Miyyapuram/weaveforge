import { logToApp } from "@/lib/error-report/app-log";
import { describeRejection } from "@/lib/format-error";

/** Logs a citation alert check or notification that failed for one paper. */
export function reportCitationAlertError(paperId: string, error: unknown): void {
  logToApp({
    level: "warn",
    source: "citation-alerts",
    message: "A citation alert check or notification failed",
    detail: `${paperId}: ${describeRejection(error)}`,
  });
}
