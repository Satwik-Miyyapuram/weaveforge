import { showToast } from "@/lib/toast/index";

import type { RenamedVaultPage } from "./rename-updates-links";

const SHOWN = 5;

/**
 * After a rename, names the notes whose `[[Old]]` links were not rewritten
 * (open in an editor, or failed to save), so the user can fix them by hand.
 */
export function toastLinkRewriteFailed(saved: Partial<RenamedVaultPage>): void {
  const failed = saved.linkRewriteFailed ?? [];
  if (failed.length === 0) return;
  const names = failed.slice(0, SHOWN).join(", ");
  const more = failed.length > SHOWN ? ` and ${failed.length - SHOWN} more` : "";
  const notes = failed.length === 1 ? "note" : "notes";
  showToast(`Renamed, but links in ${failed.length} ${notes} still use the old title: ${names}${more}`);
}
