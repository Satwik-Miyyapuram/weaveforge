/**
 * Use-case for mutating and removing existing papers.
 *
 * Orchestration only (DIP): loads via the repository, applies the change with a
 * fresh `updatedAt`, and persists — or deletes. Separate from AddPaperUseCase so
 * each class has a single reason to change (SRP).
 */

import {
  normalizeTags,
  PaperValidationError,
  PAPER_STATUSES,
  type Paper,
  type PaperStatus,
} from "../domain/paper.js";
import type { IPaperRepository } from "../domain/paper-repository.js";
import type { TagSource } from "../../tags/domain/tag.js";
import type { ManageTagsUseCase } from "../../tags/application/manage-tags.use-case.js";
import type { Clock } from "../../../shared/clock.js";

export interface UpdatePaperDeps {
  repository: IPaperRepository;
  tags: ManageTagsUseCase;
  clock: Clock;
}

export class UpdatePaperUseCase {
  constructor(private readonly deps: UpdatePaperDeps) {}

  async setStatus(id: string, status: PaperStatus): Promise<Paper> {
    if (!PAPER_STATUSES.includes(status)) {
      throw new PaperValidationError(`Unknown status "${status}".`);
    }
    return this.mutate(id, (p) => ({ ...p, status }));
  }

  /** Reader-authored summary; capped by word count to keep it an abstract, not a doc. */
  static readonly SUMMARY_MAX_WORDS = 250;

  async setSummary(id: string, summary: string): Promise<Paper> {
    const trimmed = summary.trim();
    return this.mutate(id, (p) => ({ ...p, summary: trimmed || undefined }));
  }

  async setRating(id: string, rating: number | undefined): Promise<Paper> {
    if (rating != null && (rating < 1 || rating > 5)) {
      throw new PaperValidationError("Rating must be between 1 and 5.");
    }
    return this.mutate(id, (p) => ({ ...p, rating }));
  }

  /** Replace the paper's tags (normalized). */
  async setTags(id: string, tags: string[]): Promise<Paper> {
    return this.deps.tags.setManualTags(id, tags);
  }

  /** Union the given tags into the paper's existing tags (idempotent). */
  async mergeTags(id: string, tags: string[], source: TagSource = "manual"): Promise<Paper> {
    return this.deps.tags.mergeTags(id, tags, source);
  }

  /** Remove a manually added tag; does not unlink Zotero/annotation sources. */
  async removeManualTag(id: string, tagName: string): Promise<Paper> {
    return this.deps.tags.removeManualTag(id, tagName);
  }

  /** Record an uploaded image's storage path on the paper. */
  async addImage(id: string, path: string): Promise<Paper> {
    const p = path.trim();
    if (!p) throw new PaperValidationError("Image path is required.");
    return this.mutate(id, (paper) => ({
      ...paper,
      metadata: { ...paper.metadata, images: [...imagesOf(paper), p] },
    }));
  }

  /** Forget an image's storage path (the file itself is deleted by the store). */
  async removeImage(id: string, path: string): Promise<Paper> {
    return this.mutate(id, (paper) => ({
      ...paper,
      metadata: {
        ...paper.metadata,
        images: imagesOf(paper).filter((x) => x !== path),
      },
    }));
  }

  async remove(id: string): Promise<void> {
    await this.deps.repository.delete(id);
  }

  private async mutate(
    id: string,
    change: (p: Paper) => Paper,
  ): Promise<Paper> {
    const existing = await this.deps.repository.getById(id);
    if (!existing) {
      throw new PaperValidationError(`No paper with id "${id}".`);
    }
    const updated = { ...change(existing), updatedAt: this.deps.clock.nowIso() };
    await this.deps.repository.save(updated);
    return updated;
  }
}

/** Word count used for the summary cap (shared with the UI's live counter). */
export function countWords(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

/** Storage paths of a paper's attached images (kept in metadata.images). */
export function imagesOf(paper: Paper): string[] {
  const raw = paper.metadata?.["images"];
  return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
}
