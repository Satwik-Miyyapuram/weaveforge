/**
 * Use-cases for adding papers.
 *
 * Orchestration only: it coordinates the domain factory, the repository, and
 * (for imports) the metadata resolver. It contains no persistence details and
 * no HTTP — those are injected as interfaces (Dependency Inversion). Its single
 * responsibility is the *business rule* of adding a paper, including dedupe.
 */

import {
  createPaper,
  normalizeDoi,
  type NewPaperInput,
  type Paper,
  type PaperStatus,
} from "../domain/paper.js";
import type { Clock, IdGenerator } from "../../../shared/clock.js";
import type { IPaperRepository } from "../domain/paper-repository.js";
import { titleKey } from "../domain/paper-title.js";
import {
  MetadataResolver,
  type PaperRef,
} from "./metadata-source.js";
import { parsePaperRef } from "./parse-paper-ref.js";

export interface AddPaperDeps {
  repository: IPaperRepository;
  clock: Clock;
  ids: IdGenerator;
}

export class AddPaperUseCase {
  constructor(private readonly deps: AddPaperDeps) {}

  /** Add a paper from manually entered fields. */
  async addManual(input: NewPaperInput): Promise<Paper> {
    const existing =
      (await this.findDuplicate(input.arxivId, input.doi)) ?? (await this.findByTitle(input));
    if (existing) return existing;

    const paper = createPaper(input, {
      clock: this.deps.clock,
      ids: this.deps.ids,
    });
    await this.deps.repository.save(paper);
    return paper;
  }

  private async findDuplicate(
    arxivId?: string,
    doi?: string,
  ): Promise<Paper | null> {
    if (arxivId) {
      const byArxiv = await this.deps.repository.findByArxivId(arxivId.trim());
      if (byArxiv) return byArxiv;
    }
    const normDoi = normalizeDoi(doi);
    if (normDoi) {
      const byDoi = await this.deps.repository.findByDoi(normDoi);
      if (byDoi) return byDoi;
    }
    return null;
  }

  /**
   * A paper with no identifier (a web page, a Zotero item with no DOI) could
   * only ever be added twice, and the library filled with pairs. With neither
   * id to compare, the same long title is the same paper. A paper that has an
   * id is never matched this way: two editions of a paper share a title but
   * not a DOI, and the id is what tells them apart.
   */
  private async findByTitle(input: NewPaperInput): Promise<Paper | null> {
    if (input.arxivId?.trim() || normalizeDoi(input.doi)) return null;
    const key = titleKey(input.title);
    if (!key) return null;
    const match = (await this.deps.repository.listSummaries()).find((p) => titleKey(p.title) === key);
    return match ? await this.deps.repository.getById(match.id) : null;
  }
}

/**
 * Importing a paper from an external reference (arXiv id / DOI). Composes the
 * metadata resolver with the add use-case so the dedupe rule is reused.
 */
export class ImportPaperUseCase {
  constructor(
    private readonly resolver: MetadataResolver,
    private readonly addPaper: AddPaperUseCase,
  ) {}

  async fromRef(input: PaperRef, status?: PaperStatus): Promise<Paper> {
    // Whatever the picker said, resolve what was actually pasted: an abs page,
    // a PDF link and a bare id are all the same paper.
    const ref = input.kind === "bibliographic" ? input : parsePaperRef(input.kind, input.value);
    const metadata = await this.resolver.resolve(ref);
    // Ensure the originating id is recorded for future dedupe.
    if (ref.kind === "arxiv" && !metadata.arxivId) metadata.arxivId = ref.value;
    if (ref.kind === "doi" && !metadata.doi) metadata.doi = ref.value;
    return this.addPaper.addManual(status ? { ...metadata, status } : metadata);
  }
}
