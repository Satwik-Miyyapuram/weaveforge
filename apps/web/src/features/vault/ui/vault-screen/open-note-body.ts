import type { VaultPage, VaultPageSummary } from "@weaveforge/core";

import { logToApp } from "@/lib/error-report/app-log";
import { formatError } from "@/lib/format-error";
import { isHydratedPage } from "@/lib/parts";

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

/**
 * The open note the screen shows: the list's entry, or the full page held for it while the list has
 * only its summary. A reload that runs while the note's file is renamed can miss the note; the held
 * page stays open then, so the editor and its focus are kept, until the lookup by id says it is gone.
 */
export function noteToShow(
  selected: VaultPage | VaultPageSummary | null,
  held: VaultPage | null,
  selectedId: string | null,
  openError: string | null,
): VaultPage | VaultPageSummary | null {
  if (!selected) return !openError && held && held.id === selectedId ? held : null;
  return !isHydratedPage(selected) && held?.id === selected.id ? held : selected;
}
