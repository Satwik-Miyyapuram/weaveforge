import { toBibliographyAnnotationPull } from "@/features/papers/domain/zotero";
import type { DesktopBridge } from "@/lib/desktop/desktop-bridge";
import { logToApp } from "@/lib/error-report/app-log";
import { describeRejection } from "@/lib/format-error";
import { readyCore, typedCore } from "@/lib/rust-core";
import { fetchSemanticScholar, semanticScholarUrl } from "@/lib/semantic-scholar-fetch";
import {
  type AddPaperUseCase,
  type IAnnotationPinRepository,
  type IAnnotationQuotationTypeRepository,
  type IBibliographyIntegration,
  type ILibraryPinRepository,
  imagesOf,
  type IPaperFieldRepository,
  type IPaperRelationRepository,
  type IPaperRepository,
  type IReaderAnnotationSink,
  type IReaderAnnotationSource,
  type IReadingListItemRepository,
  type IReadingListRepository,
  type IShareRepository,
  loadPinnedScreenData,
  type ITagManager,
  type Paper,
  type PaperSummary,
  type ReadingList,
  UpdatePaperUseCase,
  ValidationError,
} from "@weaveforge/core";
import type { RelatedPaperKeys } from "@weaveforge/wasm";
import type { IPaperImageStore } from "../domain/zotero";

// --- delete-paper.use-case ---
export class DeletePaperUseCase {
  constructor(
    private readonly deps: {
      bibliography: IBibliographyIntegration;
      images: IPaperImageStore;
      updatePaper: UpdatePaperUseCase;
      papers: IPaperRepository;
    },
  ) {}

  async execute(paper: Paper): Promise<void> {
    const zoteroKey = paper.metadata?.zoteroKey as string | undefined;
    if (zoteroKey) {
      try {
        await this.deps.bibliography.removeRemotePaper(zoteroKey);
      } catch (err) {
        // Best-effort: the local delete still goes ahead, but a Zotero item
        // left behind should be traceable.
        logToApp({
          level: "warn",
          source: "zotero",
          message: "Could not delete the paper from Zotero",
          detail: `${zoteroKey}: ${describeRejection(err)}`,
        });
      }
    }
    // A paper's images are independent objects in blob storage, so deleting
    // them one round trip at a time made the delete take as long as the paper
    // had figures. Best-effort per image, as before — one failure must not
    // strand the rest or the row itself — but an image left behind is logged.
    await Promise.all(
      imagesOf(paper).map(async (img) => {
        try {
          await this.deps.images.remove(img);
        } catch (err) {
          logToApp({
            level: "warn",
            source: "storage",
            message: "Could not delete a paper image from storage",
            detail: `${img}: ${describeRejection(err)}`,
          });
        }
      }),
    );
    await this.deps.updatePaper.remove(paper.id);
  }
}

// --- fetch-related-papers ---
/**
 * Fetch related or citing papers for a seed library paper: Semantic Scholar
 * first, OpenAlex when it has none.
 * Filters out items already in the local library (by DOI / arXiv / title).
 */
export type RelatedPaperHit = {
  title: string;
  authors: string[];
  year?: number;
  doi?: string;
  arxivId?: string;
  url?: string;
  abstract?: string;
  /** Semantic Scholar (or derived) citation count when available. */
  citationCount?: number;
};

type S2Paper = {
  title?: string;
  year?: number;
  abstract?: string;
  url?: string;
  citationCount?: number;
  authors?: { name?: string }[];
  externalIds?: { DOI?: string; ArXiv?: string } | null;
};

export function resolveRelatedPaperUrl(hit: Pick<RelatedPaperHit, "url" | "doi" | "arxivId">): string | undefined {
  return typedCore().resolveRelatedPaperUrl(hit);
}

/**
 * Rust sends an absent field as null; the hit type and the old TS have it undefined, key kept.
 * Takes the Rust row as an object: its nullable fields (year, doi, ...) are what this rewrites.
 */
