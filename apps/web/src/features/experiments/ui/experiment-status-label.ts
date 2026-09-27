import type { ExperimentStatus } from "@weaveforge/core";

/** A status as the UI shows it: sentence case, never the stored lowercase key. */
export function experimentStatusLabel(status: ExperimentStatus): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}
