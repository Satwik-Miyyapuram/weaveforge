import { logToApp } from "@/lib/error-report/app-log";
import { formatError } from "@/lib/format-error";

/**
 * One click on a note — pin, delete, remove a tag: busy while it runs, its
 * failure shown and logged, the button freed either way. Never rejects, so a
 * click handler can call it without a catch; the result says whether to go on
 * (close the note, refresh the list).
 */
export async function runNoteAction(
  setBusy: (busy: boolean) => void,
  setError: (error: string | null) => void,
  action: () => Promise<unknown>,
): Promise<boolean> {
  setBusy(true);
  setError(null);
  try {
    await action();
    return true;
  } catch (err) {
    const detail = formatError(err);
    logToApp({ level: "warn", source: "vault", message: "A note change could not be saved", detail });
    setError(detail);
    return false;
  } finally {
    setBusy(false);
  }
}