function undefinedForNull(hit: object | null): RelatedPaperHit | null {
  if (!hit) return hit;
  return Object.fromEntries(Object.entries(hit).map(([k, v]) => [k, v ?? undefined])) as RelatedPaperHit;
}

/** The hit for a Semantic Scholar paper; the field rules are in Rust (`related_paper_hit`). */
function s2ToHit(p: S2Paper): RelatedPaperHit | null {
  return undefinedForNull(typedCore().s2ToHit(p));
}

const S2_FIELDS = "title,authors,year,externalIds,url,abstract,citationCount";

/** Which neighbours to list: work like the seed, or the papers that cite it. */
export type RelatedKind = "related" | "citedBy";

/**
 * The dedupe state carried across the sources: the keys (library plus listed
 * hits) and the hits kept so far. The field rules and the dedupe are in Rust.
 */
type Collected = { keys: RelatedPaperKeys; hits: RelatedPaperHit[] };

/**
 * Adds each new candidate to the state until it holds `limit` hits; the library
 * and repeats are skipped. The library is typed on the summary projection: the
 * fields the dedupe reads are all on it.
 */
function collect(candidates: readonly unknown[], state: Collected, limit: number): Collected {
  const out = typedCore().collectNewHits({ keys: state.keys, hits: state.hits, candidates, limit });
  return { keys: out.keys, hits: out.hits.map((hit) => undefinedForNull(hit) as RelatedPaperHit) };
}

async function s2Json<T>(path: string, query: string, apiKey?: string): Promise<T> {
  const url = `${semanticScholarUrl(path)}?${query}`;
  const res = await fetchSemanticScholar(fetch, url, apiKey ? { headers: { "x-api-key": apiKey } } : undefined);
  if (!res.ok) throw new Error(`Semantic Scholar request failed: ${res.status}`);
  return (await res.json()) as T;
}

async function s2Recommended(paperId: string, limit: number, apiKey?: string) {
  const body = await s2Json<{ recommendedPapers?: S2Paper[] }>(
    `recommendations/v1/papers/forpaper/${encodeURIComponent(paperId)}`,
    `fields=${S2_FIELDS}&limit=${limit + 5}`,
    apiKey,
  );
  return (body.recommendedPapers ?? []).map(s2ToHit);
}

async function s2References(paperId: string, apiKey?: string) {
  const body = await s2Json<{ data?: { citedPaper?: S2Paper | null }[] }>(
    `graph/v1/paper/${encodeURIComponent(paperId)}/references`,
    `fields=${typedCore().s2NestedFields("citedPaper")}&limit=50`,
    apiKey,
  );
  return (body.data ?? []).map((row) => s2ToHit(row.citedPaper ?? {}));
}

/** The papers citing the seed, most cited first. */
async function s2Citing(paperId: string, apiKey?: string) {
  const body = await s2Json<{ data?: { citingPaper?: S2Paper | null }[] }>(
    `graph/v1/paper/${encodeURIComponent(paperId)}/citations`,
    `fields=${typedCore().s2NestedFields("citingPaper")}&limit=100`,
    apiKey,
  );
  return typedCore().sortByCitations(
    (body.data ?? []).map((row) => s2ToHit(row.citingPaper ?? {})),
  );
}

const OPENALEX = "https://api.openalex.org/works";
const OPENALEX_SELECT = "id,title,doi,publication_year,authorships,cited_by_count,abstract_inverted_index";

type OpenAlexWork = {
  id?: string;
  title?: string | null;
  doi?: string | null;
  publication_year?: number;
  authorships?: { author?: { display_name?: string } }[];
  cited_by_count?: number;
  abstract_inverted_index?: Record<string, number[]> | null;
  related_works?: string[];
};

