import { NotFoundError } from "../../../shared/errors.js";
import type { Clock, IdGenerator } from "../../../shared/parts.js";
import { rust } from "../../../shared/rust.js";
import type { INotificationIntegration } from "../../integrations/domain/parts.js";
import type { ILogEntryManager } from "../../logbook/domain/parts.js";
import type { PaperRef } from "../../papers/application/parts-1.js";
import type {
  IPaperIdentityLookup,
  IPaperRepository,
  Paper,
  PaperIdentity,
} from "../../papers/domain/parts.js";
import type {
  ICitationAlertTrackRepository,
  IPaperRelationRepository,
  NewPaperRelationInput,
  PaperRelation,
} from "../domain/parts.js";

// --- parts ---
// --- citation-source ---
/**
 * Citation-source contract (for automatic edge discovery).
 *
 * Given a paper reference, a source returns the references it cites as a list
 * of `PaperRef`s. Each external provider (Semantic Scholar, OpenCitations,
 * Crossref) implements this interface; adding one is a new class, never an edit
 * to the linking use-case (Open/Closed Principle).
 */
/** Semantic Scholar citation-intent labels (when full text is available). */
export type CitationIntent = "background" | "method" | "result";

export interface CitationCandidate {
  /** Stable provider paper id used for deduplication. */
  id: string;
  title: string;
  authors: string[];
  year?: number;
  url?: string;
  /** How many times this citing paper is itself cited, when the source provides it. */
  citationCount?: number;
  /**
   * Citing-text snippets from the provider. Absent when the source has no full
   * text for the citing paper — that is the normal case, not an error.
   */
  contexts?: string[];
  /**
   * Classified citation intents when the provider supplies them. Empty/absent
   * when full text is unavailable.
   */
  intents?: CitationIntent[];
  /** Provider flag for highly influential citations. */
  isInfluential?: boolean;
}

export interface ICitationSource {
  /** Stable id, e.g. "semantic-scholar". */
  readonly id: string;
  /** Whether this source can resolve citations for the given reference. */
  supports(ref: PaperRef): boolean;
  /** The references (outgoing citations) of the given paper. */
  references(ref: PaperRef): Promise<PaperRef[]>;
  /**
   * Optional batch variant: resolve references for many papers in one call.
   * Returns one entry per input ref (same order); `null` for papers the source
   * couldn't resolve. Sources that support it (e.g. Semantic Scholar's
   * `/paper/batch`) let the linker avoid N sequential, rate-limited requests.
   */
  referencesBatch?(refs: PaperRef[]): Promise<(PaperRef[] | null)[]>;
  /** Incoming papers that cite this paper, used by saved citation alerts. */
  citations?(ref: PaperRef): Promise<CitationCandidate[]>;
}

// --- remove-relation.use-case ---
export class RemoveRelationUseCase {
  constructor(private readonly repository: IPaperRelationRepository) {}

  async execute(relationId: string): Promise<void> {
    await this.repository.delete(relationId);
  }
}

// --- check-citation-alerts.use-case ---
const DAY_MS = 24 * 60 * 60 * 1000;

export interface CitationAlertCheckResult {
  tracked: number;
  checked: number;
  found: number;
  /** Papers whose check threw (provider/network/log write); retried next run. */
  failed: number;
}

/**
 * `ranked` is already best first (rankCitationAlerts). Rust writes the markdown; the citation
 * count is formatted here because `toLocaleString` depends on the locale.
 */
function logBody(paper: Paper, ranked: CitationCandidate[]): string {
  return rust().citationAlertLogBody(
    paper.title,
    ranked.map((item) => ({
      title: item.title,
      url: item.url,
      authors: item.authors,
      year: item.year ? String(item.year) : undefined,
      citationCount: item.citationCount,
      citationCountText:
        typeof item.citationCount === "number" ? item.citationCount.toLocaleString() : undefined,
      isInfluential: item.isInfluential,
      intents: item.intents,
    })),
  );
}

