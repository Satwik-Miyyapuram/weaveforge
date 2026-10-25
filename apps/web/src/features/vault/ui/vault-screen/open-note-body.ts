import type { VaultPage } from "@weaveforge/core";

import { logToApp } from "@/lib/error-report/app-log";
import { formatError } from "@/lib/format-error";

/**
 * The full note behind a summary, or why it cannot be shown. Without an error
 * the screen would sit on "Opening note…" for good.
 */
export async function openNoteBody(
  getPage: (id: string) => Promise<VaultPage | null>,
  id: string,
): Promise<{ page: VaultPage | null; error: string | null }> {
  try {
    const page = await getPage(id);
    return page ? { page, error: null } : { page: null, error: "This note no longer exists." };
  } catch (err) {
    const detail = formatError(err);
    logToApp({ level: "warn", source: "vault", message: "A note could not be opened", detail });
    return { page: null, error: `The note could not open: ${detail}` };
  }
}
