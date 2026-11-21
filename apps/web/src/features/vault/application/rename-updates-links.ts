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
 *
 * A rename onto a title another note has is refused by the repo before any
 * link is touched. While another note still has the old title, the links still
 * point to that note, so they are left alone.
 */
export function withRenameLinkRewrite<T extends VaultPages>(pages: T): T {
  const update = async (id: string, input: EditVaultPageInput): Promise<EditedVaultPage> => {
    const before = input.title === undefined ? null : await pages.getById(id);
    const saved = await pages.update(id, input);
    if (!before || before.title === saved.title) return saved;
    const core = readyCore();
    const oldKey = core.normalizeTitleKey(before.title);
    const all = await pages.list();
    if (all.some((p) => p.id !== id && core.normalizeTitleKey(p.title) === oldKey)) return saved;
    const renames = new Map([[oldKey, saved.title]]);
    for (const page of all) {
      if (page.id === id || !page.body.includes("[[")) continue;
      const body = readyCore().rewriteWikilinksOutsideCode(page.body, renames);
      if (body !== page.body) await pages.update(page.id, { body });
    }
    return saved;
  };
  return Object.assign(Object.create(pages) as T, { update });
}
