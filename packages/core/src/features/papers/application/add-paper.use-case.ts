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
    const existing = await this.findDuplicate(input.arxivId, input.doi);
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
    const ref = parsePaperRef(input.kind, input.value);
    const metadata = await this.resolver.resolve(ref);
    // Ensure the originating id is recorded for future dedupe.
    if (ref.kind === "arxiv" && !metadata.arxivId) metadata.arxivId = ref.value;
    if (ref.kind === "doi" && !metadata.doi) metadata.doi = ref.value;
    return this.addPaper.addManual(status ? { ...metadata, status } : metadata);
  }
}
