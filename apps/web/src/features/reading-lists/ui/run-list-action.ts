import { formatError } from "@/lib/format-error";

/**
 * Run one list action with its failure shown rather than thrown: the error is
 * cleared first and set to the failure's message if it fails. Never rejects,
 * so a click handler can `void` it. True when the action succeeded.
 */
export async function runListAction(
  action: () => Promise<void>,
  setError: (error: string | null) => void,
): Promise<boolean> {
  setError(null);
  try {
    await action();
    return true;
  } catch (err) {
    setError(formatError(err));
    return false;
  }
}
