import { logToApp } from "@/lib/error-report/app-log";
import { formatError } from "@/lib/format-error";

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