/** Every OpenAlex URL here already has a query, so the key is appended to it. */
async function openAlexJson<T>(url: string, key?: string): Promise<T> {
  const res = await fetch(key ? `${url}&api_key=${encodeURIComponent(key)}` : url);
  if (!res.ok) throw new Error(`OpenAlex request failed: ${res.status}`);
  return (await res.json()) as T;
}

/** The hit for an OpenAlex work, its abstract rebuilt in Rust (`related_paper_hit`). */
function openAlexToHit(w: OpenAlexWork): RelatedPaperHit | null {
  return undefinedForNull(typedCore().openAlexToHit(w));
}

/** The seed's DOI, or for an arXiv paper the arXiv DOI OpenAlex files it under. */
function seedDoi(seed: PaperSummary): string | undefined {
  return typedCore().seedDoi(seed.doi, seed.arxivId);
}

const workId = (url: string) => url.split("/").pop() ?? "";

/** The same neighbours from OpenAlex: its related works, or the works citing the seed. */
async function openAlexNeighbours(seed: PaperSummary, kind: RelatedKind, limit: number, key?: string) {
  const doi = seedDoi(seed);
  if (!doi) return [];
  const work = await openAlexJson<OpenAlexWork>(
    `${OPENALEX}/doi:${encodeURIComponent(doi).replace(/%2F/gi, "/")}?select=id,related_works`,
    key,
  );
  const related = (work.related_works ?? []).map(workId).filter(Boolean);
  if (!work.id || (kind === "related" && related.length === 0)) return [];
  const params = new URLSearchParams({
    filter: kind === "citedBy" ? `cites:${workId(work.id)}` : `openalex_id:${related.join("|")}`,
    select: OPENALEX_SELECT,
    "per-page": String(limit + 5),
  });
  if (kind === "citedBy") params.set("sort", "cited_by_count:desc");
  const body = await openAlexJson<{ results?: OpenAlexWork[] }>(`${OPENALEX}?${params}`, key);
  return (body.results ?? []).map(openAlexToHit);
}

/**
 * Work like the seed (S2 recommendations, then its references) or the papers
 * citing it. When Semantic Scholar has nothing — throttled, or the paper is
 * unknown to it — OpenAlex is asked the same question.
 *
 * Both the seed and the library are typed on the summary projection: this only
 * reads a paper's identifiers and title, all of which it carries. A full `Paper`
 * satisfies these types as well, so no existing caller changes.
 */
export async function fetchRelatedPapers(
  seed: PaperSummary,
  library: readonly PaperSummary[],
  opts?: { apiKey?: string; openAlexKey?: string; limit?: number; kind?: RelatedKind },
): Promise<RelatedPaperHit[]> {
  const limit = opts?.limit ?? 8;
  const kind = opts?.kind ?? "related";
  const apiKey = opts?.apiKey;
  let state: Collected = { keys: typedCore().localKeys(library), hits: [] };

  const paperId =
    (seed.arxivId && `ARXIV:${seed.arxivId}`) ||
    (seed.doi && `DOI:${readyCore().normalizeDoi(seed.doi)}`) ||
    null;
  if (!paperId) {
    throw new Error("Add a DOI or arXiv id to this paper before finding related work.");
  }

  const sources =
    kind === "citedBy"
      ? [() => s2Citing(paperId, apiKey)]
      : [() => s2Recommended(paperId, limit, apiKey), () => s2References(paperId, apiKey)];
  let failure: unknown;
  for (const source of sources) {
    if (state.hits.length >= limit) break;
    try {
      state = collect(await source(), state, limit);
    } catch (err) {
      failure ??= err;
    }
  }
  if (state.hits.length === 0) {
    try {
      state = collect(await openAlexNeighbours(seed, kind, limit, opts?.openAlexKey), state, limit);
    } catch {
      // Semantic Scholar's error, below, is the one worth showing.
    }
  }
  if (state.hits.length === 0 && failure) throw failure;
  return state.hits;
}

