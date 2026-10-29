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
import { paperRef } from "./paper-ref.js";
import type { Clock, IdGenerator } from "../../../shared/clock.js";
import { normalizeDoi, type Paper } from "../../papers/domain/paper.js";
import type { IPaperIdentityLookup, PaperIdentity } from "../../papers/domain/paper-identity.js";
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
  /** Papers whose references or edge writes threw; the rest still linked. */
  failed: number;
}

export class LinkCitationsUseCase {
  constructor(
    private readonly sources: readonly ICitationSource[],
    /** Only the identity lookup: linking reads nothing else about a paper. */
    private readonly papers: IPaperIdentityLookup,
    private readonly relations: IPaperRelationRepository,
    private readonly addRelation: AddRelationUseCase,
  ) {}

  /**
   * Discover `cites` edges from `paper` to other papers in the library. Returns
   * the edges created and how many references found no local match.
   */
  async forPaper(paper: Paper): Promise<LinkCitationsResult> {
    const ref = paperRef(paper);
    if (!ref) return { created: [], unmatched: 0, failed: 0 };

    const source = this.sources.find((s) => s.supports(ref));
    if (!source) return { created: [], unmatched: 0, failed: 0 };

    const references = await source.references(ref);
    // One read of this paper's edges, so a re-run reports nothing new without a
    // lookup per reference (add() still checks before it writes).
    const linked = new Set(
      (await this.relations.relationsFor(paper.id))
        .filter((e) => e.relation === "cites" && e.fromPaper === paper.id)
        .map((e) => e.toPaper),
    );
    const created: PaperRelation[] = [];
    let unmatched = 0;

    for (const cited of references) {
      const match = await this.matchLocalPaper(cited);
      if (!match || match.id === paper.id) {
        unmatched += 1;
        continue;
      }
      if (linked.has(match.id)) continue; // already linked: not new
      const edge = await this.addRelation.add({
        fromPaper: paper.id,
        toPaper: match.id,
        relation: "cites",
        source: "auto",
      });
      linked.add(match.id);
      created.push(edge);
    }

    return { created, unmatched, failed: 0 };
  }

  /**
   * The local paper a citation names — its identity, not the whole row.
   *
   * This used to call `findByArxivId`/`findByDoi`, which answer with a full
   * `Paper`: linking one bibliography transferred the abstract, the bibtex and
   * the metadata bag of every reference it matched, and the only field anything
   * downstream reads is the id. `IPaperIdentityLookup` is the port for that
   * question.
   */
  private async matchLocalPaper(ref: PaperRef): Promise<PaperIdentity | null> {
    if (ref.kind === "arxiv") return this.papers.findIdentityByArxivId(ref.value);
    if (ref.kind === "doi") return this.papers.findIdentityByDoi(ref.value);
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
    if (!source) return { created: [], unmatched: 0, failed: 0 };
    const supported = resolvable.filter((x) => source.supports(x.r));

    const refsByPaper: (PaperRef[] | null)[] = new Array(library.length).fill(null);
    const failedPapers = new Set<number>();
    if (source.referencesBatch) {
      const lists = await source.referencesBatch(supported.map((x) => x.r));
      supported.forEach((x, k) => (refsByPaper[x.i] = lists[k] ?? null));
    } else {
      for (const x of supported) {
        try {
          refsByPaper[x.i] = await source.references(x.r);
        } catch {
          failedPapers.add(x.i); // one rate-limited paper must not stop the rest
        }
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
        try {
          const edge = await this.addRelation.add({
            fromPaper: paper.id,
            toPaper: match.id,
            relation: "cites",
            source: "auto",
          });
          existing.add(key);
          created.push(edge);
        } catch {
          failedPapers.add(i);
        }
      }
    }
    return { created, unmatched, failed: failedPapers.size };
  }
}