export class CheckCitationAlertsUseCase {
  /** Serialize runs so a forced manual check is not swallowed by an in-flight daily poll. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly deps: {
      papers: IPaperRepository;
      tracks: ICitationAlertTrackRepository;
      sources: ICitationSource[];
      logs: ILogEntryManager;
      notifications: INotificationIntegration;
      clock: Clock;
      /** Live project scope; when it changes mid-run, stop before further writes. */
      getProjectId?: () => string | null;
      /** Told of each failure the run survives: a paper's check or its notification. */
      onError?: (paperId: string, error: unknown) => void;
    },
  ) {}

  private report(paperId: string, error: unknown): void {
    try {
      this.deps.onError?.(paperId, error);
    } catch {
      // A broken reporter must not stop the remaining tracks.
    }
  }

  async isTracking(paperId: string): Promise<boolean> {
    return (await this.deps.tracks.getByPaperId(paperId)) != null;
  }

  async setTracking(paperId: string, enabled: boolean): Promise<Paper> {
    const paper = await this.deps.papers.getById(paperId);
    // Same condition and same wording as the paper use case's not-found throw.
    if (!paper) throw new NotFoundError(`No paper with id "${paperId}".`);
    if (!enabled) {
      await this.deps.tracks.untrack(paperId);
      return paper;
    }

    const ref = rust().primaryPaperRef(paper.arxivId, paper.doi);
    if (!ref) throw new Error("Citation alerts require a DOI or arXiv ID.");
    const source = this.deps.sources.find((item) => item.supports(ref) && item.citations);
    if (!source?.citations) throw new Error("No citation-alert provider is configured.");

    // Baseline existing citations when tracking starts so only future citations alert.
    const now = this.deps.clock.nowIso();
    const existing = await this.deps.tracks.getByPaperId(paperId);
    const current = await source.citations(ref);
    await this.deps.tracks.track({
      paperId,
      lastCheckedAt: now,
      seenCitingIds: rust().mergeSeenIds(existing?.seenCitingIds ?? [], current.map((item) => item.id)),
    });
    return paper;
  }

  checkAll(force = false): Promise<CitationAlertCheckResult> {
    const run = this.queue.then(() => this.execute(force));
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private scoped(): boolean {
    const getId = this.deps.getProjectId;
    return !getId || getId() === this.boundProjectId;
  }

  private boundProjectId: string | null = null;

  private async execute(force: boolean): Promise<CitationAlertCheckResult> {
    this.boundProjectId = this.deps.getProjectId?.() ?? null;
    const tracks = await this.deps.tracks.listForProject();
    const result: CitationAlertCheckResult = { tracked: tracks.length, checked: 0, found: 0, failed: 0 };

    for (const track of tracks) {
      if (!this.scoped()) return result;

      try {
        const paper = await this.deps.papers.getById(track.paperId);
        if (!paper) {
          if (this.scoped()) await this.deps.tracks.untrack(track.paperId);
          continue;
        }
        const now = this.deps.clock.nowIso();
        if (!force && track.lastCheckedAt) {
          const elapsed = Date.parse(now) - Date.parse(track.lastCheckedAt);
          if (Number.isFinite(elapsed) && elapsed < DAY_MS) continue;
        }
        const ref = rust().primaryPaperRef(paper.arxivId, paper.doi);
        if (!ref) continue;
        const source = this.deps.sources.find((item) => item.supports(ref) && item.citations);
        if (!source?.citations) continue;

        const current = await source.citations(ref);
        if (!this.scoped()) return result;

        // Honor untrack during the fetch — never re-create a disabled watch.
        const latest = await this.deps.tracks.getByPaperId(track.paperId);
        if (!latest) continue;

        const seen = new Set(latest.seenCitingIds);
        const fresh = rust().rankCitationAlerts(current.filter((item) => !seen.has(item.id))) as CitationCandidate[];
        const seenCitingIds = rust().mergeSeenIds(
          latest.seenCitingIds,
          current.map((item) => item.id),
        );

        if (fresh.length > 0) {
          // Persist seen only after the in-app log succeeds so a failed write can retry.
          await this.deps.logs.add({
            body: logBody(paper, fresh),
            links: [{ type: "paper", id: paper.id }],
          });
          // Mattermost is optional and should never prevent in-app alert delivery.
          await this.deps.notifications
            .notifyCitationAlert(paper, fresh)
            .catch((error: unknown) => this.report(paper.id, error));
        }

        if (!this.scoped()) return result;
        const still = await this.deps.tracks.getByPaperId(track.paperId);
        if (!still) continue;

        await this.deps.tracks.save({
          ...still,
          lastCheckedAt: now,
          seenCitingIds,
        });
        result.checked += 1;
        result.found += fresh.length;
      } catch (error) {
        // One paper failing (S2/network) must not skip the rest of the project's
        // tracks, but the caller must see that it failed.
        result.failed += 1;
        this.report(track.paperId, error);
      }
    }
    return result;
  }
}

// --- manage-relations.use-case ---
/**
 * Use-cases for paper relations: manual edge creation and automatic citation
 * linking.
 *
 * Orchestration only (DIP). Manual: validate + dedupe + persist. Auto: pull a
 * paper's references from a citation source, match each against papers already
 * in the library, and create `cites` edges for the matches — idempotently.
 */
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

    const relation = rust().createPaperRelation(input, {
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
    const ref = rust().primaryPaperRef(paper.arxivId, paper.doi);
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
    // Resolve each paper's references (aligned to `library` by index).
    const refs = library.map((p) => rust().primaryPaperRef(p.arxivId, p.doi));
    const resolvable = refs
      .map((r, i) => ({ r, i }))
      .filter((x) => !!x.r) as { r: PaperRef; i: number }[];
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

    // Which library paper each reference points at (arXiv id, normalised DOI), decided in Rust.
    const matches = rust().matchCitationReferences(
      library.map((p) => ({ id: p.id, arxivId: p.arxivId, doi: p.doi })),
      refsByPaper,
    );

    const created: PaperRelation[] = [];
    let unmatched = 0;
    for (let i = 0; i < library.length; i++) {
      const paper = library[i];
      const cites = refsByPaper[i];
      if (!paper || !cites) continue;
      for (let k = 0; k < cites.length; k++) {
        const matchIndex = matches[i]?.[k];
        const match = matchIndex == null ? undefined : library[matchIndex];
        if (!match) {
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
