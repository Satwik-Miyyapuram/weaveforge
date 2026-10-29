import { logToApp } from "@/lib/error-report/app-log";

/**
 * One explorer section's load, isolated: a section that fails falls back (and
 * so hides) without taking the others down, and the failure is logged rather
 * than vanishing.
 */
export function sectionOr<T, F>(load: Promise<T>, section: string, fallback: F): Promise<T | F> {
  return load.catch((err: unknown) => {
    logToApp({
      level: "warn",
      source: "workspace",
      message: `The ${section} section could not load`,
      detail: err instanceof Error ? err.message : String(err),
    });
    return fallback;
  });
}
