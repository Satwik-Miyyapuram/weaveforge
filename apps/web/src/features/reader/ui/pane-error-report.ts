import type { AppLogInput } from "../../../lib/error-report/app-log";

/**
 * The app-log line for a reader pane that failed to render. Pure (no wasm core),
 * so the boundary's logging is tested without loading the core.
 */
export function paneErrorReport(label: string, error: Error, componentStack: string): AppLogInput {
  const stack = componentStack.trim();
  return {
    level: "error",
    source: "screen",
    message: `${label} could not be shown`,
    detail: `${error.name}: ${error.message}${stack ? `\n${stack}` : ""}`,
  };
}
