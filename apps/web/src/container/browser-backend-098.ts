/**
 * The 0.9.8 browser and Android backend choice. Personal data is read from OPFS files only when
 * the device has no legacy PostgREST data, or when the 0.9.7 export is verified in OPFS. Anything
 * unknown fails closed to "export first".
 */
export type BrowserBackendChoice = "files" | "export-first";

/** Verified means: state "verified", target "opfs", and an empty `missing` list. Any other shape is not verified. */
export function reportIsVerifiedOpfs(report: unknown): boolean {
  if (typeof report !== "object" || report === null) return false;
  const r = report as { state?: unknown; target?: unknown; missing?: unknown };
  return r.state === "verified" && r.target === "opfs" && Array.isArray(r.missing) && r.missing.length === 0;
}

/**
 * `legacyDataPresent` false (fresh install) → files, the report is not read.
 * `true` → files only when `reportVerified()` is true, otherwise export first.
 * `"unknown"` → export first, whatever the report says.
 */
export function chooseBrowserBackend(
  legacyDataPresent: boolean | "unknown",
  reportVerified: () => boolean,
): BrowserBackendChoice {
  if (legacyDataPresent === false) return "files";
  if (legacyDataPresent === "unknown") return "export-first";
  return reportVerified() ? "files" : "export-first";
}
