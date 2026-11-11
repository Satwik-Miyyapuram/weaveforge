import type { Paper, PaperSummary } from "@weaveforge/core";
import { copyText } from "@/lib/toast/copy-text";
import { showToast } from "@/lib/toast/index";
import { readyCore, typedCore } from "@/lib/rust-core";

export type PaperCopyKind = "reference" | "bibtex";

const MESSAGE: Record<PaperCopyKind, string> = {
  reference: "Reference copied",
  bibtex: "BibTeX copied",
};

export interface CopyPaperDeps {
  getPaper: (id: string) => Promise<Paper | null>;
  copy?: (text: string, message: string) => Promise<void>;
  notify?: (message: string) => void;
}

/**
 * Copy a paper as a ready-to-paste reference or a BibTeX entry. A card holds
 * only the summary (no venue or stored BibTeX), so the full row is read first.
 */
export async function copyPaperAs(kind: PaperCopyKind, paper: Paper | PaperSummary, deps: CopyPaperDeps): Promise<void> {
  const { copy = copyText, notify = showToast } = deps;
  const full = "metadata" in paper && paper.metadata ? paper : await deps.getPaper(paper.id);
  if (!full) {
    notify("This paper is no longer in your library");
    return;
  }
  const text = kind === "reference" ? typedCore().formatReference(full) : readyCore().paperToBibtex(full, typedCore().resolveCiteKey(full));
  await copy(text, MESSAGE[kind]);
}
