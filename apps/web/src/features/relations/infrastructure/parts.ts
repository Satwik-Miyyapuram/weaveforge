import {
  one,
  oneRow,
  ProjectScopedPostgrestRepository,
  rows,
  run,
} from "@/backend/providers/postgrest/parts-1";
import { readyCore, typedCore } from "@/lib/rust-core";
import { fetchSemanticScholar, semanticScholarUrl } from "@/lib/semantic-scholar-fetch";
import type {
  CitationAlertTrack,
  CitationCandidate,
  ICitationAlertTrackRepository,
  ICitationSource,
  NewCitationAlertTrackInput,
  PaperRef,
} from "@weaveforge/core";
import type { CitationAlertTrackRow } from "@weaveforge/wasm";

// --- postgrest-citation-alert-track-repository ---
type TrackRow = CitationAlertTrackRow;

/** Row mapping is Rust (`citation_alert_track_from_row`). */
const toDomain = (row: TrackRow): CitationAlertTrack =>
  readyCore().citationAlertTrackFromRow(row) as CitationAlertTrack;

/**
 * The columns a TrackRow is read as, named rather than starred.
 *
 * Derived from the row type: these are exactly the fields the mapper reads, and a
 * star would make them "whatever the table grows next".
 */
const TRACK_COLUMNS = "id,paper_id,tracked_at,last_checked_at,seen_citing_ids";

const TABLE = "citation_alert_tracks";

export class PostgrestCitationAlertTrackRepository extends ProjectScopedPostgrestRepository implements ICitationAlertTrackRepository {
  protected readonly action = "managing citation alerts";

  async track(input: NewCitationAlertTrackInput): Promise<CitationAlertTrack> {
    const userId = await this.session.requireUserId();
    const dbRow = await oneRow<TrackRow>(this.db
      .from(TABLE)
      .upsert(
        {
          user_id: userId,
          project_id: this.projectId,
          paper_id: input.paperId,
          seen_citing_ids: input.seenCitingIds ?? [],
          last_checked_at: input.lastCheckedAt ?? null,
        },
        { onConflict: "project_id,paper_id" },
      )
      .select(TRACK_COLUMNS)
      .single());
    return toDomain(dbRow);
  }

  async untrack(paperId: string): Promise<void> {
    await run(this.db
      .from(TABLE)
      .delete()
      .eq("project_id", this.projectId)
      .eq("paper_id", paperId));
  }

  async listForProject(): Promise<CitationAlertTrack[]> {
    const projectId = this.ctx.projectId;
    if (!projectId) return [];
    return (await rows<TrackRow>(this.db
      .from(TABLE)
      .select(TRACK_COLUMNS)
      .eq("project_id", projectId)
      .order("tracked_at", { ascending: false }))).map(toDomain);
  }

  async getByPaperId(paperId: string): Promise<CitationAlertTrack | null> {
    const projectId = this.ctx.projectId;
    if (!projectId) return null;
    const row = await one<TrackRow>(this.db
      .from(TABLE)
      .select(TRACK_COLUMNS)
      .eq("project_id", projectId)
      .eq("paper_id", paperId)
      .maybeSingle());
    return row ? toDomain(row) : null;
  }

  async save(track: CitationAlertTrack): Promise<void> {
    await run(this.db
      .from(TABLE)
      .update({
        last_checked_at: track.lastCheckedAt ?? null,
        seen_citing_ids: track.seenCitingIds,
      })
      .eq("id", track.id)
      .eq("project_id", this.projectId));
  }
}

// --- semantic-scholar-citation-source ---
/**
 * Semantic Scholar citation source. Implements ICitationSource so it can be
 * registered with the LinkCitations use-case without changing it (Open/Closed).
 *
 * Uses the public Graph API; dependency-free (fetch + JSON). For each reference
 * it prefers the arXiv id, falling back to the DOI — matching how papers are
 * deduped locally.
 */

interface S2ExternalIds {
  ArXiv?: string;
  DOI?: string;
}

interface S2ReferenceItem {
  citedPaper?: { externalIds?: S2ExternalIds | null } | null;
}

interface S2ReferencesResponse {
  data?: S2ReferenceItem[];
}

function extId(ids: S2ExternalIds | null | undefined): PaperRef | null {
  return typedCore().citationExternalIdRef(ids ?? null) as PaperRef | null;
}

function s2Id(ref: PaperRef): string {
  // Bibliographic refs have no Semantic Scholar id, and the wasm PaperRefKind omits them.
  if (ref.kind === "bibliographic") throw new Error("Semantic Scholar needs an arXiv id, DOI, URL or Zotero key");
  return typedCore().s2PaperId(ref);
}

const BATCH_LIMIT = 500; // max ids per /paper/batch request

/** Paging stop rule (page cap, offset ceiling, non-advancing next) lives in Rust. */
function nextPageOffset(currentOffset: number, next: unknown, pagesFetched: number): number {
  return typedCore().nextCitationPageOffset(currentOffset, next, pagesFetched);
}

