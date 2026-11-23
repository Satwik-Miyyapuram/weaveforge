import type { EditedVaultPage, IVaultPageManager, VaultPage } from "@weaveforge/core";
import { readyCore } from "@/lib/rust-core";

/**
 * Removes `tag` from the body the chip was drawn from. That body is sent as
 * baseBody, so an edit saved since is kept as a conflict copy, not overwritten.
 */
export function removeNoteTag(
  pages: Pick<IVaultPageManager, "update">,
  page: VaultPage,
  tag: string,
): Promise<EditedVaultPage> {
  const body = readyCore().removeHashtagFromBody(page.body, tag);
  return pages.update(page.id, { body, baseBody: page.body });
}