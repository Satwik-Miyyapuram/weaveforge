import type {
  EditVaultPageInput,
  EditedVaultPage,
  IVaultPageManager,
  IVaultPageRepository,
} from "@weaveforge/core";

import { logToApp } from "@/lib/error-report/app-log";
import { readyCore } from "@/lib/rust-core";

type VaultPages = IVaultPageRepository & IVaultPageManager;

/** A rename's result; `linkRewriteFailed` names the notes whose links could not be rewritten. */
export type RenamedVaultPage = EditedVaultPage & { readonly linkRewriteFailed?: readonly string[] };

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
  const update = async (id: string, input: EditVaultPageInput): Promise<RenamedVaultPage> => {
    const before = input.title === undefined ? null : await pages.getById(id);
    const saved = await pages.update(id, input);
    if (!before || before.title === saved.title) return saved;
    const core = readyCore();
    const oldKey = core.normalizeTitleKey(before.title);
    const all = await pages.list();
    if (all.some((p) => p.id !== id && core.normalizeTitleKey(p.title) === oldKey)) return saved;
    const renames = new Map([[oldKey, saved.title]]);
    const failed: string[] = [];
    for (const page of all) {
      // Only a note whose text holds the old title (case and spacing folded
      // as link lookup folds them) can link to it.
      if (page.id === id || !core.normalizeTitleKey(page.body).includes(oldKey)) continue;
      try {
        // Re-read right before the write, and send what was read as baseBody:
        // the repo then merges (or keeps a conflict copy of) anything saved in
        // between instead of overwriting it. Editors send their own baseBody,
        // so an open note's later autosave merges with this rewrite too.
        const fresh = await pages.getById(page.id);
        if (!fresh) continue;
        const body = core.rewriteWikilinksOutsideCode(fresh.body, renames);
        if (body !== fresh.body) await pages.update(page.id, { body, baseBody: fresh.body });
      } catch {
        failed.push(page.title);
      }
    }
    if (failed.length === 0) return saved;
    // The rename itself saved; a retry would see the new title and rewrite
    // nothing, so the notes still holding [[Old]] are named here.
    logToApp({
      level: "warn",
      source: "rename",
      message: `Renamed "${before.title}" to "${saved.title}", but ${failed.length} note(s) still link to the old title`,
      detail: failed.join("\n"),
    });
    return { ...saved, linkRewriteFailed: failed };
  };
  return Object.assign(Object.create(pages) as T, { update });
}
