import { logToApp } from "@/lib/error-report/app-log";
import { formatError } from "@/lib/format-error";
import { readyCore } from "@/lib/rust-core";

// --- issue-url ---
/**
 * A prefilled "new issue" address, for a copy of the app that cannot file one.
 *
 * The packaged desktop app is a static export: there is no server, so there is
 * no `/api/report-issue` and no token to file with. A web deployment without
 * `GITHUB_ISSUES_TOKEN` is in the same place. Both can still hand the report to
 * GitHub's own form: the reader lands on it signed in as themselves, sees the
 * whole report, and presses Submit there. Nothing is posted until they do.
 *
 * The address and body are built in Rust (`wf_core::error_report::issue_url`);
 * this module only picks the repo from the build environment.
 */
/** Where reports go when nothing overrides it; the route uses the same repo. */
export const DEFAULT_REPORT_REPO = "Satwik-Miyyapuram/weaveforge";

export function reportRepo(): string {
  const configured = process.env.NEXT_PUBLIC_REPORT_REPO?.trim();
  return configured && /^[\w.-]+\/[\w.-]+$/.test(configured) ? configured : DEFAULT_REPORT_REPO;
}

export function newIssueUrl(input: { title: string; body: string; repo?: string }): string {
  return readyCore().newIssueUrl(input.title, input.body, input.repo ?? reportRepo());
}

// --- warn-once ---
const seen = new Set<string>();

/**
 * Log a best-effort failure the first time it happens in this session. A write
 * that fails once fails on every save, and one line says as much as a thousand.
 */
export function warnOnce(source: string, message: string, err: unknown): void {
  const key = `${source}:${message}`;
  if (seen.has(key)) return;
  seen.add(key);
  logToApp({ level: "warn", source, message, detail: formatError(err) });
}