// --- import-local-zotero.use-case ---
/**
 * The Zotero running on this computer: its papers, then their annotations.
 *
 * Separate from `syncBibliography`, which reads the cloud library with an API
 * key. This one needs no key and no account: Zotero 7 serves a read-only copy of
 * the same API on loopback, and the desktop shell is what reaches it. Items not
 * yet in the library become papers first — a copy with no account has no other
 * way to fill its shelf — and annotations are then matched by the `zoteroKey`
 * every pulled paper carries.
 *
 * This orchestration used to be a method on `PapersFacade`, which is where the
 * findings against that class come from: a facade is a screen's view of the
 * container, and this is a workflow. Worse, it reached for the desktop bridge
 * itself, so the only way to test any part of it was to have an Electron shell
 * on the other side. The bridge is injected now, which is the whole point — a
 * test passes the object `desktop()` would have returned.
 */

export interface LocalZoteroImportResult {
  /**
   * How many items the local library added as papers.
   *
   * A count, not the papers: `ZoteroSync.pull()` returns how many it created,
   * and the screen says "3 new papers". The declaration said otherwise for a
   * moment during this extraction and the compiler caught it at the call site,
   * which is the argument for the return type being written down at all.
   */
  papers: number;
  /** How many papers the annotations landed on. */
  annotations: number;
  /** Items the local Zotero answered with. */
  items: number;
}

export class ImportLocalZoteroUseCase {
  constructor(
    private readonly deps: {
      papers: IPaperRepository;
      addPaper: AddPaperUseCase;
      manageTags: ITagManager;
      /**
       * The desktop bridge, or null anywhere but the desktop shell.
       *
       * Async so the composition root can keep importing it lazily: the bridge
       * is only meaningful inside the shell, and the browser build has no use
       * for it. A test supplies a fake and never touches Electron.
       */
      bridge: () => Promise<DesktopBridge | null>;
      /**
       * The Zotero collection this project syncs to, or `undefined` for the
       * whole library.
       *
       * The same per-project setting the cloud sync reads — `projects.zotero_collection`,
       * chosen in Settings — so "read Zotero on this computer" imports the
       * collection the reader is actually working on rather than all 4,000
       * items of their library. Absent means the whole library, which is what a
       * reader who has never picked a collection gets, and is also what the
       * cloud path does.
       *
       * A function rather than a value because the project can change between
       * mounts, and the import must read the setting as it stands when it runs.
       */
      collection?: () => Promise<string | undefined>;
    },
  ) {}

  async execute(): Promise<LocalZoteroImportResult> {
    const bridge = await this.deps.bridge();
    if (!bridge || typeof bridge.zoteroLocal !== "function") {
      throw new Error("Reading the local Zotero needs the WeaveForge desktop app.");
    }

    // Imported here rather than at the top of the file so a browser build does
    // not carry the local-Zotero client: it exists for the desktop shell, and
    // only the desktop shell can reach it.
    const { localZoteroAnnotations, localZoteroLibrary } = await import(
      "@/features/papers/infrastructure/parts-2"
    );

    const collection = this.deps.collection;

    const papers = await localZoteroLibrary(
      bridge,
      {
        listPapers: () => this.deps.papers.list(),
        addPaper: (input) => this.deps.addPaper.addManual(input),
        onItemTags: async (paper, remote) => {
          const names = (remote.tags ?? []).map((t) => t.tag ?? "").filter(Boolean);
          if (names.length === 0) return;
          await this.deps.manageTags.reconcileSources(
            paper.id,
            names.map((name) => ({ name, source: "zotero_item" as const })),
            ["zotero_item"],
          );
        },
      },
      collection,
    ).pull();

    // Scoped to the same collection as the papers, or the annotations would
    // arrive for papers the import deliberately did not take.
    const pulled = toBibliographyAnnotationPull(
      await localZoteroAnnotations(bridge, collection).pull(),
    );
    // Loaded here, not at the top: the container builds this use case on every
    // route, and the merge is only needed once an import actually runs.
    const { applyBibliographyAnnotations } = await import(
      "@/integrations/providers/zotero/apply-bibliography-annotations"
    );
    const annotations = await applyBibliographyAnnotations(
      pulled,
      this.deps.papers,
      this.deps.manageTags,
    );
    return { papers, annotations, items: pulled.byPaper.size };
  }
}

