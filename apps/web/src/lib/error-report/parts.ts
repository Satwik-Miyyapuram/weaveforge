import { logToApp } from "@/lib/error-report/app-log";
import { formatError } from "@/lib/format-error";
import { readyCore } from "@/lib/rust-core";

// --- report-repo ---
/**
 * The repo reports are filed to. The build environment supplies it; Rust picks
 * the default when it is missing or malformed (`wf_core::error_report::report_repo`).
 * `process.env.NEXT_PUBLIC_REPORT_REPO` must stay a literal read for Next.js to inline it.
 */
export function reportRepo(): string {
  return readyCore().reportRepo(process.env.NEXT_PUBLIC_REPORT_REPO);
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
