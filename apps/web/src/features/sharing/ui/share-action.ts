import { formatError } from "@/lib/format-error";

/**
 * Run one share-dialog action: mark the dialog busy, clear the old error, and
 * show any failure instead of letting it escape as an unhandled rejection.
 */
export async function runShareAction(
  action: () => Promise<void>,
  ui: { setBusy(busy: boolean): void; setError(error: string | null): void },
): Promise<void> {
  ui.setBusy(true);
  ui.setError(null);
  try {
    await action();
  } catch (e) {
    ui.setError(formatError(e));
  } finally {
    ui.setBusy(false);
  }
}
