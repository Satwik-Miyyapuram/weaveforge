import { formatError } from "@/lib/format-error";

/**
 * One sign-in action: busy while it runs, its failure shown, the button freed
 * either way. Never rejects, so a click handler can call it without a catch.
 */
export async function runBusy(
  setBusy: (busy: boolean) => void,
  setError: (error: string | null) => void,
  action: () => Promise<void>,
): Promise<void> {
  setBusy(true);
  setError(null);
  try {
    await action();
  } catch (err) {
    setError(formatError(err));
  } finally {
    setBusy(false);
  }
}
