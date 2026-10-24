import { logToApp, type AppLogInput } from "@/lib/error-report/app-log";

/**
 * Run a service-worker side task whose failure must not affect startup, and
 * log the failure so it is not silent.
 */
export async function bestEffort(
  message: string,
  task: () => Promise<unknown> | unknown,
  log: (input: AppLogInput) => void = logToApp,
): Promise<void> {
  try {
    await task();
  } catch (err) {
    log({
      level: "warn",
      source: "service-worker",
      message,
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}