// --- load-papers-screen.use-case ---
export interface PapersScreenData {
  /**
   * **Summaries**, not full papers: the card grid paints a title, authors and
   * tags, and the summary projection carries nothing else. Typing these as
   * `Paper` claimed an `abstract`/`bibtex`/`metadata` every element does not
   * have, which is how a written-back card could drop them (review-2 F6).
   */
  papers: PaperSummary[];
  lists: ReadingList[];
  membership: Map<string, Set<string>>;
  /** paperId -> sharer user id (pinned shared papers). */
  pinnedSharedBy: Map<string, string>;
  /** paperId -> whether the active share grant allows commenting. */
  paperCanComment: Map<string, boolean>;
}

export class LoadPapersScreenUseCase {
  constructor(
    private readonly deps: {
      papers: IPaperRepository;
      lists: IReadingListRepository;
      listItems: IReadingListItemRepository;
      pins?: ILibraryPinRepository;
      shares?: IShareRepository;
    },
  ) {}

  async execute(): Promise<PapersScreenData> {
    const [papers, lists] = await Promise.all([
      // The card projection, required on the port. The `?? list()` fallback that
      // stood here is what pulled every abstract and metadata bag into a list
      // render, on the screens that paint neither.
      this.deps.papers.listSummaries(),
      this.deps.lists.list(),
    ]);
    const items = await this.deps.listItems.listItemsForLists(lists.map((l) => l.id));
    const membership = readyCore().listMembershipByKey(lists, items, "paper");

    const merged = await loadPinnedScreenData(this.deps, {
      resourceType: "paper",
      owned: papers,
      loadById: (id) => this.deps.papers.getById(id),
    });

    return {
      papers: merged.items,
      lists,
      membership,
      pinnedSharedBy: merged.pinnedSharedBy,
      paperCanComment: merged.canComment,
    };
  }
}

// --- merge-papers.use-case ---
/** A merge that would lose something the app cannot carry across. */
export class PaperMergeRefusedError extends ValidationError {
  constructor(message: string) {
    super(message);
    this.name = "PaperMergeRefusedError";
  }
}

/**
 * Folds duplicate papers into the one being kept.
 *
 * Everything that points at a duplicate is moved before the duplicate is
 * deleted: its reader annotations (re-created on the kept paper, with their
 * pins and quotation types following), its list memberships, the custom
 * field values the kept paper has no value for, and its relations. Notes link
 * to papers by title, so they need nothing. The duplicate's row goes last, and
 * only when every step before it succeeded — a failure part-way leaves both
 * papers, with the kept one holding more, never neither.
 *
 * Zotero decides which row survives. When a copy is linked to Zotero, a
 * linked row is the one kept whichever copy the reader picked, and the picked
 * copy's details fold into it — the reader chose which *paper* to keep, and
 * gets it, under a row Zotero knows. (The picked copy's row, when it is itself
 * linked; otherwise the first linked one.) Refusing instead left the reader
 * to guess which radio button the app would accept.
 *
 * When several copies are linked, the library is holding Zotero's own
 * duplicate. The extra linked copies are merged like any other and then
 * removed from Zotero too — the same removal Delete does — because a copy
 * deleted only here is still in Zotero, and the next sync would pull it back
 * as a fresh duplicate. Its Zotero annotations are re-created on the kept
 * paper as the app's own, so nothing the reader wrote goes with it. The Zotero
 * removal runs last, after everything has moved, and a failure there stops
 * before the local row goes: retrying the merge then finishes the job instead
 * of the copy coming back.
 */