export class SemanticScholarCitationSource implements ICitationSource {
  readonly id = "semantic-scholar";

  constructor(
    // Wrap so `fetch` keeps its global `this` binding (a bare reference throws
    // "Illegal invocation" in the browser when called as a method).
    private readonly fetchFn: typeof fetch = (...args) => fetch(...args),
    // Resolved per call: the desktop shell relays the API (see `semanticScholarUrl`).
    private readonly baseUrl?: string,
    // Optional S2 API key (from user settings); raises the rate limit and is
    // sent only from the unlocked browser directly to Semantic Scholar.
    private readonly apiKey: () => Promise<string | undefined> = async () => undefined,
  ) {}

  supports(ref: PaperRef): boolean {
    return ref.kind === "arxiv" || ref.kind === "doi";
  }

  private base(): string {
    return this.baseUrl ?? semanticScholarUrl("graph/v1");
  }

  async references(ref: PaperRef): Promise<PaperRef[]> {
    const key = await this.apiKey();
    const init = key ? { headers: { "x-api-key": key } } : undefined;
    const refs: PaperRef[] = [];
    let offset = 0;
    let pages = 0;

    do {
      const url =
        `${this.base()}/paper/${encodeURIComponent(s2Id(ref))}/references` +
        `?fields=externalIds&limit=1000&offset=${offset}`;
      // S2 is aggressively rate-limited (~1 req/s); retry 429s with backoff
      // before giving up, so batch auto-linking doesn't fail on a transient cap.
      const res = await fetchSemanticScholar(this.fetchFn, url, init);
      if (!res.ok) {
        throw new Error(
          `Semantic Scholar request failed: ${res.status} ${res.statusText}`,
        );
      }
      const body = (await res.json()) as S2ReferencesResponse & { next?: number };
      for (const item of body.data ?? []) {
        const ref = extId(item.citedPaper?.externalIds);
        if (ref) refs.push(ref);
      }
      pages += 1;
      const next = body.next;
      offset = nextPageOffset(offset, next, pages);
    } while (offset >= 0);

    return refs;
  }

  /** Incoming citations, paged so alert baselines do not miss older papers. */
  async citations(ref: PaperRef): Promise<CitationCandidate[]> {
    const key = await this.apiKey();
    const init = key ? { headers: { "x-api-key": key } } : undefined;
    const out: CitationCandidate[] = [];
    let offset = 0;
    let pages = 0;

    do {
      const url =
        `${this.base()}/paper/${encodeURIComponent(s2Id(ref))}/citations` +
        `?fields=paperId,title,authors,year,url,citationCount,contexts,intents,isInfluential&limit=1000&offset=${offset}`;
      const res = await fetchSemanticScholar(this.fetchFn, url, init);
      if (!res.ok) {
        throw new Error(`Semantic Scholar citations failed: ${res.status} ${res.statusText}`);
      }
      const body = (await res.json()) as { data?: unknown; next?: unknown };
      // Candidate assembly (trim, skip, field mapping) lives in wf-core `citation_candidate`.
      // Rust keeps only known intents, so the wire's string[] is CitationIntent[].
      out.push(...(typedCore().citationCandidates(body.data ?? []) as CitationCandidate[]));
      pages += 1;
      // Soft-stop on stuck/zero next, page cap, or S2's offset≥10000 ceiling.
      offset = nextPageOffset(offset, body.next, pages);
    } while (offset >= 0);

    return out;
  }

  /**
   * Batch variant: one POST to `/paper/batch` returns every paper's references,
   * replacing N rate-limited GETs. Chunked at 500 ids; same 429 backoff.
   * Note: batch nests up to ~the first references per paper (S2 default), which
   * is plenty for matching against a personal library.
   */
  async referencesBatch(refs: PaperRef[]): Promise<(PaperRef[] | null)[]> {
    if (refs.length === 0) return [];
    const key = await this.apiKey();
    const out: (PaperRef[] | null)[] = [];

    for (let i = 0; i < refs.length; i += BATCH_LIMIT) {
      const chunk = refs.slice(i, i + BATCH_LIMIT);
      const init: RequestInit = {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(key ? { "x-api-key": key } : {}),
        },
        body: JSON.stringify({ ids: chunk.map(s2Id) }),
      };
      const url = `${this.base()}/paper/batch?fields=references.externalIds`;
      const res = await fetchSemanticScholar(this.fetchFn, url, init);
      if (!res.ok) {
        throw new Error(`Semantic Scholar batch failed: ${res.status} ${res.statusText}`);
      }
      // Alignment check (one entry per id, in order) and per-paper reference lists live in
      // wf-core `citation_candidate`; it throws the same message when the count differs.
      const data: unknown = await res.json();
      out.push(...typedCore().batchReferenceLists(data, chunk.length));
    }
    return out;
  }
}
