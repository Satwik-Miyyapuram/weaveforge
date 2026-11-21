import type {
  EditVaultPageInput,
  EditedVaultPage,
  IVaultPageManager,
  IVaultPageRepository,
} from "@weaveforge/core";

import { readyCore } from "@/lib/rust-core";

type VaultPages = IVaultPageRepository & IVaultPageManager;

/**
 * The vault page writes, where renaming a note also rewrites `[[Old]]`,
 * `[[Old|alias]]` and `[[Old#heading]]` in every other note to the new title.
 *
 * Every rename door (the explorer pencil, the note's title field) goes through
 * `manageVaultPage.update`, and none rewrote links, so a rename left the old
 * links dangling (F97 rename links).
 */
export function withRenameLinkRewrite<T extends VaultPages>(pages: T): T {
  const update = async (id: string, input: EditVaultPageInput): Promise<EditedVaultPage> => {
    const before = input.title === undefined ? null : await pages.getById(id);
    const saved = await pages.update(id, input);
    if (!before || before.title === saved.title) return saved;
    const renames = new Map([[readyCore().normalizeTitleKey(before.title), saved.title]]);
    for (const page of await pages.list()) {
      if (page.id === id || !page.body.includes("[[")) continue;
      const body = readyCore().rewriteWikilinks(page.body, renames);
      if (body !== page.body) await pages.update(page.id, { body });
    }
    return saved;
  };
  return Object.assign(Object.create(pages) as T, { update });
}