export class MergePapersUseCase {
  constructor(
    private readonly deps: {
      papers: IPaperRepository;
      annotations: IReaderAnnotationSource & IReaderAnnotationSink;
      pins: IAnnotationPinRepository;
      quotationTypes: IAnnotationQuotationTypeRepository;
      listItems: IReadingListItemRepository;
      fields: IPaperFieldRepository;
      relations: IPaperRelationRepository;
      /** Removes a merged-away copy's Zotero item. Without it, merging two linked copies is refused. */
      bibliography?: Pick<IBibliographyIntegration, "removeRemotePaper">;
      newId: () => string;
      now?: () => string;
    },
  ) {}

  /** Merge every paper in `duplicateIds` into `keepId`, one at a time. */
  async execute(keepId: string, duplicateIds: readonly string[]): Promise<Paper> {
    const chosen = await this.load(keepId);
    // A duplicate already gone is one an earlier, interrupted run of this
    // merge finished: retrying after a Zotero failure names every copy again,
    // and the ones that went through must not stop the rest.
    const others = (
      await Promise.all(duplicateIds.filter((id) => id !== keepId).map((id) => this.deps.papers.getById(id)))
    ).filter((p): p is Paper => p != null);
    const all = [chosen, ...others];
    const linked = all.filter((p) => zoteroKeyOf(p) != null);
    if (linked.length > 1 && !this.deps.bibliography) {
      throw new PaperMergeRefusedError(
        `${linked.length} of these copies are linked to Zotero. Merge them in Zotero; the next sync brings the result here.`,
      );
    }
    let kept = zoteroKeyOf(chosen) != null ? chosen : (linked[0] ?? chosen);
    const dups = all.filter((p) => p.id !== kept.id);
    // The chosen copy folds in first, so where the survivor has no value its
    // details are the ones that fill it.
    dups.sort((a, b) => Number(b.id === keepId) - Number(a.id === keepId));
    for (const dup of dups) kept = await this.mergeOne(kept, dup);
    return kept;
  }

  private async load(id: string): Promise<Paper> {
    const paper = await this.deps.papers.getById(id);
    if (!paper) throw new PaperMergeRefusedError("One of these papers is no longer in the library. Reload and try again.");
    return paper;
  }

