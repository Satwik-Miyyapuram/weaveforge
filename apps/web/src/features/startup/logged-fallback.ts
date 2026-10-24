import { logToApp } from "@/lib/error-report/app-log";
import { formatError } from "@/lib/format-error";

/**
 * A `.catch` handler for a startup read that may fail without failing startup:
 * logs what did not load and answers `fallback` in its place.
 */
export function loggedFallback<T>(what: string, fallback: T): (error: unknown) => T {
  return (error) => {
    logToApp({ level: "warn", source: "startup", message: `${what} did not load.`, detail: formatError(error) });
    return fallback;
  };
}
