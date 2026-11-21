import { errorMessage } from "@weaveforge/core";

/**
 * Runs a user action (a copy, an export, a remove) and reports its failure
 * through `onError` as `what: reason`, never leaving it as an unhandled
 * rejection with nothing on screen (F97-P2-30, F97-P2-31).
 */
export async function reportFailure(
  action: () => Promise<unknown>,
  what: string,
  onError: (message: string) => void,
): Promise<void> {
  try {
    await action();
  } catch (error) {
    onError(`${what}: ${errorMessage(error)}`);
  }
}