  private async mergeOne(keep: Paper, dup: Paper): Promise<Paper> {
    const { annotations, pins, quotationTypes, listItems, fields, relations } = this.deps;
    const anns = await annotations.list(dup.id);

    // The Rust merge marks an absent field with null; Paper uses undefined.
    const joined = Object.fromEntries(
      Object.entries(readyCore().mergePaperInto(keep, dup)).filter(([, v]) => v !== null),
    ) as unknown as Paper;
    const merged: Paper = { ...joined, authors: joined.authors ?? keep.authors, updatedAt: this.deps.now?.() ?? new Date().toISOString() };
    // A DOI or arXiv id only the duplicate has is unique per project, so the
    // kept row takes it once the duplicate is gone (the save below would be refused).
    const idsMove = merged.doi !== keep.doi || merged.arxivId !== keep.arxivId;
    await this.deps.papers.save(idsMove ? { ...merged, doi: keep.doi, arxivId: keep.arxivId } : merged);

    // Annotations: a new id on the kept paper, so pins keyed by the old id follow.
    // A copy an earlier, interrupted run already made is reused, each at most
    // once, so a retry does not copy every annotation again (25-01).
    const earlier = new Map<string, string[]>();
    for (const k of await annotations.list(keep.id)) {
      const ids = earlier.get(sameAnnotation(k)) ?? [];
      ids.push(k.id);
      earlier.set(sameAnnotation(k), ids);
    }
    const keyMap = new Map<string, string>();
    for (const a of anns) {
      const reused = earlier.get(sameAnnotation(a))?.shift();
      if (reused) {
        keyMap.set(a.id, reused);
        continue;
      }
      const copy = await annotations.create(keep.id, {
        type: a.type,
        color: a.color,
        text: a.text,
        comment: a.comment,
        tags: a.tags,
        anchor: a.anchor,
        sortIndex: a.sortIndex,
        pageIndex: a.anchor.zoteroPosition?.pageIndex ?? 0,
      });
      keyMap.set(a.id, copy.id);
    }
    const keyFor = (k: string) => keyMap.get(k) ?? k;

    const keptPins = new Set((await pins.listForPaper(keep.id)).map((p) => p.annotationKey));
    for (const pin of await pins.listForPaper(dup.id)) {
      const key = keyFor(pin.annotationKey);
      if (!keptPins.has(key)) await pins.save({ paperId: keep.id, annotationKey: key, reportSectionId: pin.reportSectionId });
      await pins.remove(dup.id, pin.annotationKey);
    }
    const keptTypes = new Set((await quotationTypes.listForPaper(keep.id)).map((q) => q.annotationKey));
    for (const q of await quotationTypes.listForPaper(dup.id)) {
      const key = keyFor(q.annotationKey);
      if (!keptTypes.has(key)) await quotationTypes.save({ paperId: keep.id, annotationKey: key, quotationType: q.quotationType });
      await quotationTypes.remove(dup.id, q.annotationKey);
    }

    for (const item of await listItems.listsForPaper(dup.id)) {
      if (!(await listItems.find(item.listId, keep.id))) {
        await listItems.add({ ...item, id: this.deps.newId(), paperId: keep.id });
      }
      await listItems.remove(item.id);
    }

    const keptFields = new Set((await fields.listValuesForPaper(keep.id)).map((v) => v.fieldId));
    for (const v of await fields.listValuesForPaper(dup.id)) {
      if (!keptFields.has(v.fieldId)) await fields.setValue({ paperId: keep.id, fieldId: v.fieldId, value: v.value });
    }

    for (const rel of await relations.relationsFor(dup.id)) {
      const fromPaper = rel.fromPaper === dup.id ? keep.id : rel.fromPaper;
      const toPaper = rel.toPaper === dup.id ? keep.id : rel.toPaper;
      const pointless = fromPaper === toPaper;
      if (!pointless && !(await relations.findEdge(fromPaper, toPaper, rel.relation))) {
        await relations.save({ ...rel, id: this.deps.newId(), fromPaper, toPaper });
      }
      await relations.delete(rel.id);
    }

    for (const a of anns) await annotations.remove(a.id);
    const zoteroKey = zoteroKeyOf(dup);
    if (zoteroKey != null) {
      try {
        await this.deps.bibliography?.removeRemotePaper(zoteroKey);
      } catch (err) {
        const why = err instanceof Error ? ` (${err.message})` : "";
        throw new PaperMergeRefusedError(
          `Everything from “${dup.title}” was moved, but Zotero would not remove its copy${why}. Run the merge again once Zotero is reachable.`,
        );
      }
    }
    // The row itself, directly: its images and PDF now belong to the kept
    // paper, so the delete path that removes a paper's images must not run.
    await this.deps.papers.delete(dup.id);
    // A delete the store refused without an error — a row-level policy that
    // matches nothing answers with success — would leave the pair in place and
    // the tidy-up offering the same merge for ever. Say so instead.
    if (await this.deps.papers.getById(dup.id)) {
      throw new PaperMergeRefusedError(
        `Everything from “${dup.title}” was moved, but the copy itself could not be removed. Delete it from the list by hand.`,
      );
    }
    if (idsMove) await this.deps.papers.save(merged);
    return merged;
  }
}

/** What makes two annotations the same mark: everything but id and paper. */
function sameAnnotation(a: {
  type: string;
  color?: string | null;
  text?: string | null;
  comment?: string | null;
  anchor?: unknown;
}): string {
  return typedCore().annotationIdentity(a);
}

function zoteroKeyOf(paper: Paper): string | undefined {
  return typedCore().zoteroKeyOf(paper.metadata);
}
