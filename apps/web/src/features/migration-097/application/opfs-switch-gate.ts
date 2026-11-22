import { runWebExport, type ExportOptions, type ExportResult } from "./run-web-export";

/**
 * The 0.9.8 switch to OPFS. A 0.9.7 report is never trusted on its own: every switch
 * re-runs the web export from the server. `runWebExport` verifies the fresh run
 * (`verifyExport`) before it reports `verified`, so `switch` is true only for a
 * fresh, verified run. Any other state keeps the old path and the retry banner.
 */
export async function gateOpfsSwitch(
  opts: ExportOptions,
): Promise<{ switch: boolean; result: ExportResult }> {
  const result = await runWebExport(opts);
  return { switch: result.state === "verified" || result.readyToMark === true, result };
}
