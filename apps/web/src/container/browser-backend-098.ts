/**
 * The 0.9.8 browser and Android backend. Personal data lives in OPFS only once the
 * 0.9.7 migration reports `verified` with an OPFS target. Any other report sends the
 * user to "Export your data in 0.9.7 first"; the browser never writes personal data
 * to PostgREST in 0.9.8.
 */
export type BrowserBackendChoice = "files" | "export-first";

export function opfsVerified(report: unknown): boolean {
  if (typeof report !== "object" || report === null) return false;
  const r = report as { state?: unknown; target?: unknown };
  return r.state === "verified" && r.target === "opfs";
}

export function chooseBrowserBackend(report: unknown): BrowserBackendChoice {
  return opfsVerified(report) ? "files" : "export-first";
}
