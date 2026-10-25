import type { AppLogInput } from "../app-log";

/**
 * Runs `run` with a stub desktop bridge that records every `logToApp` line, then
 * restores whatever `window` was there before.
 */
export async function withAppLogs<T>(run: (logs: AppLogInput[]) => T | Promise<T>): Promise<T> {
  const g = globalThis as { window?: unknown };
  const original = g.window;
  const logs: AppLogInput[] = [];
  g.window = {
    ...(original as object | undefined),
    weaveforge: { fetchTitle: () => Promise.resolve({}), reportAppLog: (entry: AppLogInput) => void logs.push(entry) },
  };
  try {
    return await run(logs);
  } finally {
    g.window = original;
  }
}
