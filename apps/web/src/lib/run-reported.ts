import { formatError } from "@/lib/format-error";

/**
 * Run a screen action and show its failure instead of leaving it unhandled:
 * an error goes to `onError` as a message. `settle` runs either way, e.g. to
 * clear a busy flag or reload. Resolves whether the action succeeded.
 */
export async function runReported(
  action: () => Promise<unknown>,
  onError: (message: string) => void,
  settle?: () => void,
): Promise<boolean> {
  try {
    await action();
    return true;
  } catch (err) {
    onError(formatError(err));
    return false;
  } finally {
    settle?.();
  }
}
