/**
 * Use-cases for paper relations: manual edge creation and automatic citation
 * linking.
 *
 * Orchestration only (DIP). Manual: validate + dedupe + persist. Auto: pull a
 * paper's references from a citation source, match each against papers already
 * in the library, and create `cites` edges for the matches — idempotently.
 */

import {
  createPaperRelation,
  type NewPaperRelationInput,
  type PaperRelation,
} from "../domain/paper-relation.js";
import type { IPaperRelationRepository } from "../domain/paper-relation-repository.js";
import type { ICitationSource } from "./citation-source.js";
import type { Clock, IdGenerator } from "../../../shared/clock.js";
import { normalizeDoi, type Paper } from "../../papers/domain/paper.js";
import type { IPaperRepository } from "../../papers/domain/paper-repository.js";
import type { PaperRef } from "../../papers/application/metadata-source.js";

export interface AddRelationDeps {
  repository: IPaperRelationRepository;
  clock: Clock;
  ids: IdGenerator;
}

export class AddRelationUseCase {
  constructor(private readonly deps: AddRelationDeps) {}

  /** Create a typed edge. Returns the existing edge if one already matches. */
  async add(input: NewPaperRelationInput): Promise<PaperRelation> {
    const existing = await this.deps.repository.findEdge(
      input.fromPaper,
      input.toPaper,
      input.relation,
    );
    if (existing) return existing;

    const relation = createPaperRelation(input, {
      clock: this.deps.clock,
      ids: this.deps.ids,
    });
    await this.deps.repository.save(relation);
    return relation;
  }
}

export interface LinkCitationsResult {
  /** Newly created `cites` edges. */
  created: PaperRelation[];
  /** References returned by the source that matched no local paper. */
  unmatched: number;
}

export class LinkCitationsUseCase {
  constructor(
    private readonly sources: readonly ICitationSource[],
    private readonly papers: IPaperRepository,
    private readonly relations: IPaperRelationRepository,
    private readonly addRelation: AddRelationUseCase,
  ) {}

  /**
   * Discover `cites` edges from `paper` to other papers in the library. Returns
   * the edges created and how many references found no local match.
   */
  async forPaper(paper: Paper): Promise<LinkCitationsResult> {
    const ref = paperRef(paper);
    if (!ref) return { created: [], unmatched: 0 };

    const source = this.sources.find((s) => s.supports(ref));
    if (!source) return { created: [], unmatched: 0 };

    const references = await source.references(ref);
    const created: PaperRelation[] = [];
    let unmatched = 0;

    for (const cited of references) {
      const match = await this.matchLocalPaper(cited);
      if (!match || match.id === paper.id) {
        unmatched += 1;
        continue;
      }
      // Was this exact edge already present? (so re-runs don't over-report)
      const preexisting = await this.relations.findEdge(
        paper.id,
        match.id,
        "cites",
      );
      const edge = await this.addRelation.add({
        fromPaper: paper.id,
        toPaper: match.id,
        relation: "cites",
        source: "auto",
      });
      if (!preexisting) created.push(edge);
    }

    return { created, unmatched };
  }

  private async matchLocalPaper(ref: PaperRef): Promise<Paper | null> {
    if (ref.kind === "arxiv") return this.papers.findByArxivId(ref.value);
    if (ref.kind === "doi") return this.papers.findByDoi(ref.value);
    return null;
  }

  /**
   * Link citations across the whole library in one pass. Pulls every paper's
   * references in a single batch request when the source supports it, and
   * matches against an in-memory index of the library (no per-reference DB
   * lookups). Falls back to per-paper `references()` otherwise.
   */
  async forAll(library: readonly Paper[]): Promise<LinkCitationsResult> {
    // In-memory index of local papers by external id (avoids N×M DB queries).
    const byArxiv = new Map<string, Paper>();
    const byDoi = new Map<string, Paper>();
    for (const p of library) {
      if (p.arxivId) byArxiv.set(p.arxivId, p);
      if (p.doi) {
        const n = normalizeDoi(p.doi);
        if (n) byDoi.set(n, p);
      }
    }

    // Resolve each paper's references (aligned to `library` by index).
    const refs = library.map((p) => paperRef(p));
    const resolvable = refs
      .map((r, i) => ({ r, i }))
      .filter((x): x is { r: PaperRef; i: number } => !!x.r);
    const source = this.sources.find((s) => resolvable.some((x) => s.supports(x.r)));
    if (!source) return { created: [], unmatched: 0 };
    const supported = resolvable.filter((x) => source.supports(x.r));

    const refsByPaper: (PaperRef[] | null)[] = new Array(library.length).fill(null);
    if (source.referencesBatch) {
      const lists = await source.referencesBatch(supported.map((x) => x.r));
      supported.forEach((x, k) => (refsByPaper[x.i] = lists[k] ?? null));
    } else {
      for (const x of supported) {
        refsByPaper[x.i] = await source.references(x.r);
      }
    }

    // Preload existing `cites` edges once (avoids a findEdge query per pair).
    const existing = new Set<string>();
    for (const e of await this.relations.list({ relation: "cites" })) {
      existing.add(`${e.fromPaper}|${e.toPaper}`);
    }

    const created: PaperRelation[] = [];
    let unmatched = 0;
    for (let i = 0; i < library.length; i++) {
      const paper = library[i];
      const cites = refsByPaper[i];
      if (!paper || !cites) continue;
      for (const cited of cites) {
        const match =
          cited.kind === "arxiv"
            ? byArxiv.get(cited.value)
            : cited.kind === "doi"
              ? byDoi.get(normalizeDoi(cited.value) ?? cited.value)
              : undefined;
        if (!match || match.id === paper.id) {
          unmatched += 1;
          continue;
        }
        const key = `${paper.id}|${match.id}`;
        if (existing.has(key)) continue; // already linked — skip without a query
        const edge = await this.addRelation.add({
          fromPaper: paper.id,
          toPaper: match.id,
          relation: "cites",
          source: "auto",
        });
        existing.add(key);
        created.push(edge);
      }
    }
    return { created, unmatched };
  }
}

/** Prefer arXiv id, fall back to DOI, for resolving a paper externally. */
function paperRef(paper: Paper): PaperRef | null {
  if (paper.arxivId) return { kind: "arxiv", value: paper.arxivId };
  if (paper.doi) return { kind: "doi", value: paper.doi };
  return null;
}
