/**
 * Use-case for mutating and removing existing papers.
 *
 * Orchestration only (DIP): loads via the repository, applies the change with a
 * fresh `updatedAt`, and persists — or deletes. Separate from AddPaperUseCase so
 * each class has a single reason to change (SRP).
 */

import {
  normalizeDoi,
  PaperValidationError,
  PAPER_STATUSES,
  type Paper,
  type PaperStatus,
} from "../domain/paper.js";
import type { IPaperRepository } from "../domain/paper-repository.js";
import type { TagSource } from "../../tags/domain/tag.js";
import type { ManageTagsUseCase } from "../../tags/application/manage-tags.use-case.js";
import type { Clock } from "../../../shared/clock.js";
import { NotFoundError } from "../../../shared/errors.js";

export interface UpdatePaperDeps {
  repository: IPaperRepository;
  tags: ManageTagsUseCase;
  clock: Clock;
}

export class UpdatePaperUseCase {
  /** Tail of the update queue per paper id; see `enqueue`. */
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(private readonly deps: UpdatePaperDeps) {}

  async setStatus(id: string, status: PaperStatus): Promise<Paper> {
    if (!PAPER_STATUSES.includes(status)) {
      throw new PaperValidationError(`Unknown status "${status}".`);
    }
    return this.mutate(id, (p) => ({ ...p, status }));
  }

  /**
   * Rename the paper. Blank is refused rather than stored: a paper with no
   * title has nothing to be listed, linked or cited by.
   */
  async setTitle(id: string, title: string): Promise<Paper> {
    const trimmed = title.replace(/\s+/g, " ").trim();
    if (!trimmed) throw new PaperValidationError("A paper needs a title.");
    return this.mutate(id, (p) => ({ ...p, title: trimmed }));
  }

  /** Reader-authored summary. */
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

  /**
   * Set or clear the paper's external identifiers.
   *
   * Citation alerts need one of these to query upstream, so a paper without
   * either is silently unwatchable. Blank input clears the field rather than
   * storing an empty string, so `Boolean(paper.doi || paper.arxivId)` stays a
   * reliable "can this be tracked" test.
   */
  async setIdentifiers(
    id: string,
    identifiers: { doi?: string; arxivId?: string },
  ): Promise<Paper> {
    const doi = normalizeDoi(identifiers.doi) || undefined;
    const arxivId = identifiers.arxivId?.trim() || undefined;
    return this.mutate(id, (p) => ({ ...p, doi, arxivId }));
  }

  /**
   * Remember where this paper's PDF came from.
   *
   * A paper added from a reference list often has a DOI and a landing page
   * and nothing the reader can open; when the person finds the PDF themselves
   * and fetches it by address, that address is kept as the paper's open-access
   * copy — the same field a metadata source fills — so the reader resolves it
   * on every later open, on any device, without asking again. Only https;
   * blank clears it.
   */
  async setPdfSource(id: string, url: string | undefined): Promise<Paper> {
    const trimmed = url?.trim();
    if (trimmed && !/^https:\/\//i.test(trimmed)) {
      throw new PaperValidationError("A PDF address must start with https://.");
    }
    return this.mutate(id, (p) => {
      const metadata = { ...(p.metadata ?? {}) };
      if (trimmed) metadata.openAccessPdf = trimmed;
      else delete metadata.openAccessPdf;
      return { ...p, metadata };
    });
  }

  /** Union the given tags into the paper's existing tags (idempotent). */
  async mergeTags(id: string, tags: string[], source: TagSource = "manual"): Promise<Paper> {
    return this.deps.tags.mergeTags(id, tags, source);
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
    return this.enqueue(id, () => this.deps.repository.delete(id));
  }

  private mutate(id: string, change: (p: Paper) => Paper): Promise<Paper> {
    return this.enqueue(id, () => this.apply(id, change));
  }

  /**
   * Updates to one paper run one after another. Two at once (a note save and a
   * status change) each read the row, and the later save wrote the earlier,
   * stale row back over the other's change. Different papers never wait.
   * A delete waits for parked updates, so an update cannot write the row back after it.
   */
  private enqueue<T>(id: string, job: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(id) ?? Promise.resolve();
    const run = previous.then(job);
    // The tail never rejects, so one failed update does not block the next.
    const tail = run.then(
      () => undefined,
      () => undefined,
    );
    this.queues.set(id, tail);
    void tail.then(() => {
      if (this.queues.get(id) === tail) this.queues.delete(id);
    });
    return run;
  }

  private async apply(
    id: string,
    change: (p: Paper) => Paper,
  ): Promise<Paper> {
    const existing = await this.deps.repository.getById(id);
    if (!existing) {
      // NotFound, not Validation: see the vault use case for the reasoning.
      throw new NotFoundError(`No paper with id "${id}".`);
    }
    const updated = { ...change(existing), updatedAt: this.deps.clock.nowIso() };
    await this.deps.repository.save(updated);
    return updated;
  }
}

/** Storage paths of a paper's attached images (kept in metadata.images). */
export function imagesOf(paper: Paper): string[] {
  const raw = paper.metadata?.["images"];
  return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
}
