import { logToApp } from "@/lib/error-report/app-log";
import { formatError } from "@/lib/format-error";

/**
 * Run one sync decision (resolve, retry, discard). A failure is logged and
 * handed to `setError` for the panel to show; it never rejects, so a click
 * handler can fire it with `void`.
 */
export async function runSyncAction(
  action: () => Promise<unknown>,
  setError: (error: string | null) => void,
): Promise<void> {
  setError(null);
  try {
    await action();
  } catch (err) {
    const detail = formatError(err);
    logToApp({ level: "warn", source: "offline-sync", message: "A sync decision could not be saved", detail });
    setError(`That could not be saved: ${detail}`);
  }
}
