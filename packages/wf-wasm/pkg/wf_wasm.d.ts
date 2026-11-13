/* tslint:disable */
/* eslint-disable */

/**
 * Drop the entries of a related list that name something already listed: the
 * same entity, or the same title within the same kind, or a cut-off copy of a
 * listed title. The first (best-ranked) entry wins, so order is kept. `merge` is
 * told about each entry it absorbed. The records themselves are left alone.
 */
export function distinctRelated<T extends { id: string }>(
results: readonly T[],
resolve: (id: string) => { kind: string; entityId: string; title: string } | null,
limit?: number,
seedId?: string,
merge?: (kept: T, dropped: T) => void,
): T[];



/**
 * The annotations a write-back sends: everything but ink, and only those with a
 * PDF page. The caller's own objects come back, in order.
 */
export function zoteroWriteBackAnnotations<T extends B.ZoteroAnnotationLocal>(annotations: readonly T[]): T[];



/**
 * The nodes whose id is in `allowed` (all of them when `null`), and the links whose two
 * endpoints both remain. Works on copies: the inputs are not mutated.
 */
export function filterGraphByNodes<T extends { id: string }, L extends Record<"source" | "target", string | { id: string }>>(nodes: T[], links: L[], allowed: Set<string> | null): { nodes: T[]; links: L[] };
/** Copies of the links with string endpoints, every other field kept. */
export function cloneLinks<L extends Record<"source" | "target", string | { id: string }>>(links: L[]): (L & Record<"source" | "target", string>)[];



/**
 * What a partial refresh must touch, and the prints to remember after it.
 * `add` holds the fresh documents to (re)tokenise, and `remove` the held ids
 * that no longer exist.
 */
export function diffRefreshPlan<T extends { id: string }>(
prints: ReadonlyMap<string, string>,
held: readonly string[],
fresh: readonly T[],
): { remove: string[]; add: T[]; prints: Map<string, string> };



/**
 * Zotero and local rows as one list sorted by `sortIndex`. A local row wins on id
 * collision, and a Zotero row a local row already sent to Zotero is dropped.
 * Returns copies of the rows, not the same objects.
 */
export function mergeReaderAnnotations<T extends { id: string; zoteroKey?: string | null; sortIndex: string }>(
zotero: readonly T[],
local: readonly T[],
): T[];



/**
 * `items` with the recently opened ones moved to the front, in visit order and
 * flagged `recent`. A recent target that no longer matches an item is skipped.
 */
export function pinRecentTargets<T extends { kind: string; id: string }>(items: readonly T[], recents: readonly { kind: string; id: string }[]): (T & { recent?: true })[];



/** A clickable thing found in the page text. Shape of the Rust MentionHit, serialised camelCase. */
export interface MentionHit {
    key: string;
    kind: "citation" | "figure" | "url";
    start: number;
    end: number;
    label: string;
    url?: string;
    refIndexes: number[];
    rects?: number[][];
    target?: unknown;
    source?: string;
    confidence?: number;
}

/** One parsed bibliography entry as the core serialises it. Callers pick a richer type through the generic `R`. */
export interface ParsedReferenceEntry {
    index: number;
    raw: string;
}

export interface ReaderReferenceIndex<R extends ParsedReferenceEntry = ParsedReferenceEntry> {
    references: R[];
    byIndex: Map<number, R>;
    mentionsByPage: Map<number, MentionHit[]>;
    bodyFontSize: number;
    fingerprint: string;
}

/** The page shape the core reads: 1-based page number, text items, and `/Link` annotations. */
export interface ReferencePage {
    pageNumber: number;
    items: readonly { str: string; hasEOL?: boolean }[];
    links?: readonly object[];
}

/** Shape a completed analysis (plain arrays from the worker) into the overlay's index. */
export function indexFromAnalysis<R extends ParsedReferenceEntry = ParsedReferenceEntry>(
analysis: unknown,
pages: readonly ReferencePage[],
): ReaderReferenceIndex<R>;

/** Analyze the pages and shape the result in one step. */
export function buildReferenceIndex<R extends ParsedReferenceEntry = ParsedReferenceEntry>(
pages: readonly ReferencePage[],
outline?: readonly unknown[],
): ReaderReferenceIndex<R>;



/** A file in the export package: its path inside the package and its text. */
export interface OverleafExportFile {
    path: string;
    contents: string;
}

/** A binary figure to fetch and place under `figures/`. */
export interface OverleafExportImage {
    /** Storage path after `reportimg:` (ownerId/sectionId/file). */
    storagePath: string;
    /** Relative ZIP path, e.g. `figures/uuid.webp`. */
    zipPath: string;
}

/** Counts the section walk adds to the export stats. */
export interface OverleafWalkStats {
    sections: number;
    equationsApprox: number;
    figures: number;
}

/** The section walk's result. */
export interface OverleafSectionWalk {
    /** Body lines for `main.tex`. */
    out: string[];
    warnings: string[];
    images: OverleafExportImage[];
    stats: OverleafWalkStats;
}

/** Options for {@link walkOverleafSections}. */
export interface OverleafWalkOptions {
    includeNotes: boolean;
    /** Normalized paper title to bib key; when set, `[[wikilinks]]` become `\cite{key}`. */
    citeByTitle?: ReadonlyMap<string, string>;
}



/** Each position's height, with the saved height put back where the card has one. */
export function withStoredHeights<T extends { i: string; h: number }>(
rgl: readonly T[],
stored: readonly B.LayoutItem[],
): T[];



/** Keyword hits that matched enough of the query to be worth fusing. */
export function coveredHits<T extends { queryTerms?: readonly string[] }>(
hits: readonly T[],
termCount: number,
minCoverage?: number,
): T[];
/** Vector hits, best first, gated by the encoder's floor. */
export function gateVectorHits<T extends { score: number }>(
hits: readonly T[],
floor: number,
keepTop?: number,
): T[];



/** Lines grouped by (near-)identical text; the members are the caller's own line objects. */
export function groupRecurringLines<T>(lines: readonly T[], textOf: (line: T) => string, pageOf: (line: T) => number): { key: string; pages: Set<number>; members: T[] }[];



/** One planned MCP tool call. The host runs the matching call and then, for drafts, checks evidence. */
export type McpPlan =
| { op: 'searchWorkspace'; query: string; limit?: number }
| { op: 'getSourceExcerpt'; sourceId: string }
| { op: 'getWorkspaceOutline' }
| { op: 'proposeZoteroImport'; title: string; authors: string[]; doi?: string; url?: string; year?: string | number; abstract?: string }
| { op: 'proposeDraft'; kind: string; tool: string; resourceId?: string; resourceType?: string; expectedRevision?: string; content: string; payload: Record<string, unknown>; evidence?: McpEvidenceRequest };

/** Paper-scoped evidence a draft asked for, before the excerpt is checked. */
export interface McpEvidenceRequest { paperId: string; sourceId: string; quoteExact?: string; quotePrefix?: string; quoteSuffix?: string; page?: number }

/** The excerpt the host resolved for a source; only the fields the check reads. */
export interface McpExcerptDoc { text?: string; source?: { resourceType?: string; resourceId?: string; label?: string; href?: string } }

/** One checked evidence item, as a draft carries it. */
export interface McpEvidence {
    sourceId: string;
    excerpt: string;
    label?: string;
    paperId: string;
    href?: string;
    locus?: { quote: { type: 'TextQuoteSelector'; exact: string; prefix?: string; suffix?: string } };
    page?: number;
}



/** One provider request: where to send it, with which headers, and its JSON body. */
export interface ByokRequest { url: string; headers: Record<string, string>; body: Record<string, unknown> }



/** One ranked citation candidate as the alert log shows it; counts are formatted by the caller. */
export interface CitationAlertLogItem {
    title: string;
    url?: string;
    authors?: string[];
    year?: string;
    citationCount?: number;
    citationCountText?: string;
    isInfluential?: boolean;
    intents?: string[];
}

/** A library paper's identifiers, as the citation match reads them. */
export interface CitationLibraryEntry { id: string; arxivId?: string | null; doi?: string | null }

/** A reference a paper cites, as the citation match reads it. */
export interface CitationPaperRef { kind: 'arxiv' | 'doi' | 'url' | 'zotero' | 'bibliographic'; value: string; hints?: { title?: string; year?: number; firstAuthor?: string } }



/** The box moved so at least half of it stays on the page; the same object when it already fits. */
export function keepFigureOnPage<T extends B.FigureRect>(one: T, pageSize: { width: number; height: number }): T;



/** The figures with the one at `index` moved; "front" is the end of the array. */
export function reorderFigures<T>(figures: readonly T[], index: number, step: B.FigureOrderStep): T[];



/** The node fields recolouring reads. `color` is written back in place. */
export interface RecolourableNode {
    id: string;
    label: string;
    color: string;
    paperId?: string;
    year?: number;
    tagName?: string;
}

/** The lookups recolouring needs beyond the nodes and links. */
export interface RecolourLookups {
    papers: ReadonlyMap<string, { id: string; title: string; status?: string; tags: readonly string[] }>;
    /** Hashtags per note id. */
    noteTags: ReadonlyMap<string, readonly string[]>;
    /** Paper ids per list id. */
    membership: ReadonlyMap<string, ReadonlySet<string>>;
    lists: readonly { id: string; name: string }[];
}



/** The palette name a hex colour came from, or `null`. */
export function paletteName<K extends string>(palette: Readonly<Record<K, readonly [number, number, number]>>, hex: string): K | null;



/** The paper fields a `.bib` entry reads, as a `Paper` supplies them. */
export interface BibPaperInput {
    id: string;
    title: string;
    authors?: readonly string[];
    year?: number;
    venue?: string;
    doi?: string;
    arxivId?: string;
    url?: string;
    bibtex?: string;
    metadata?: Record<string, unknown>;
}



/** The supervision team: the viewer plus all supervisees, at any depth. */
export function filterTeamMembers<T extends B.MemberLink>(
viewerId: string,
members: readonly T[],
options: { inLab: boolean; orgMemberIds?: ReadonlySet<string> | null },
): T[];
/** The full active-lab roster, for the org chart. */
export function filterLabMembers<T extends B.MemberLink>(
viewerId: string,
members: readonly T[],
options: { inLab: boolean; orgMemberIds?: ReadonlySet<string> | null },
): T[];
/** The people below `viewerId` in the supervisor tree, at any depth. */
export function studentsOf<T extends B.MemberLink>(viewerId: string | undefined, team: readonly T[]): T[];



/** What the export package is built from: the section walk output and the export options. */
export interface OverleafExportFilesInput {
    /** Body lines for `main.tex` (the section walk's `out`). */
    body: string[];
    /** Warnings the section walk raised. */
    walkWarnings: string[];
    /** Figures to place under `figures/`. */
    images: OverleafExportImage[];
    sections: number;
    equationsApprox: number;
    figures: number;
    /** Document title; blank or absent uses the default title. */
    title?: string;
    includeBibliography: boolean;
    bibliographyScope?: 'all' | 'cited';
    /** ISO 8601 export time, written into the manifest and README. */
    exportedAt: string;
}

/** A library paper for `references.bib`, with the cite key chosen for it. */
export interface OverleafBibEntryInput {
    paper: BibPaperInput;
    key: string;
}

/** The built export package. */
export interface OverleafExportPackage {
    files: OverleafExportFile[];
    warnings: string[];
    stats: {
        sections: number;
        equationsApprox: number;
        bibliographyEntries: number;
        figures: number;
    };
}



/** What to store for one series: grid points plus the newest, and a superseded tip to delete. */
export function planSeriesIngest<T extends { step: number }>(
points: readonly T[],
previousMaxStep: number | null,
): { keep: T[]; supersededTipStep: number | null };


import type * as B from "../src/bindings.js";
import type * as T from "../src/ts-types.js";
import type { ReadonlyInput as R } from "../src/readonly-input.js";


/**
 * Single policy evaluator shared by in-app tools and the MCP adapter. `evaluate` reads the
 * clock (`new Date().toISOString()`) when the input carries no `now`.
 */
export class AiAccessPolicy {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * [`evaluate_ai_access`](access_policy::evaluate_ai_access) at `input.now`, or at the
     * current time when `now` is absent. Other extra fields are ignored.
     *
     * # Errors
     *
     * Fails if `input` has the wrong shape or `now` is not a string.
     */
    evaluate(input: R<B.AiPolicyInput> & { now?: string }): T.AiPolicyDecision;
    /**
     * A policy evaluator; it holds no state.
     */
    constructor();
}

/**
 * [`ArchiveBudget`](archive::ArchiveBudget): the caps an import is held to, checked as
 * entries are inflated. `limits` is `{ maxTotalBytes, maxFileBytes, maxEntries }`.
 */
export class ArchiveBudget {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * [`admit`](archive::ArchiveBudget::admit). `original_size` is a JS number; the
     * cast saturates, so a huge declared size is refused rather than wrapped.
     *
     * # Errors
     *
     * Throws past the entry count or the total cap.
     */
    admit(name: string, original_size: number): boolean;
    /**
     * # Errors
     *
     * Fails if `limits` has the wrong shape.
     */
    constructor(limits: any);
    /**
     * Names refused as over the file cap, in archive order.
     */
    readonly oversize: string[];
}

/**
 * [`EraserSweepState`](Core): one erase sweep. Pointer ids are the DOM `pointerId`s.
 */
export class EraserSweepState {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Starts a sweep; `pen_eraser` is whether the pointer is the pen's eraser end.
     */
    begin(pointer_id: number, tool_erases: boolean, tip_erases: boolean, pen_eraser: boolean): "none" | "show" | "keep" | "restore";
    /**
     * Ends the sweep `pointer_id` owns.
     */
    end(pointer_id: number): "none" | "show" | "keep" | "restore";
    /**
     * A hover by `pointer_id`.
     */
    hover(pointer_id: number): "none" | "show" | "keep" | "restore";
    /**
     * The pointer `pointer_id` left the surface.
     */
    leave(pointer_id: number): "none" | "show" | "keep" | "restore";
    constructor();
    /**
     * Whether `pointer_id` is the one sweeping.
     */
    owns(pointer_id: number): boolean;
    /**
     * A down by `pointer_id` that did not erase.
     */
    release(pointer_id: number): "none" | "show" | "keep" | "restore";
}

/**
 * The accepted samples of one update, read back as typed arrays.
 */
export class InkCaptureBatch {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * One flag byte per accepted sample: `FLAG_PREDICTED` and `FLAG_DISPATCHED`.
     */
    flags(): Uint8Array;
    /**
     * Accepted samples as `x, y, pressure, t, velocity` per sample. Doubles, as the filter
     * computed them; the writer rounds to Float32 when it stores them.
     */
    samples(): Float64Array;
    /**
     * How many samples were accepted.
     */
    readonly count: number;
}

/**
 * [`CaptureStream`](CoreStream): the filter and the last real sample across updates.
 */
export class InkCaptureStream {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Filter one pointer update. `raw` is flat `x, y, pressure, t, timeStamp, flags`
     * per sample (NaN for an absent `t` or `timeStamp`, NaN `x` for off the page);
     * `now` is the fallback time.
     */
    consume(raw: Float64Array, now: number): InkCaptureBatch;
    /**
     * The stroke ended or was dropped: forget the last real sample.
     */
    forgetLast(): void;
    /**
     * A stream with the tuned pen channels.
     */
    constructor();
    /**
     * A new stroke: the filter starts clean.
     */
    resetFilter(): void;
}

/**
 * [`RoutePicker`]: one down's route picker, built per down and driven to a route.
 */
export class InkRoutePicker {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Feeds the answer to the last question and returns the next step.
     *
     * # Errors
     *
     * Fails only if the step cannot be converted to a JS value.
     */
    answer(yes: boolean): B.InkRouteStep;
    /**
     * A picker for a down with these facts; an unknown `tool` reads as `"none"`.
     *
     * # Errors
     *
     * Fails if `facts` is not an `InkRouteFacts` object.
     */
    constructor(facts: B.InkRouteFacts);
    /**
     * The first step: the back-tip sweep question.
     *
     * # Errors
     *
     * Fails only if the step cannot be converted to a JS value.
     */
    start(): B.InkRouteStep;
}

/**
 * The live packer: [`CorePacker`] fed one pen sample at a time, so the
 * stroke drawn while writing is the one saved on lift.
 */
export class InkStrokePacker {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * The kept points so far, then the pen's latest sample, as flat x,y pairs.
     */
    points(): Float64Array;
    /**
     * One pressure byte per point of [`InkStrokePacker::points`].
     */
    pressures(): Float64Array;
    /**
     * Adds the pen's next sample, in 0.1 mm, with its 0-255 pressure if it
     * has one. A non-finite sample is skipped.
     */
    push(x: number, y: number, pressure?: number | null): void;
}

/**
 * The stored documents of one MiniSearch index, with filters, document boosts and hit mapping.
 */
export class MiniSearchDocs {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * The document boost for MiniSearch's `boostDocument`; `1` for an unknown id.
     */
    boostOf(id: string, now: number): number;
    /**
     * Every document's boost in one call: `{ ids, boosts }` as parallel arrays.
     *
     * # Errors
     *
     * Fails only if the table cannot be encoded.
     */
    boosts(now: number): any;
    clear(): void;
    /**
     * Every `[id, document]` pair in insertion order, as persisted.
     *
     * # Errors
     *
     * Fails only if the documents cannot be encoded.
     */
    entries(): any;
    /**
     * Filter-only hits, best first, up to `limit`. `kinds` is the caller's kind list or `null`.
     *
     * # Errors
     *
     * Fails when `query` or `kinds` cannot be read.
     */
    filterOnly(query: any, kinds: any, limit: number, now: number): any;
    /**
     * Ranked hits from MiniSearch `candidates` that pass the filters, up to `limit`. Returns
     * an empty array when nothing passes, which is the TS retry signal.
     *
     * # Errors
     *
     * Fails when an argument cannot be read, or when a hit's terms exceed the excerpt cap.
     */
    finish(candidates: any, query: any, kinds: any, limit: number, now: number, excerpts: boolean): any;
    /**
     * Whether a document with this id is held.
     */
    has(id: string): boolean;
    /**
     * The hit for one document, or `null` when it is not held.
     *
     * # Errors
     *
     * Fails only if the hit cannot be encoded.
     */
    hitById(id: string): any;
    /**
     * Ids of the documents whose kind is one of `kinds`, in insertion order.
     *
     * # Errors
     *
     * Fails when `kinds` is not an array of kind names.
     */
    idsOfKind(kinds: any): any;
    constructor();
    /**
     * Insert or replace each record, in array order.
     *
     * # Errors
     *
     * Fails when `records` is not an array of stored documents.
     */
    put(records: any): void;
    /**
     * Remove by id; unknown ids are ignored.
     */
    remove(id: string): void;
    /**
     * Ranking settings from the TS `SearchSettings`, normalized as before.
     *
     * # Errors
     *
     * Fails if `settings` cannot be read as JSON.
     */
    setSettings(settings: any): void;
}

/**
 * [`NibFilter`](CoreNibFilter): the pen-level filter (position and pressure, one state).
 * The state is shared with the restore functions [`Self::save`] hands out.
 */
export class NibFilter {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Filter one raw sample into `{ x, y, pressure, velocity, t }`.
     *
     * # Errors
     *
     * Fails if `sample` is not a `NibSample`-shaped object.
     */
    filter(sample: B.NibSample): B.FilteredNibSample;
    /**
     * `options` is `{ position, pressure }`, each `{ minCutoff, beta, derivativeCutoff }`.
     *
     * # Errors
     *
     * Fails if `options` does not hold two `OneEuroOptions`-shaped objects.
     */
    constructor(options: { position: B.OneEuroOptions; pressure: B.OneEuroOptions });
    /**
     * Start a new stroke: no state carries over from the last one.
     */
    reset(): void;
    /**
     * Snapshot the filter now; the returned function restores that snapshot.
     */
    save(): () => void;
    /**
     * The speed the filter saw, in 0.1 mm per ms, from the *raw* samples. Raw
     * rather than filtered: the velocity taper is a drawing property.
     */
    readonly speed: number;
}

/**
 * [`OneEuroFilter`](CoreOneEuroFilter): one scalar channel, held across calls.
 */
export class OneEuroFilter {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Filter one sample taken at `time` milliseconds; returns the filtered value.
     */
    filter(value: number, time: number): number;
    /**
     * `options` is `{ minCutoff, beta, derivativeCutoff }`.
     *
     * # Errors
     *
     * Fails if `options` is not a `OneEuroOptions`-shaped object.
     */
    constructor(options: B.OneEuroOptions);
    /**
     * Forget everything. Called at pen-down: a new stroke is a new signal.
     */
    reset(): void;
    /**
     * The last filtered value, or `null` before the first sample.
     */
    readonly last: number | null;
    /**
     * The last estimated speed, in value units per millisecond.
     */
    readonly speed: number;
}

/**
 * The search index's bookkeeping (wf-core `SearchIndexStateCore`): whether an index is held,
 * its document count, PDF pages per paper, and the stale kinds. The caller keeps the JS handles
 * (index, graph, density, PDF texts) and clears them when `forget` runs.
 */
export class SearchIndexState {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Takes the index as built, holding `documentCount` documents.
     */
    adopt(document_count: number): void;
    /**
     * Nothing is indexed any more; the next build starts from scratch.
     */
    forget(): void;
    /**
     * Notes the kinds a write to `resourceType` can change. Returns `true` when the whole index
     * was distrusted (an unmapped type), so the caller has nothing left to refresh selectively.
     */
    markStale(resource_type?: string | null): boolean;
    /**
     * Nothing indexed yet.
     */
    constructor();
    /**
     * Pages held for `paperId`; 0 when none.
     */
    pdfPageCount(paper_id: string): number;
    /**
     * The kinds waiting to be refreshed. Taking does not clear them.
     *
     * # Errors
     *
     * Fails only if the result cannot be serialized.
     */
    pendingStale(): B.SearchKind[];
    /**
     * Replaces every paper's page count from a `Map` or a `[paperId, pages][]` iterable.
     *
     * # Errors
     *
     * Fails if `counts` is not iterable or an entry is not a `[string, number]` pair.
     */
    replacePdfPageCounts(counts: Iterable<readonly [string, number]>): void;
    /**
     * Records the page count held for `paperId`.
     */
    setPdfPageCount(paper_id: string, count: number): void;
    /**
     * Forgets the kinds a completed refresh replaced.
     *
     * # Errors
     *
     * Fails if `kinds` is not an array of search kinds.
     */
    settleStale(kinds: readonly B.SearchKind[]): void;
    /**
     * Documents the index holds, for the size warning.
     */
    documentCount: number;
    /**
     * Whether an index has been adopted and not forgotten.
     */
    readonly ready: boolean;
}

/**
 * [`StrokeEdgeSplit`](Core): one stroke against the drawable area.
 */
export class StrokeEdgeSplit {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Starts a stroke at `at`.
     *
     * # Errors
     *
     * Fails if `at` is not a point.
     */
    begin(at: B.Point): void;
    /**
     * Forgets the stroke; true when it ended off the paper.
     */
    end(): boolean;
    /**
     * One move as `{ kind, at? }`. A `null` area means everywhere is paper.
     *
     * # Errors
     *
     * Fails if `at` is not a point, the area cannot be read, or the step cannot
     * be serialised.
     */
    move(at: B.Point, area: B.DrawArea | null): B.EdgeStepResult;
    /**
     * A split with no stroke begun.
     */
    constructor();
    /**
     * Whether the stroke is currently off the paper.
     */
    readonly outside: boolean;
}

/**
 * Brute-force cosine index over normalized vectors.
 */
export class VectorIndex {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Insert or replace; `values` is `ids.length * dimensions` long and is all-or-nothing.
     *
     * # Errors
     *
     * Fails when `ids` is not a string array or `values` has the wrong length.
     */
    add(ids: string[], values: Float32Array): void;
    /**
     * Every id held, in slot order.
     */
    allIds(): string[];
    /**
     * Drop every vector.
     */
    clear(): void;
    /**
     * Whether `id` is held.
     */
    has(id: string): boolean;
    /**
     * Documents nearest to one already indexed, from its own passages (wf-core `semantic_hits::nearest_docs`).
     *
     * # Errors
     *
     * Fails when a stored passage is not the index width.
     */
    nearestDocs(doc_id: string, limit: number): { id: string; score: number }[];
    /**
     * Remove by id; unknown ids are ignored.
     *
     * # Errors
     *
     * Fails when `ids` is not a string array.
     */
    remove(ids: string[]): void;
    /**
     * Nearest documents to `query`, one hit per document (wf-core `semantic_hits::search_docs`).
     *
     * # Errors
     *
     * Fails when `query` is not the index width.
     */
    searchDocs(query: Float32Array, limit: number): { id: string; score: number }[];
    /**
     * Top `limit` by cosine similarity, best first; scores below `minScore` are dropped.
     *
     * # Errors
     *
     * Fails when `query` is not the index width.
     */
    search(query: Float32Array, limit: number, min_score: number): { id: string; score: number }[];
    /**
     * The packed bytes; read back with `vectorIndexFromBytes`.
     */
    toBytes(): Uint8Array;
    /**
     * The stored unit vector for `id`; empty when absent (dimensions are at least 1).
     */
    vectorOf(id: string): Float32Array;
    /**
     * The width every vector must have.
     */
    readonly dimensions: number;
    /**
     * How many vectors are held.
     */
    readonly size: number;
}

/**
 * [`absolute_point_triples`](chunk_read::absolute_point_triples): every point as `Int16` triples.
 *
 * # Errors
 *
 * Fails on a body whose tables do not add up.
 */
export function absolutePointTriples(body: Uint8Array): Int16Array;

/**
 * [`account_menu::account_attention`]: the menu rows and the icon total as `{ rows, total }`.
 *
 * # Errors
 *
 * Fails if `input` is not an `AccountAttentionInput`-shaped object, or the result cannot be converted to JS.
 */
export function accountAttention(input: B.AccountAttentionInput): B.AccountAttention;

/**
 * [`account_links::account_links`]: the account block's rows as `{ id, label, href?, external? }`.
 *
 * # Errors
 *
 * Fails if `input` is not an `AccountLinksInput`-shaped object, or the result cannot be converted to JS.
 */
export function accountLinks(input: B.AccountLinksInput): B.AccountLink[];

/**
 * [`acronyms_for_title`](acronyms::acronyms_for_title) as a JS array of strings.
 *
 * # Errors
 *
 * Fails only if the result cannot be converted to a JS value.
 */
export function acronymsForTitle(title: string): string[];

/**
 * [`activate_tab`](pane::activate_tab).
 *
 * # Errors
 *
 * Fails if `layout` has the wrong shape.
 */
export function activateTab(layout: B.PaneLayout, pane_id: string, index: number): B.PaneLayout;

/**
 * [`active_tab`](pane::active_tab). Takes a leaf; `undefined` when it has no active tab.
 *
 * # Errors
 *
 * Fails if `leaf` has the wrong shape.
 */
export function activeTab(leaf: B.PaneLeaf): B.TabRef | undefined;

/**
 * [`active_tab_key`](pane::active_tab_key); `undefined` when there is none.
 *
 * # Errors
 *
 * Fails if `layout` has the wrong shape.
 */
export function activeTabKey(layout: B.PaneLayout): string | undefined;

/**
 * [`active_tab_ref`](pane::active_tab_ref); `undefined` when there is none.
 *
 * # Errors
 *
 * Fails if `layout` has the wrong shape.
 */
export function activeTabRef(layout: B.PaneLayout): B.TabRef | undefined;

/**
 * [`wf_core::sync::json_entities::add_counts`] for JS.
 *
 * # Errors
 *
 * Fails when either argument is not action counts.
 */
export function addCounts(a: Readonly<B.ActionCounts>, b: Readonly<B.ActionCounts>): B.ActionCounts;

/**
 * [`add_days`](feed::add_days): `iso` moved by `days` calendar days.
 *
 * # Errors
 *
 * Throws if `iso` is not a real `yyyy-mm-dd` date.
 */
export function addDays(iso: string, days: number): string;

/**
 * [`added_notice`]: what an add says.
 */
export function addedNotice(created: boolean): string;

/**
 * [`admit_asset_bytes`](preview_read::admit_asset_bytes): whether an asset's real bytes are kept,
 * and the running total. Called once per asset that was read, in order.
 *
 * # Errors
 *
 * Throws when keeping the asset would pass the total cap.
 */
export function admitAssetBytes(running_total: number, byte_len: number, limits: { maxTotalBytes: number; maxFileBytes: number }): { keep: boolean; total: number };

/**
 * [`adopted_account`] for JS (TS `Adoption.run` gate): the account that refuses a second
 * adoption, or undefined when the device may adopt.
 */
export function adoptedAccount(account_id?: string | null): string | undefined;

/**
 * [`after_cycle`]: the phase a finished cycle leaves. `stopped_because` is the push's stop reason, or null.
 *
 * # Errors
 *
 * Fails if the result cannot be serialised.
 */
export function afterCycle(stopped_because?: string | null): { phase: "idle" | "offline" | "error"; isOnline: boolean };

/**
 * [`after_failure`]: the phase a cycle that threw leaves.
 *
 * # Errors
 *
 * Fails if the result cannot be serialised.
 */
export function afterFailure(online: boolean): { phase: "idle" | "offline" | "error"; isOnline: boolean };

/**
 * [`agreement_between`](screening::agreement_between) (TS `agreementBetween`).
 *
 * # Errors
 *
 * Fails if an argument has the wrong shape.
 */
export function agreementBetween(decisions: readonly B.ScreeningDecision[], reviewers: [string, string], stage: B.ScreeningStage): B.Agreement;

/**
 * [`AI_CREDENTIAL_PROTECTED_PROPOSAL_KINDS`](access_policy::AI_CREDENTIAL_PROTECTED_PROPOSAL_KINDS):
 * proposal kinds that need encrypted Zotero credentials (empty).
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 */
export function aiCredentialProtectedProposalKinds(): readonly B.AiProposalKind[];

/**
 * [`AI_PROPOSAL_KINDS`](access_policy::AI_PROPOSAL_KINDS): proposal kinds the assistant may suggest.
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 */
export function aiProposalKinds(): readonly B.AiProposalKind[];

/**
 * [`AI_READ_CATEGORIES`](access_policy::AI_READ_CATEGORIES): read categories an AI session may be granted.
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 */
export function aiReadCategories(): readonly B.AiReadCategory[];

/**
 * [`ai_read_category_for_resource`](access_policy::ai_read_category_for_resource).
 *
 * # Errors
 *
 * Fails if `resourceType` is not a known resource type.
 */
export function aiReadCategoryForResource(resource_type: B.AiResourceType): B.AiReadCategory;

/**
 * [`align_series`]: overlaid runs on one union step axis, gaps as `null`.
 */
export function alignSeries(series: B.ChartSeries[]): B.AlignedChart;

/**
 * [`analyze_pdf_document`](document_analysis::analyze_pdf_document) (TS `analyzePdfDocument`).
 *
 * # Errors
 *
 * Fails if `pages` is not an array of analysis pages or `outline` not an array of outline items.
 */
export function analyzePdfDocument(pages: readonly B.AnalysisPdfPage[], outline?: readonly B.OutlineReaderItem[]): B.DocumentAnalysis;

/**
 * [`anchor_at`](text_anchor::anchor_at): the anchor, or `null`.
 *
 * # Errors
 *
 * Fails only if the result cannot be converted to a JS value.
 */
export function anchorAt(text: string, start: number, end: number): B.CommentAnchor | null;

/**
 * [`annotation_doc_id`](search_document::annotation_doc_id).
 */
export function annotationDocId(annotation_id: string): string;

/**
 * [`annotation_identity`] (TS `sameAnnotation`): the key two annotations share when they are
 * the same mark.
 *
 * # Errors
 *
 * Fails if `annotation` is not a JSON-like object.
 */
export function annotationIdentity(annotation: { type: string; color?: string | null; text?: string | null; comment?: string | null; anchor?: unknown }): string;

/**
 * [`annotation_pin_key`]: the Zotero key when present and non-blank, else the local id.
 */
export function annotationPinKey(id: string, zotero_key?: string | null): string;

/**
 * [`to_domain`](annotation_pin::to_domain) (TS `annotationPinToDomain`).
 *
 * # Errors
 *
 * Fails if `row` is not an annotation pin row, or the result cannot be converted.
 */
export function annotationPinToDomain(row: B.AnnotationPinRow): B.AnnotationPin;

/**
 * [`canonical_app_url`](app_protocol::canonical_app_url): the URL with its
 * path's repeated slashes collapsed, or `null` when no redirect is needed.
 *
 * # Errors
 *
 * Fails only if the result cannot be turned into a JS value.
 */
export function appCanonicalUrl(request_url: string): string | null;

/**
 * [`content_type_for`](app_protocol::content_type_for).
 */
export function appContentTypeFor(file: string): string;

/**
 * [`app_file_candidates`](app_protocol::app_file_candidates) as an array of
 * paths in try order, or `null` when the request is not inside `root`.
 * `sep` is the platform separator (its first character is used).
 *
 * # Errors
 *
 * Fails only if the result cannot be turned into a JS value.
 */
export function appFileCandidates(root: string, request_url: string, sep: string): string[] | null;

/**
 * [`app_headers`](app_protocol::app_headers) as a plain object.
 *
 * # Errors
 *
 * Fails only if the headers cannot be turned into a JS value.
 */
export function appHeaders(content_type: string): Record<string, string>;

/**
 * [`is_page_request`](app_protocol::is_page_request).
 */
export function appIsPageRequest(request_url: string): boolean;

/**
 * [`app_origin_from`]: `configured` is the optional origin override. Unset, empty or
 * not an absolute http(s) URL gives the default origin.
 */
export function appOriginFrom(configured?: string | null): string;

/**
 * [`append_ink_stroke`]: the anchor with one more path, or `null` for a stroke too short to keep.
 *
 * # Errors
 *
 * Fails if `anchor` or `path` is malformed.
 */
export function appendInkStroke(anchor: T.CombinedPdfAnchor, path: number[]): T.CombinedPdfAnchor | null;

/**
 * [`append_paper_note`]: the note with `addition` appended, or `undefined` when the addition is
 * blank.
 */
export function appendPaperNote(existing: string | null | undefined, addition: string): string | undefined;

/**
 * [`append_tag_hashtags`](note_tags::append_tag_hashtags). `tag_names` is an array of tag names.
 *
 * # Errors
 *
 * Fails if `tag_names` is not an array of strings.
 */
export function appendTagHashtags(body: string, tag_names: readonly string[]): string;

/**
 * [`apply_annotation_patch`]: the full annotation after an edit.
 *
 * # Errors
 *
 * Fails if `ann` or `patch` is malformed.
 */
export function applyAnnotationPatch(ann: T.ReaderAnnotation, patch: B.AnnotationPatch): T.ReaderAnnotation;

/**
 * [`apply_comma_placement`] for JS, as `{ text, changed }`.
 *
 * # Errors
 *
 * Fails when `placement` is not `"inside"` or `"outside"`, or `input` is over the text cap.
 */
export function applyCommaPlacement(input: string, placement: B.CommaPlacement): B.TextResult;

/**
 * [`wf_core::sync::snapshot_delta::apply_delta`] for JS over rows that carry an `id`.
 * `order` is `{ id, updatedAt }[]`; the result follows it.
 *
 * # Errors
 *
 * Fails when an argument does not have the expected shape.
 */
export function applyDelta(held: any, fetched: any, order: any): any;

/**
 * [`apply_group_command`](groups::apply_group_command).
 *
 * # Errors
 *
 * Fails if an argument has the wrong shape.
 */
export function applyGroupCommand(leaf: B.PaneLeaf, index: number, command: B.TabGroupCommand): B.PaneLeaf;

/**
 * Strokes reordered so each line's are contiguous, each a copy tagged with its
 * `lineIndex` (unsegmented ones last, `-1`), and the line records the container
 * stores ([`ink_line_records`]). `segmentation` is what `segmentInkLines` returned.
 *
 * # Errors
 *
 * Throws if `segmentation` or a stroke cannot be read, or `recognised` is not an
 * array of `{ text, confidence }` or undefined.
 */
export function applyInkSegmentation(strokes: readonly T.ReadonlyInkStroke[], segmentation: { lines: readonly { strokes: readonly T.ReadonlyInkStroke[]; yBand: readonly [number, number] }[]; lineOfStroke: readonly number[] }, recognised?: readonly ({ text: string; confidence: number } | undefined)[]): { strokes: B.InkStroke[]; lines: B.InkLineRecord[] };

/**
 * [`apply_template`](tpl::apply_template). A null or undefined `existing` counts as empty.
 *
 * # Errors
 *
 * Fails if the context is not a plain object.
 */
export function applyTemplate(existing: string | null | undefined, template: string, context: Record<string, unknown>): string;

/**
 * [`apply_op`](text_ot::apply_op): `text` with `op` applied.
 *
 * # Errors
 *
 * Fails when a delete does not match the text it removes, or the op cannot be read.
 */
export function applyTextOp(text: string, op: B.TextComponent[]): string;

/**
 * [`apply_user_integration_fields`](user_settings::apply_user_integration_fields): set a
 * provider's credential fields in its bag and the matching legacy columns.
 *
 * # Errors
 *
 * Fails if `settings` cannot be read as JSON or `fields` is not a string map.
 */
export function applyUserIntegrationFields(settings: B.UserSettings, provider_id: string, fields: Record<string, string>): B.UserSettings;

/**
 * [`artifact_basename`](artifact_refs::artifact_basename) (TS `artifactBasename`).
 */
export function artifactBasename(name: string): string;

/**
 * [`artifact_kind`](experiment_artifacts::artifact_kind): `image`, `pdf` or `link`.
 */
export function artifactKind(entry: string): string;

/**
 * [`wf_core::papers::open_access::arxiv_candidates`]: arXiv's PDF and HTML copies.
 *
 * # Errors
 *
 * Fails only if the result cannot be converted to a JS value.
 */
export function arxivCandidates(arxiv_id: string): B.OpenAccessCandidate[];

/**
 * [`arxiv_entry_to_metadata`] (TS `arxivEntryToMetadata`). The first entry of an arXiv Atom
 * feed as a paper.
 *
 * # Errors
 *
 * Fails when the feed has no usable entry for `arxiv_id`.
 */
export function arxivEntryToMetadata(xml: string, arxiv_id: string): B.ZoteroPaperInput;

/**
 * [`arxiv_query_url`](source_requests::arxiv_query_url) (TS `ArxivMetadataSource.fetch`).
 */
export function arxivQueryUrl(base: string, id: string): string;

/**
 * [`arxiv_stamp`](paper_drop::arxiv_stamp) (TS `arxivStamp`).
 */
export function arxivStamp(page_text: string): string | undefined;

/**
 * [`ask_prompt`](ask_library::ask_prompt): `{ system, user }` for the sources as passed.
 */
export function askPrompt(question: string, sources: readonly B.AskSource[], nonce: string): B.AskPrompt;

/**
 * [`assemble_page_citations`] (TS `assemblePageCitations`). `candidates` is optional.
 *
 * # Errors
 *
 * Fails if any argument does not have the expected shape.
 */
export function assemblePageCitations(page: B.AnalysisPdfPage, native: readonly B.AnalysisCitationMention[], patterns: readonly B.AnalysisCitationMention[], excluded: readonly B.AnalysisPageTextRange[], candidates?: readonly B.CitationCandidate[] | null): B.AnalysisCitationMention[];

/**
 * [`assemble`](wf_core::editor_workspace::workspace_load::assemble): the documents, completion
 * rows, trees and list membership of one workspace load. `membership` is a JS `Map`.
 *
 * # Errors
 *
 * Fails if `input` has the wrong shape.
 */
export function assembleWorkspace(input: { projectRoot?: string; vault?: { id: string; title: string; parentId?: string | null; folder?: boolean; body?: string | null; bodyPreview?: string | null }[]; papers?: { id: string; title: string; summary?: string | null; tags?: string[] | null; authors?: string[]; year?: number | null; doi?: string | null; arxivId?: string | null; bibtex?: string | null; metadata?: unknown }[]; reportSections?: { id: string; title: string; notes?: string | null; parentId?: string | null }[]; listsLoaded?: boolean; lists?: { id: string; name: string; parentId?: string | null }[]; listItems?: { listId: string; paperId?: string | null; vaultPageId?: string | null; inheritedFromListId?: string | null; duplicateOfItemId?: string | null }[]; logs?: { id: string; entryDate: string; body: string }[]; overleaf?: { id: string; name: string }[]; hydrated?: { id: string; body: string }[] }): { documents: { kind: string; id: string; title: string; body: string; hydrated: boolean; path: string; parentId?: string; tags?: string[] }[]; completions: { title: string; label: string; detail?: string; paper?: { id: string; title: string; authors: string[]; year?: number; doi?: string; arxivId?: string; bibtex?: string; metadata?: Record<string, unknown> } }[]; tree: B.WorkspaceTreeNode[]; listsTree: B.WorkspaceTreeNode[]; membership: Map<string, string[]> };

/**
 * Throws when the walk has already kept the file limit of text files.
 *
 * # Errors
 *
 * Fails with [`file_count_error`](path_guard::file_count_error) at the limit.
 */
export function assertOverleafFileCount(collected: number): void;

/**
 * Throws when a text file of `size` bytes breaks a byte limit, given `total` bytes already kept.
 *
 * # Errors
 *
 * Fails with [`text_size_error`](path_guard::text_size_error) when over a limit.
 */
export function assertOverleafTextSize(size: number, total: number): void;

/**
 * Throws unless `path` is a plain relative path inside the checkout: no `..` segment, no leading
 * `/`, no `\`, no drive letter.
 *
 * # Errors
 *
 * Fails with [`unsafe_checkout_path_error`](path_guard::unsafe_checkout_path_error) when unsafe.
 */
export function assertSafeCheckoutPath(path: string): void;

/**
 * Throws unless `path` is a plain relative ZIP entry name: no `..`, no leading `/`, no `\`.
 *
 * # Errors
 *
 * Fails with the refusal message of
 * [`unsafe_export_path_error`](export_path::unsafe_export_path_error) when the path is unsafe.
 */
export function assertSafeExportPath(path: string): void;

/**
 * [`asset_extension`](asset_mime::asset_extension): lowercased extension of a path, `png` when none.
 */
export function assetExtension(path: string): string;

/**
 * [`asset_mime_type`](asset_mime::asset_mime_type): content type for an imported asset's extension.
 */
export function assetMimeType(ext: string): string;

/**
 * [`asset_path`](folder_layout::asset_path). `scope` is `"notes"`, `"papers"` or `"report"`.
 *
 * # Errors
 *
 * Fails on any other scope.
 */
export function assetPath(scope: string, storage_path: string): string;

/**
 * [`auto_apply_timing`](auto_apply::auto_apply_timing) on
 * `{ now, firstAt, debounceMs, maxWaitMs }`, returning `{ delay, firstAt }`.
 *
 * # Errors
 *
 * Fails if the input does not match the shape, or the result cannot be serialized.
 */
export function autoApplyTiming(input: { now: number; firstAt: number | null; debounceMs: number; maxWaitMs: number }): { delay: number; firstAt: number };

/**
 * [`axis_spec`](plot_size::axis_spec) for a tier name (`PlotTier` in `bindings.ts`).
 *
 * # Errors
 *
 * Fails if `tier` is not one of the three tier names.
 */
export function axisSpec(tier: string): B.AxisSpec;

/**
 * [`backlinks_for_annotation`](backlinks::backlinks_for_annotation) as an array of targets.
 *
 * # Errors
 *
 * Fails if `hits` is not an array of hits.
 */
export function backlinksForAnnotation(hits: readonly B.AnnotationBacklinkHit[], annotation_id: string): B.AnnotationBacklinkTarget[];

/**
 * [`bands_coincide`] for two `[start, end]` y-bands (a missing end reads as NaN).
 */
export function bandsCoincide(a: readonly [number, number], b: readonly [number, number]): boolean;

/**
 * [`batch_reference_lists`](citation_candidate::batch_reference_lists): the reference lists for
 * one `/paper/batch` chunk, aligned to its ids.
 *
 * # Errors
 *
 * Fails with an `Error` carrying the TS message when `data` is not `chunk_len` items long, and
 * when `data` cannot be read as JSON.
 */
export function batchReferenceLists(data: unknown, chunk_len: number): (B.PaperRef[] | null)[];

/**
 * [`bearer_token`](local_api_guard::bearer_token): the credential a `Bearer` header offers, or `undefined`.
 */
export function bearerToken(header?: string | null): string | undefined;

/**
 * [`bib_add_skip_reason`](bib_import::bib_add_skip_reason) (TS `importBibFile`): the reason a
 * `.bib` entry is skipped, or `undefined` when the add made a new paper.
 */
export function bibAddSkipReason(created: boolean, title: string): string | undefined;

/**
 * [`bib_import_message`](paper_drop::bib_import_message) (TS `bibImportMessage`).
 */
export function bibImportMessage(added: number, skipped: number, problems: number): string;

/**
 * [`bib_paper_input`](bib_import::bib_paper_input) (TS `bibPaperInput`).
 *
 * # Errors
 *
 * Fails if `entry` cannot be read as a planned `.bib` entry.
 */
export function bibPaperInput(entry: B.BibImportPaper): { title: string; authors: string[]; year?: number; venue?: string; doi?: string; arxivId?: string; url?: string; abstract?: string; bibtex: string; metadata: { citeKey: string } };

/**
 * [`binomial_smooth`] as a plain array; `passes` defaults to 2.
 *
 * # Errors
 *
 * Fails only if the values cannot be converted to a JS value.
 */
export function binomialSmooth(values: readonly number[], stride: number, passes?: number | null): number[];

/**
 * [`blank_ink_page`](ink_page::blank_ink_page): an empty A4 page on `paper`, `blank` by default.
 *
 * # Errors
 *
 * Fails if `paper` is not a known paper name.
 */
export function blankInkPage(paper?: B.InkPaper): B.InkPage;

/**
 * [`blob_provider_for_runtime`]. `configured` is `tiered` or anything else for Supabase.
 *
 * # Errors
 *
 * Fails if `runtime` is not `{ inBrowser, publicProvider? }`, or the result cannot be converted to JS.
 */
export function blobProviderForRuntime(configured: string, runtime: B.BlobRuntime): B.BlobProviderId;

/**
 * [`blob_access::BLOB_STORAGE_BUCKETS`]: every bucket a user's blobs live in, as a string array.
 *
 * # Errors
 *
 * Fails only when the list cannot be converted to JS.
 */
export function blobStorageBuckets(): ("paper-images" | "experiment-artifacts" | "vault-assets" | "report-images" | "log-images")[];

/**
 * [`body_font_size`](analysis_outline::body_font_size) (TS `bodyFontSize`).
 *
 * # Errors
 *
 * Fails if `pages` is not an array of arrays of text items.
 */
export function bodyFontSize(pages: readonly (readonly B.OutlineTextItem[])[]): number;

/**
 * [`body_links_to`](page::body_links_to) (TS `bodyLinksTo`); a missing or empty body links
 * nowhere.
 */
export function bodyLinksTo(body: string | null | undefined, targetKey: string): boolean;

/**
 * [`body_stats`](stats::body_stats).
 *
 * # Errors
 *
 * Fails only if the result cannot be serialised.
 */
export function bodyStats(body: string): B.BodyStats;

/**
 * [`local_first_route::both_ends_merge`]: `"serverError"`, `"preferLocalRows"` or `"concatRows"`.
 *
 * # Errors
 *
 * Fails if the result cannot be converted to JS.
 */
export function bothEndsMerge(name: string, here_failed: boolean, there_failed: boolean): B.BothEndsMerge;

/**
 * [`bounded_body`](search_document::bounded_body); a missing body reads as empty.
 */
export function boundedBody(body?: string | null): string;

/**
 * [`branch_read`] for JS (TS `branchRead`).
 *
 * # Errors
 *
 * Fails when `input` is not a branch read input with the expected fields.
 */
export function branchRead(input: B.BranchReadInput): string;

/**
 * [`branch_save`] for JS (TS `branchSave`).
 *
 * # Errors
 *
 * Fails when `input` is not a branch save input with the expected fields.
 */
export function branchSave(input: B.BranchSaveInput): string;

/**
 * [`breadcrumbs`](crumbs::breadcrumbs) as an array of crumbs. A missing `lists` reads as `[]`.
 *
 * # Errors
 *
 * Fails if `tab`, `files` or `lists` does not have the shape of its type.
 */
export function breadcrumbs(tab: B.BreadcrumbTab, files: readonly B.WorkspaceTreeNode[], lists?: readonly B.WorkspaceTreeNode[]): B.Crumb[];

/**
 * [`bucket_annotations_by_page`]: a `Map` from 1-based page number to the caller's own
 * annotation objects on that page, in first-insertion order.
 *
 * # Errors
 *
 * Fails if `annotations` is not a list of annotations.
 */
export function bucketAnnotationsByPage(annotations: readonly T.ReaderAnnotation[]): Map<number, T.ReaderAnnotation[]>;

/**
 * [`build_annotation_sort_index`] (TS `buildAnnotationSortIndex`).
 */
export function buildAnnotationSortIndex(page_index: number, char_offset: number, top_pdf_units: number): string;

/**
 * The ask request `{ messages: [system, user], temperature }` for the search hits.
 *
 * # Errors
 *
 * Fails if `hits` is not an array of search hits.
 */
export function buildAskRequest(question: string, hits: readonly SearchHit[], nonce: string): { readonly messages: readonly [{ readonly role: "system"; readonly content: string }, { readonly role: "user"; readonly content: string }]; readonly temperature: number };

/**
 * [`build_request`]: the URL, headers and body for `descriptor`, with `messages` as the chat.
 *
 * # Errors
 *
 * Fails when the descriptor or the messages are malformed, or the result cannot be converted.
 */
export function buildByokRequest(descriptor: B.ProviderDescriptor, api_key: string, messages: readonly object[]): ByokRequest;

/**
 * [`wf_core::search::excerpt::build_excerpt`]: a snippet of `body` around the
 * densest cluster of `terms`, as `{ text, highlights }` where `text` is UTF-16
 * code units (the TS wrapper turns them into a string, lone surrogates kept).
 * `max_chars` defaults to 240 and `single_line` to true.
 *
 * # Errors
 *
 * Fails if `body` exceeds `MAX_INDEX_TEXT_UTF16` UTF-16 units, or `terms`
 * do (each counting its length + 1), or if `terms` is not an array of strings.
 */
export function buildExcerpt(body: string, terms: any, max_chars?: number | null, single_line?: boolean | null): any;

/**
 * [`build_graph_data`](graph_build::build_graph_data): nodes, links and lookups for one graph view.
 * `membership` is list id to member ids; it and the trailing arrays default to empty.
 *
 * # Errors
 *
 * Fails if an argument has the wrong shape, or the result cannot be serialised.
 */
export function buildGraphData(papers: B.GraphBuildPaper[], relations: B.PaperRelation[], settings: B.GraphViewSettings, membership?: ReadonlyMap<string, ReadonlySet<string>>, lists?: B.GraphBuildList[], notes?: B.GraphBuildNote[], sections?: B.GraphBuildSection[], experiments?: B.GraphBuildExperiment[]): { data: { nodes: (B.GraphNode & { x?: number; y?: number; fx?: number; fy?: number })[]; links: B.GraphLink[] }; neighbors: Map<string, Set<string>>; tagToPapers: Map<string, string[]>; tagToNotes: Map<string, string[]> };

/**
 * [`build_ink_request`]: the page's lines and hints turned into the helper's request.
 *
 * # Errors
 *
 * Fails when the input is not the page's shape, or the result cannot be converted to a JS value.
 */
export function buildInkRequest(input: B.InkRequestBuildInput): B.InkRecognitionRequest;

/**
 * [`build_lab_snapshot_content`](lab_snapshot::build_lab_snapshot_content).
 *
 * # Errors
 *
 * Fails if `input` has the wrong shape.
 */
export function buildLabSnapshotContent(input: { milestones: B.MilestoneInput[]; logs: B.LogEntryInput[]; experiments: B.ExperimentInput[]; report: B.ReportSectionInput[]; aiAssisted?: number }): B.LabSnapshotContent;

/**
 * [`build_list_tree`](reading_list::build_list_tree).
 *
 * # Errors
 *
 * Fails if `lists` has the wrong shape.
 */
export function buildListTree(lists: readonly B.ReadingList[]): B.ReadingListTreeNode[];

/**
 * [`build_lists_tree`](tree::build_lists_tree). `input` is a `ListsTreeInput`.
 *
 * # Errors
 *
 * Fails if `input` has the wrong shape.
 */
export function buildListsTree(input: B.ListsTreeInput): B.WorkspaceTreeNode[];

/**
 * [`build_locus_link`] (TS `buildLocusLink`): the `/reader` path for `input`.
 *
 * # Errors
 *
 * Fails if `input` is not a `LocusLinkInput` object.
 */
export function buildLocusLink(input: Partial<B.LocusLinkInput>): string;

/**
 * The export package's files, warnings and stats. `entries` is every library paper (empty when
 * there is none or no bibliography is included).
 */
export function buildOverleafExportFiles(input: OverleafExportFilesInput, entries: readonly OverleafBibEntryInput[]): OverleafExportPackage;

/**
 * [`build_page_tree`](page::build_page_tree): pages nested by `parentId`, each level sorted.
 * The nodes hold the caller's own page objects.
 *
 * # Errors
 *
 * Fails if `pages` has the wrong shape.
 */
export function buildPageTree(pages: readonly B.VaultPageSummary[]): unknown;

/**
 * [`build_paper_html_document`]: the framed, self-contained document for one kept paper.
 * Absent `options` reads as `{}`.
 *
 * # Errors
 *
 * Fails if `page` is not a paper page object, or `options` is not an options object.
 */
export function buildPaperHtmlDocument(page: B.PaperHtmlPage, options?: { scheme?: "light" | "dark"; print?: boolean }): string;

/**
 * [`build_propose_fill_prompt`]: the prompt that asks the AI to fill one column.
 */
export function buildProposeFillPrompt(input: B.ProposeFillInput): string;

/**
 * [`build_section_tree`](report_section::build_section_tree) (TS `buildSectionTree`).
 *
 * # Errors
 *
 * Fails if `sections` is not a list of sections.
 */
export function buildSectionTree(sections: readonly B.ReportSection[]): B.ReportSectionTreeNode[];

/**
 * [`build_wiki_graph`](wiki_graph::build_wiki_graph): nodes `kind:id`, undirected adjacency in
 * insertion order.
 *
 * # Errors
 *
 * Fails if `snapshot` has the wrong shape.
 */
export function buildWikiGraph(snapshot: object): { nodes: string[]; edges: Map<string, string[]> };

/**
 * [`build_wiki_index`](wiki_index::build_wiki_index): the generated block. `heading` defaults to
 * `Index`; `now` (default: the ISO time) is read only when pages exist, else the stamp is empty.
 *
 * # Errors
 *
 * Fails if `pages` is not an array of `{ title, aliases? }` objects, `now` throws or does not
 * return a string, or `heading` is not a string.
 */
export function buildWikiIndex(pages: readonly B.WikiPageRef[], options?: { heading?: string; now?: () => string }): string;

/**
 * [`build_workspace_tree`](tree::build_workspace_tree).
 *
 * # Errors
 *
 * Fails if `input` has the wrong shape.
 */
export function buildWorkspaceTree(input: B.WorkspaceTreeInput): B.WorkspaceTreeNode[];

/**
 * [`is_available`]: whether `descriptor` can be used with `api_key`.
 *
 * # Errors
 *
 * Fails when the descriptor is malformed.
 */
export function byokAvailable(descriptor: B.ProviderDescriptor, api_key: string): boolean;

/**
 * [`http_error_message`]: the message for a failed call, with the provider's own detail.
 */
export function byokHttpError(label: string, status: number, detail: string): string;

/**
 * [`try_cache_path_segments`](model_cache::try_cache_path_segments): the segments a cache URL
 * names under the cache root, or `null` when it names none or would leave the root.
 *
 * # Errors
 *
 * Throws on a URL that does not parse, or a path escape `decodeURIComponent` rejects, as the
 * TS did.
 */
export function cachePathSegments(url: string): string[] | undefined;

/**
 * [`can_create_role`](member::can_create_role).
 */
export function canCreateRole(creator: string, target: string): boolean;

/**
 * [`can_drop`](edit::can_drop).
 *
 * # Errors
 *
 * Fails if an argument does not have the expected shape, or the result cannot be serialised.
 */
export function canDrop(source: B.WorkspaceTreeNode, target: B.WorkspaceTreeNode): boolean;

/**
 * [`can_join_ink_group`]; `group` may be `null`, `windowMs` defaults to 2000.
 */
export function canJoinInkGroup(group: { pageIndex: number; color: string; width: number; pathCount: number; lastAt: number } | null, next: { pageIndex: number; color: string; width: number; at: number }, window_ms?: number | null): boolean;

/**
 * [`can_rename`](edit::can_rename).
 *
 * # Errors
 *
 * Fails if the node does not have the expected shape, or the result cannot be serialised.
 */
export function canRename(node: B.WorkspaceTreeNode): boolean;

/**
 * [`wf_core::storage::blob::can_store_unchanged`]: whether an image of this
 * MIME type and byte size is kept as it came.
 */
export function canStoreUnchanged(mime: string, size_bytes: number): boolean;

/**
 * [`canonical_ai_tool_name`](ai_tool_name::canonical_ai_tool_name).
 */
export function canonicalAiToolName(name: string): string;

/**
 * [`capped_engine_confidence`](wf_core::ink::decode::capped_engine_confidence): an engine's
 * line confidence capped at the engine maximum.
 */
export function cappedEngineConfidence(conf: number): number;

/**
 * [`card_snippet::card_snippet`]: plain-text preview of `body`, cut to `max` UTF-16 units.
 *
 * # Errors
 *
 * Fails if `body` exceeds `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function cardSnippet(body: string, max?: number | null): string;

/**
 * [`wf_core::sync::change_origin::changed_side`] for JS, as a `ChangeSide` string.
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 */
export function changedSide(base?: string | null, folder?: string | null, workspace?: string | null): any;

/**
 * [`changes_from_reply`] for JS: the pulled changes, or the error text when the read failed.
 *
 * # Errors
 *
 * Fails when the result cannot be serialised.
 */
export function changesFromReply(status: number, body: string): { error: string | null; changes: unknown[] };

/**
 * [`check_bibliography`](bibliography_report::check_bibliography) (TS `checkBibliography`):
 * every citation and bibliography finding in the project's sources. Entries carry their
 * fields as a record, as `parseBibEntries` returns them.
 *
 * # Errors
 *
 * Fails if `input` has the wrong shape.
 */
export function checkBibliography(input: { sources: readonly B.LatexSourceFile[]; bibliography: { entries: readonly (Omit<B.BibEntry, "fields"> & { fields: Record<string, string> })[]; warnings: readonly B.BibWarning[] } }): B.BibliographyReport;

/**
 * [`decision_error`](screening::decision_error) (TS `checkDecision`): throws an `Error` named
 * `ScreeningError` when `next` may not be recorded after `existing`. `stage` and `state` are
 * read as `String(...)`.
 *
 * # Errors
 *
 * Throws `ScreeningError`, or fails if `next` or `existing` has the wrong shape.
 */
export function checkDecision(next: Pick<B.ScreeningDecision, "itemId" | "reviewerId" | "stage" | "state">, existing: readonly B.ScreeningDecision[]): void;

/**
 * [`check_git_remote_url`](wf_core::sync::git_remote::check_git_remote_url); a
 * non-string `raw` is refused (TS `checkGitRemoteUrl`).
 *
 * # Errors
 *
 * Fails only if the result cannot be converted to a JS value.
 */
export function checkGitRemoteUrl(raw: unknown): { ok: true; url: string } | { ok: false; reason: string };

/**
 * [`check_ink_chunk_body`](chunk::check_ink_chunk_body): the layout and page header of a body
 * that passed every check.
 *
 * # Errors
 *
 * Fails on a body whose tables do not add up.
 */
export function checkInkChunkBody(body: Uint8Array): B.InkChunkBodyInfo;

/**
 * [`check_new_paper`](paper::check_new_paper) (TS `checkNewPaper`). Returns the trimmed title;
 * a refusal throws an `Error` with the wf-core message.
 *
 * # Errors
 *
 * Fails with the refusal message when the title is blank or the rating is outside 1 to 5.
 */
export function checkNewPaper(title: string, rating?: number | null | undefined): string;

/**
 * [`check_link_folder`]: whether a vault-relative folder may be linked, and its normalised form.
 * A non-string is refused with the same reason as a bad folder.
 *
 * # Errors
 *
 * Fails only if the result cannot be converted to JS.
 */
export function checkOverleafLinkFolder(raw: unknown): { ok: true; folder: string } | { ok: false; reason: string };

/**
 * [`check_url_shape`](url_safety::check_url_shape): decides from the URL alone whether it may
 * be fetched. A string is parsed as [`parseUserUrl`](parse_user_url_js) does; one that does not
 * parse is refused as `"not-a-url"`.
 *
 * # Errors
 *
 * Fails if the result cannot be converted to a JS value.
 */
export function checkUrlShape(input: string | URL): B.UrlCheck;

/**
 * [`choose_anchor_strategy`] as `{ kind, position | locus, confidence }`. The `position` of a
 * `"rects"` strategy is the caller's own `anchor.zoteroPosition`, and the `locus` of a
 * `"quote"` strategy the caller's own `anchor.locus`, so unknown fields survive.
 *
 * # Errors
 *
 * Fails if `anchor` is not a combined anchor object, or the result cannot be converted.
 */
export function chooseAnchorStrategy(anchor: T.CombinedPdfAnchor, current_content_hash: string): B.AnchorStrategy;

/**
 * [`choose_root`](vault_search::choose_root) as `"use" | "nest" | "refuse"`, from a verdict tag.
 */
export function chooseRoot(verdict: string): string;

/**
 * [`chunk_for_embedding`](text_chunks::chunk_for_embedding); missing options take the defaults.
 *
 * # Errors
 *
 * Fails if `options` has the wrong shape.
 */
export function chunkForEmbedding(text: string, options?: B.ChunkOptions): B.TextChunk[];

/**
 * [`citation_alert_failure_log`](account_provision::citation_alert_failure_log) as a JS object.
 *
 * # Errors
 *
 * Fails if the log line cannot be converted to a JS value.
 */
export function citationAlertFailureLog(paper_id: string, reason: string): { level: 'warn'; source: string; message: string; detail: string };

/**
 * [`alert_log_body`]: the markdown log entry for an alert on `paper_title`, `ranked` best first.
 *
 * # Errors
 *
 * Fails if `ranked` has the wrong shape.
 */
export function citationAlertLogBody(paper_title: string, ranked: readonly CitationAlertLogItem[]): string;

/**
 * [`citation_alert_message`] for JS (TS `citationAlertMessage`).
 *
 * # Errors
 *
 * Fails when `input` is not a citation alert input with the expected fields.
 */
export function citationAlertMessage(input: B.CitationAlertInput): string;

/**
 * One candidate's [`citation_alert_score`](citation_alerts::citation_alert_score): recency, the
 * influential bonus and its strongest intent.
 *
 * # Errors
 *
 * Fails if `candidate` has the wrong shape.
 */
export function citationAlertScore(candidate: B.CitationSignals): number;

/**
 * [`citation_alert_score`](citation_alerts::citation_alert_score) of each candidate, in order,
 * as a plain array.
 *
 * # Errors
 *
 * Fails if `candidates` has the wrong shape.
 */
export function citationAlertScores(candidates: readonly B.CitationSignals[]): number[];

/**
 * [`citation_candidates`](citation_candidate::citation_candidates): the candidates from one
 * page of `/citations` edges, in order. Edges without a usable citing paper are skipped.
 *
 * # Errors
 *
 * Fails if `data` cannot be read as JSON.
 */
export function citationCandidates(data: unknown): B.CitationCandidateWire[];

/**
 * [`citation_contexts`](semantic_scholar_citation::citation_contexts): trimmed snippets, or
 * nothing when none remain.
 *
 * # Errors
 *
 * Fails if the value cannot be read as JSON.
 */
export function citationContexts(raw: unknown): string[] | undefined;

/**
 * [`external_id_ref`](semantic_scholar_citation::external_id_ref): the lookup reference for
 * a paper's external ids, or nothing.
 *
 * # Errors
 *
 * Fails if `ids` has the wrong shape.
 */
export function citationExternalIdRef(ids: unknown): B.PaperRef | null;

/**
 * [`citation_format_storage_key`](prefs::citation_format_storage_key): the key for a project.
 */
export function citationFormatStorageKey(project_id?: string | null): string;

/**
 * [`intent_label`](citation_alerts::intent_label) of one candidate, or `null` when it has no intents.
 *
 * # Errors
 *
 * Fails if `candidate` has the wrong shape.
 */
export function citationIntentLabel(candidate: B.CitationSignals): string | null;

/**
 * [`citation_intents`](semantic_scholar_citation::citation_intents): the known intents, or
 * nothing when none remain.
 *
 * # Errors
 *
 * Fails if the value cannot be read as JSON.
 */
export function citationIntents(raw: unknown): string[] | undefined;

/**
 * [`item_to_rect`](analysis_text::item_to_rect) as `[x0, y0, x1, y1]` or null (TS `itemToRect`,
 * exported as `citationItemToRect` because `itemToRect` belongs to another lane). `from`
 * defaults to 0 and `to` to the UTF-16 length of `item.str`.
 *
 * # Errors
 *
 * Fails if `item` is not a text item with `str`, `transform`, `width` and `height`.
 */
export function citationItemToRect(item: B.AnalysisPdfItem, from?: number | null, to?: number | null): number[] | null;

/**
 * [`cite_key_of`](bib_import::cite_key_of) (TS `citeKeyOf`): the citation key of a paper's
 * metadata bag, or `undefined` when it is not a string that is not blank.
 *
 * # Errors
 *
 * Fails if `metadata` cannot be read as a JSON value.
 */
export function citeKeyOf(metadata: unknown): string | undefined;

/**
 * [`cited_sources`](retrieval::cited_sources): the 1-based source numbers an answer cites, in
 * first-citation order, out of `count` sources.
 *
 * # Errors
 *
 * Fails if the numbers cannot be converted to a JS value.
 */
export function citedSourceNumbers(answer: string, count: number): number[];

/**
 * The hits an answer cites, as `{ n, hit }` in first-citation order. `hit` is the element of
 * `hits` itself, so object identity is kept.
 *
 * # Errors
 *
 * Fails if `hits` is not an array.
 */
export function citedSources(answer: string, hits: readonly SearchHit[]): readonly { readonly n: number; readonly hit: SearchHit }[];

/**
 * [`claim_digest`](folder_mirror::claim_digest): `base` with `path` recorded for `stamped`.
 *
 * # Errors
 *
 * Fails when `base` is not an object of string digests.
 */
export function claimDigest(base: Readonly<Record<string, string>>, path: string, stamped: string): Record<string, string>;

/**
 * [`clamp_ink_note_width`]; `fallback` defaults to the default pen.
 */
export function clampInkNoteWidth(width: number, fallback?: number | null): number;

/**
 * [`clamp_ink_page_size`](ink_page::clamp_ink_page_size): `{ width, height }` clamped to `Int16`.
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 */
export function clampInkPageSize(width: number, height: number): { width: number; height: number };

/**
 * [`clamp_ink_width`].
 */
export function clampInkWidth(width: number): number;

/**
 * [`clamp_ink_zoom`].
 */
export function clampInkZoom(zoom: number): number;

/**
 * [`clamp_page`] (TS `clampPage`).
 */
export function clampPage(page: number, num_pages: number): number;

/**
 * [`clamp_scale`]: a non-finite or non-positive scale gives 1, else clamps to the zoom range.
 */
export function clampScale(scale: number): number;

/**
 * [`clamp_zoom_factor`] (TS `clampZoomFactor`).
 */
export function clampZoomFactor(factor: number, base_scale: number): number;

/**
 * [`claude_code_commands`](mcp_client_config::claude_code_commands).
 */
export function claudeCodeCommands(): string;

/**
 * [`wf_core::papers::open_access::clean_arxiv_id`]: the cleaned arXiv id, or `None`.
 */
export function cleanArxivId(id?: string | null): string | undefined;

/**
 * [`clean_groups`](groups::clean_groups).
 *
 * # Errors
 *
 * Fails if `leaf` has the wrong shape.
 */
export function cleanGroups(leaf: B.PaneLeaf): B.PaneLeaf;

/**
 * [`clean_image_path`](paper_update::clean_image_path) (TS `addImage`): the path trimmed, or `undefined` when blank.
 */
export function cleanImagePath(path: string): string | undefined;

/**
 * [`clean_summary`](paper_update::clean_summary) (TS `setSummary`): the summary trimmed, or `undefined` when blank.
 */
export function cleanPaperSummary(summary: string): string | undefined;

/**
 * [`clean_title`](paper_update::clean_title) (TS `setTitle`): the title collapsed, or `undefined` when blank.
 */
export function cleanPaperTitle(title: string): string | undefined;

/**
 * [`clean_pasted_text`] for JS, as `{ text, changed, urlsCleaned }`.
 *
 * # Errors
 *
 * Fails when `settings` is not a `PasteSettings` object, or `input` is over the text cap.
 */
export function cleanPastedText(input: string, settings: B.PasteSettings): B.CleanPasteResult;

/**
 * [`clean_pdf_address`](paper_update::clean_pdf_address) (TS `setPdfSource`): the address trimmed, or `undefined` when blank.
 */
export function cleanPdfAddress(url?: string | null): string | undefined;

/**
 * [`clean_pdf_text`] for JS, as `{ text, changed }`.
 *
 * # Errors
 *
 * Fails when `options` is not a `PdfTextOptions` object, or `input` is over the text cap.
 */
export function cleanPdfText(input: string, options: B.PdfTextOptions): B.TextResult;

/**
 * [`wf_core::papers::open_access::clean_pmcid`]: the cleaned PMCID, or `None`.
 */
export function cleanPmcid(id?: string | null): string | undefined;

/**
 * Cleans the URLs in `text` with the built-in rules plus the user's `rules`
 * (TS `cleanUrlsInText(text, buildUrlCleanupOptions(rules))`), as `{ text, count }`.
 *
 * # Errors
 *
 * Fails when `rules` is not a string array, or `text` is over the text cap.
 */
export function cleanUrlsWithRules(text: string, rules: readonly string[]): B.UrlCleanupResult;

/**
 * [`clean_widget_palette`]: the palette if every key is valid, else `null`.
 *
 * # Errors
 *
 * Fails if `value` cannot be read as JSON, or the result cannot be converted to JS.
 */
export function cleanWidgetPalette(value: unknown): Record<string, string> | null;

/**
 * [`clean_wrapped_text`] for JS, as `{ text, changed }`.
 *
 * # Errors
 *
 * Fails when `options` is not a `WrappedTextOptions` object, or `input` is over the text cap.
 */
export function cleanWrappedText(input: string, options: B.WrappedTextOptions): B.TextResult;

/**
 * [`clip_segment_to_area`](clip::clip_segment_to_area) as `{ from, to }`, or `null`.
 *
 * # Errors
 *
 * Fails only if the arguments cannot be read or the result cannot be serialised.
 */
export function clipSegmentToArea(area: B.DrawArea, from: B.Point, to: B.Point): B.ClippedSegment | null;

/**
 * [`close_tab`](pane::close_tab).
 *
 * # Errors
 *
 * Fails if `layout` has the wrong shape.
 */
export function closeTab(layout: B.PaneLayout, pane_id: string, index: number): B.PaneLayout;

/**
 * [`closed_tabs`](pane::closed_tabs).
 *
 * # Errors
 *
 * Fails if a layout has the wrong shape.
 */
export function closedTabs(before: B.PaneLayout, after: B.PaneLayout): B.TabRef[];

/**
 * [`cluster_marks`](timeline::cluster_marks): marks nearer than `min_gap` stacked into clusters.
 *
 * # Errors
 *
 * Fails if `marks` has the wrong shape.
 */
export function clusterMarks(marks: readonly B.PlanTimelineMark[], min_gap: number): B.PlanTimelineCluster[];

/**
 * [`coalesce_mentions`] (TS `coalesceMentions`).
 *
 * # Errors
 *
 * Fails if any argument does not have the expected shape.
 */
export function coalesceMentions(mentions: readonly B.AnalysisCitationMention[], text: string, items: readonly B.AnalysisPdfItem[]): B.AnalysisCitationMention[];

/**
 * [`step`](coalescer::step): the next `{ state, actions }` for one `event` from `state`.
 *
 * # Errors
 *
 * Fails if `state` or `event` does not match the coalescer shape.
 */
export function coalescerStep(state: { suspended: boolean; timerArmed: boolean; inFlight: boolean; again: boolean }, event: { type: 'request' | 'cancel' | 'timerFired' | 'runSettled' } | { type: 'suspend'; value: boolean }): { state: { suspended: boolean; timerArmed: boolean; inFlight: boolean; again: boolean }; actions: ({ type: 'clearTimer' } | { type: 'armTimer' } | { type: 'startRun' })[] };

/**
 * [`codex_toml`](mcp_client_config::codex_toml) for a `McpLaunchLine`.
 *
 * # Errors
 *
 * Fails if `launch` has the wrong shape.
 */
export function codexToml(launch: B.McpLaunchLine): string;

/**
 * [`coerce_paper_field_value`] (TS `coercePaperFieldValue`). `null`, `undefined` or blank
 * clears the value (returns `null`); a refusal throws an `Error` with the wf-core message.
 *
 * # Errors
 *
 * Fails if `kind` is not a field kind, if `value` is not a string, number, or string list,
 * or if the value is refused for `kind`.
 */
export function coercePaperFieldValue(kind: B.PaperFieldKind, value: B.PaperFieldValueData | null | undefined): B.PaperFieldValueData | null;

/**
 * [`cold_blob_client_config`]. `null` when any cold-tier field is unset or empty.
 *
 * # Errors
 *
 * Fails if `fields` is not an object of optional strings, or the result cannot be converted to JS.
 */
export function coldBlobClientConfig(fields: B.ColdFields): B.BlobClientConfig | null;

/**
 * [`collapse_alert`]: the short form of a citation alert as `{ shown, hidden }`, or
 * `null` when the entry is not a long citation alert.
 *
 * # Errors
 *
 * Fails only if the result cannot be converted to JS.
 */
export function collapseAlert(headline: string, rest: string): B.CollapsedAlert | null;

/**
 * [`collapse_hits`](result_dedupe::collapse_hits) as `{id, score}` objects. A PDF page is
 * stood in for by its paper's own document when `entityDoc` finds one; `entityDoc` runs
 * only for non-seed PDF hits and defaults to finding none. The seed's entity is dropped.
 *
 * # Errors
 *
 * Fails if a hit or the seed has the wrong shape, or `entityDoc` throws.
 */
export function collapseToEntities(hits: readonly { id: string; kind: string; entityId: string; score: number }[], seed: { entityId: string }, entity_doc?: (hit: { id: string; kind: string; entityId: string; score: number }) => string | null): { id: string; score: number }[];

/**
 * [`collect_annotation_image_regions`](ops::collect_annotation_image_regions).
 *
 * # Errors
 *
 * Fails if the annotations do not have the shape of a TS `ReaderAnnotation`,
 * or the result cannot be serialised.
 */
export function collectAnnotationImageRegions(annotations: readonly B.AnnotationInput[]): B.BatchImageRegion[];

/**
 * [`collect_cited_keys`](bibtex::collect_cited_keys): the keys a LaTeX body cites, from its
 * `\cite{...}` commands, as a JS `Set`.
 */
export function collectCitedKeys(latex: string): Set<string>;

/**
 * [`collect_list_ids`]: every list id in the tree, parents before children.
 */
export function collectListIds(tree: readonly B.ReadingListTreeNode[]): string[];

/**
 * [`collect_new_hits`](related_paper_hit::collect_new_hits): adds the new candidates up to the limit.
 *
 * # Errors
 *
 * Fails if `input` cannot be read as a collect input.
 */
export function collectNewHits(input: unknown): B.RelatedPaperCollectOutput;

/**
 * [`colour_tool_for`]: returns `"pen"`, `"highlighter"`, `"text"` or `"highlight"`.
 */
export function colourToolFor(pen_open: boolean, pen_tool: string, picked_tool: string): string;

/**
 * [`command_for_chord`](keys::command_for_chord): the workspace command a chord means, or
 * `null`.
 *
 * The fields are read one by one, since a DOM `KeyboardEvent` keeps its modifiers on prototype
 * getters. `tab_count` defaults to unbounded; a non-finite count is unbounded too.
 *
 * # Errors
 *
 * Fails if `chord` is not an object or `chord.key` is not a string.
 */
export function commandForChord(chord: B.KeyChord, tab_count?: number | null): string | null;

/**
 * [`command_match_indices`](palette_groups::command_match_indices): every index for an empty
 * query, else the page rule.
 *
 * # Errors
 *
 * Fails if `query` is too long or `labels` is not an array of strings.
 */
export function commandMatchIndices(labels: readonly string[], query: string): number[];

/**
 * [`comment_from_row`](sharing::comment_from_row): a `comments` row as the app's `Comment`.
 *
 * # Errors
 *
 * Fails if `row` does not have the `comments` columns.
 */
export function commentFromRow(row: B.CommentRow): B.Comment;

/**
 * [`commit_url`](repo_web_url::commit_url): a commit's web URL, or `undefined`.
 */
export function commitUrl(repo_url?: string | null, sha?: string | null): string | undefined;

/**
 * [`communities`](node_colouring::communities): `[id, rank]` pairs, rank 0 for the biggest.
 *
 * # Errors
 *
 * Fails if `ids` or `edges` has the wrong shape.
 */
export function communities(ids: readonly string[], edges: readonly (readonly [string, string])[]): [string, number][];

/**
 * [`compact_ink_path`]; `options` is `{ tolerance?, maxPoints?, decimals? }` or absent.
 * Returns a plain JS number array.
 *
 * # Errors
 *
 * Fails if `options` is not an options object, or the result cannot be converted to JS.
 */
export function compactInkPath(path: readonly number[], options?: { tolerance?: number; maxPoints?: number; decimals?: number }): number[];

/**
 * [`compose_ink_page_order`](ink_page::compose_ink_page_order): the pages a note loads, in order.
 *
 * # Errors
 *
 * Fails if either list is not an array of strings.
 */
export function composeInkPageOrder(declared: readonly string[], present: readonly string[]): string[];

/**
 * [`compose_spacing_accents`](analysis_text::compose_spacing_accents) (TS `composeSpacingAccents`).
 */
export function composeSpacingAccents(text: string): string;

/**
 * [`compute_fit_page_scale`] (TS `computeFitPageScale`).
 *
 * # Errors
 *
 * Fails if `page` or `container` is not an object with `width` and `height`.
 */
export function computeFitPageScale(page: B.ReaderPageSize, container: B.ReaderContainerSize, rotation?: number | null, gutter_px?: number | null): number;

/**
 * [`compute_fit_width_scale`] (TS `computeFitWidthScale`).
 *
 * # Errors
 *
 * Fails if `page` or `container` is not an object with `width` and `height`.
 */
export function computeFitWidthScale(page: B.ReaderPageSize, container: B.ReaderContainerSize, rotation?: number | null, gutter_px?: number | null): number;

/**
 * [`compute_rollup_for_papers`] (TS `computeRollupsForPapers`). One call fills a rollup column
 * for every listed paper, in `paper_ids` order; `null` where the rollup has no value. A def
 * without `options` reads as having none.
 *
 * # Errors
 *
 * Fails if an argument has the wrong shape.
 */
export function computeRollupsForPapers(paper_ids: readonly string[], rollup: Omit<B.RollupFieldDef, "options"> & { options?: readonly string[] }, defs: readonly (Omit<B.RollupFieldDef, "options"> & { options?: readonly string[] })[], values: readonly B.RollupValue[]): (B.PaperFieldValueData | null)[];

/**
 * [`concept_key`](extraction::concept_key).
 */
export function conceptKey(name: string): string;

/**
 * [`conflict_route`] for JS (TS `conflictRoute`).
 *
 * # Errors
 *
 * Fails when `input` is not a conflict input.
 */
export function conflictRoute(input: B.ConflictInput): B.ConflictRoute;

/**
 * [`contact_area_mm2`]: a touch's contact area in mm², from its CSS-pixel box.
 * A missing side counts as 0.
 *
 * # Errors
 *
 * Throws if `event` cannot be read.
 */
export function contactAreaMm2(event: { width?: number; height?: number }): number;

/**
 * [`container_resize`]: `last` and `next` are `{ width, height }`. Returns `"ignore"`, `"now"` or `"settle"`.
 *
 * # Errors
 *
 * Fails if either argument is not a `{ width, height }` object of numbers.
 */
export function containerResize(last: B.BoxSize, next: B.BoxSize): string;

/**
 * [`contains_math`](math_input::contains_math) (TS `containsMath`): whether the renderer would
 * treat any of this text as maths.
 */
export function containsMath(md: string): boolean;

/**
 * [`context_menu::place`] for JS: `{ x, y }` where the menu goes, padded from the viewport edge.
 *
 * # Errors
 *
 * Fails when the placement cannot be converted to a JS value.
 */
export function contextMenuPlace(x: number, y: number, width: number, height: number, view_width: number, view_height: number): unknown;

/**
 * [`context_menu::reduce`] for JS: `{ state, accepted, changed }`.
 *
 * `state` is `{ x, y }` or null; `action` is `{ kind: "open", x, y, count }` or `{ kind: "close" }`.
 *
 * # Errors
 *
 * Fails when `state` or `action` does not have the shape above.
 */
export function contextMenuReduce(state: unknown, action: unknown): unknown;

/**
 * A fresh context nonce: [`context_nonce_from`](ai_tool_name::context_nonce_from) over 16
 * draws of `random`, `Math.random` by default.
 *
 * # Errors
 *
 * Rethrows whatever `random` throws.
 */
export function contextNonce(random?: () => number): string;

/**
 * [`context_nonce_from`](ai_tool_name::context_nonce_from): the caller passes the
 * `Math.random()` values.
 */
export function contextNonceFrom(randoms: readonly number[]): string;

/**
 * [`continue_push_round`] for JS (TS `continuePushRound`): whether the push loop runs another
 * round.
 *
 * # Errors
 *
 * Fails when `input` is not `{ sent, stoppedEarly }` with a whole `sent`.
 */
export function continuePushRound(input: { sent: number; stoppedEarly: boolean }): boolean;

/**
 * [`copy_extension`](asset_copy::copy_extension): the text after the last `.` in `oldPath`
 * (TS `oldPath.split(".").pop()`).
 */
export function copyExtension(old_path: string): string;

/**
 * [`wf_core::core_info`] as a plain JS object (`CoreInfo` in `bindings.ts`).
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 */
export function coreInfo(): B.CoreInfo;

/**
 * [`count_action_list`](folder_merge::count_action_list): the tally over bare actions.
 *
 * # Errors
 *
 * Fails when `actions` is not a list of import actions.
 */
export function countActionList(actions: readonly B.ImportAction[]): B.ActionCounts;

/**
 * [`count_actions`](folder_merge::count_actions).
 *
 * # Errors
 *
 * Fails when `entries` is not a list of import entries.
 */
export function countActions(entries: readonly B.ImportDiffEntry[]): B.ActionCounts;

/**
 * [`wf_core::sync::json_entities::count_json_actions`] for JS.
 *
 * # Errors
 *
 * Fails when `entries` does not match the diff entry shape.
 */
export function countJsonActions(entries: readonly B.JsonDiffEntry[]): B.ActionCounts;

/**
 * [`count_open`]: how many open conflicts still need a person.
 *
 * # Errors
 *
 * Fails if `open` is not an array of `{ kind, fieldCount }` objects.
 */
export function countOpen(open: readonly B.OpenConflictRef[]): number;

/**
 * [`count_section_sources`](section_sources::count_section_sources) (TS `countSectionSources`).
 * An absent or empty body counts 0.
 */
export function countSectionSources(body?: string | null): number;

/**
 * [`count_words`](text::count_words): runs of non-whitespace in `text`.
 */
export function countWords(text: string): number;

/**
 * [`courtesy_pause_due`](library_index::courtesy_pause_due).
 */
export function courtesyPauseDue(from_cache: boolean, indexed: number, failed: number): boolean;

/**
 * [`covered_hit_mask`](hybrid_fusion::covered_hit_mask) as a boolean array.
 *
 * # Errors
 *
 * Fails if `query_term_counts` is not an array of numbers or `null`.
 */
export function coveredHitMask(query_term_counts: readonly (number | null)[], term_count: number, min_coverage: number): boolean[];

/**
 * [`covered_text_spans`](link_citations::covered_text_spans) (TS `coveredTextSpans`).
 *
 * # Errors
 *
 * Fails if `page` or `links` do not have the expected shape.
 */
export function coveredTextSpans(page: B.LinkCitationPage, links: readonly B.AnalysisPdfLink[]): B.CoveredTextSpans;

/**
 * [`CRDT_EDITABLE_SHARE_TYPES`](sharing::CRDT_EDITABLE_SHARE_TYPES): share types that support
 * collaborative editing.
 *
 * # Errors
 *
 * Fails if the list cannot be converted to a JS value.
 */
export function crdtEditableShareTypes(): readonly B.ShareableType[];

/**
 * [`creatable_roles`](member::creatable_roles).
 */
export function creatableRoles(creator: string): string[];

/**
 * [`creatable_under`](edit::creatable_under).
 *
 * # Errors
 *
 * Fails if the node does not have the expected shape, or the result cannot be serialised.
 */
export function creatableUnder(node: B.WorkspaceTreeNode): readonly B.CreateKind[];

/**
 * A new experiment, its time from `deps.clock.nowIso()` and then its id from
 * `deps.ids.newId()`.
 *
 * # Errors
 *
 * Throws an `ExperimentValidationError` for a blank name or a wrongly shaped `input`, and
 * rethrows whatever `deps` throws.
 */
export function createExperiment(input: unknown, deps: { clock: { nowIso(): string }; ids: { newId(): string } }): B.Experiment;

/**
 * [`create_experiment`](experiments::create_experiment) with the id and time supplied. Invalid
 * input fails with the TS validation message.
 *
 * # Errors
 *
 * Fails if `input` has the wrong shape or its name is blank.
 */
export function createExperimentWith(input: unknown, id: string, now: string): B.Experiment;

/**
 * A new [`InkStrokePacker`]; `options` is the TS `InkStrokePackerOptions`
 * or undefined.
 *
 * # Errors
 *
 * Fails if `options` is not an options object.
 */
export function createInkStrokePacker(options?: B.InkStrokePackerOptions): InkStrokePacker;

/**
 * [`create_log_entry`](log_entry::create_log_entry): a valid log entry from partial input,
 * with defaults and invariants applied. The body is checked before `deps.clock.nowIso()`
 * and `deps.ids.newId()` run, in that order, like the TS original.
 *
 * # Errors
 *
 * Throws an `Error` named `LogEntryValidationError` when the input is invalid, and fails if
 * `input` has the wrong shape or a dependency cannot be called.
 */
export function createLogEntry(input: B.NewLogEntryInput, deps: { clock: { nowIso(): string }; ids: { newId(): string } }): B.LogEntry;

/**
 * [`create_member_reply`](account_provision::create_member_reply): created, or rejected with the fallback text.
 *
 * # Errors
 *
 * Fails if the reply cannot be converted to a JS value.
 */
export function createMemberReply(ok: boolean, has_member: boolean): { kind: 'created' } | { kind: 'rejected'; fallback: string };

/**
 * A new milestone from caller input: validates first (so no id is drawn for bad input),
 * then calls `deps.ids.newId()` and `deps.clock.nowIso()` in that order.
 *
 * # Errors
 *
 * Throws a `MilestoneValidationError` for invalid input, a shape error for a malformed
 * `input`, or whatever `newId` / `nowIso` throw.
 */
export function createMilestone(input: B.NewMilestoneInput, deps: { clock: { nowIso(): string }; ids: { newId(): string } }): B.Milestone;

/**
 * [`create_milestone`](milestone::create_milestone) with the id and time supplied. Call
 * [`milestone_input_error_js`] first: invalid input fails here.
 *
 * # Errors
 *
 * Fails if `input` has the wrong shape or is invalid.
 */
export function createMilestoneWith(input: B.NewMilestoneInput, id: string, created_at: string): B.Milestone;

/**
 * A new relation from caller input: validates it, then draws the id from `deps.ids.newId()`
 * and the time from `deps.clock.nowIso()`, in that order.
 *
 * # Errors
 *
 * Throws an `Error` named `PaperRelationValidationError` with the validation message before
 * drawing an id; rethrows what `deps` throws.
 */
export function createPaperRelation(input: B.NewPaperRelationInput, deps: { clock: { nowIso(): string }; ids: { newId(): string } }): B.PaperRelation;

/**
 * [`create_paper_relation`](paper_relation::create_paper_relation) with the id and time
 * supplied. Call [`paper_relation_input_error_js`] first: invalid input fails here.
 *
 * # Errors
 *
 * Fails if `input` has the wrong shape or does not validate.
 */
export function createPaperRelationWith(input: B.NewPaperRelationInput, id: string, created_at: string): B.PaperRelation;

/**
 * A new reading list, its id from `deps.ids.newId()` and then its time from
 * `deps.clock.nowIso()`.
 *
 * # Errors
 *
 * Throws a `ReadingListValidationError` for a blank name or a wrongly shaped `input`, and
 * rethrows whatever `deps` throws.
 */
export function createReadingList(input: unknown, deps: { clock: { nowIso(): string }; ids: { newId(): string } }): B.ReadingList;

/**
 * [`create_reading_list`](reading_list::create_reading_list) with the id and time supplied.
 *
 * # Errors
 *
 * Fails if `input` has the wrong shape or the name is blank.
 */
export function createReadingListWith(input: unknown, id: string, now: string): B.ReadingList;

/**
 * [`create_report_section`](report_section::create_report_section) (TS `createReportSection`):
 * a new section from caller input. Invalid input throws an `Error` named
 * `ReportSectionValidationError` before an id is drawn; then `deps.ids.newId()` and
 * `deps.clock.nowIso()` are called, in that order.
 *
 * # Errors
 *
 * Throws the validation error, anything the deps throw, or fails if `input` has the wrong
 * shape.
 */
export function createReportSection(input: B.NewReportSectionInput, deps: { clock: { nowIso(): string }; ids: { newId(): string } }): B.ReportSection;

/**
 * [`create_report_section`](report_section::create_report_section) with the id and time
 * supplied. Call [`report_section_input_error_js`] first: invalid input fails here.
 *
 * # Errors
 *
 * Fails if `input` has the wrong shape or does not validate.
 */
export function createReportSectionWith(input: B.NewReportSectionInput, id: string, now_iso: string): B.ReportSection;

/**
 * A new vault page, its time from `deps.clock.nowIso()` and then its id from
 * `deps.ids.newId()`.
 *
 * # Errors
 *
 * Throws a `VaultPageValidationError` for a blank title or a wrongly shaped `input`, and
 * rethrows whatever `deps` throws.
 */
export function createVaultPage(input: unknown, deps: { clock: { nowIso(): string }; ids: { newId(): string } }): B.VaultPage;

/**
 * [`create_vault_page`](page::create_vault_page) with the id and time supplied.
 *
 * # Errors
 *
 * Fails if `input` has the wrong shape, or with the validation message when the title is blank.
 */
export function createVaultPageWith(input: unknown, id: string, now: string): B.VaultPage;

/**
 * An empty index `dimensions` wide.
 *
 * # Errors
 *
 * Fails when `dimensions` is zero.
 */
export function createVectorIndex(dimensions: number): VectorIndex;

/**
 * [`created_page_index`](proposal_created_page::created_page_index). `item` is a proposal with
 * `kind` and `payload`; `pages` is a list of pages with `title` and `parentId`. Returns the
 * index into `pages`, or `null`.
 *
 * # Errors
 *
 * Fails if an input cannot be read as the expected shape.
 */
export function createdPageIndex(item: B.ProposalPreviewItem, pages: readonly B.PageRef[]): number | null;

/**
 * [`creation_kind_for`](edit::creation_kind_for): the kind the "new file" gestures make for the
 * document on screen. `active` is `undefined` when no document is open.
 *
 * # Errors
 *
 * Fails if the result cannot be serialised.
 */
export function creationKindFor(active: { kind: string } | undefined): B.CreateKind;

/**
 * [`creation_target`](edit::creation_target): where a "new file" lands. `active` is `undefined`
 * when no document is open (a missing `parentId` means the root), `folders` the ids of the notes
 * made as folders.
 *
 * # Errors
 *
 * Fails if an argument does not have the expected shape, or the result cannot be serialised.
 */
export function creationTarget(kind: B.CreateKind, active: { kind: string; id: string; parentId?: string } | undefined, folders: ReadonlySet<string>): B.CreationTarget;

/**
 * [`crop_figure_to`](figure::crop_figure_to): a figure re-cropped to `kept` inside the uncropped
 * image `full`; keeping everything clears the crop (no `crop` key).
 *
 * # Errors
 *
 * Fails if `full` or `kept` has the wrong shape.
 */
export function cropFigureTo(full: B.FigureRect, kept: B.FigureRect): B.FigureBox;

/**
 * [`crossref_to_metadata`] (TS `crossrefToMetadata`). A Crossref `message` as a paper.
 *
 * # Errors
 *
 * Fails if `message` is not a Crossref message.
 */
export function crossrefToMetadata(message: B.CrossrefMessage, doi: string): B.ZoteroPaperInput;

/**
 * [`crossref_work_url`](source_requests::crossref_work_url) (TS `CrossrefMetadataSource.fetch`).
 */
export function crossrefWorkUrl(base: string, doi: string): string;

/**
 * [`damerau_levenshtein`](vocab_match::damerau_levenshtein) as a number.
 */
export function damerauLevenshtein(a: string, b: string): number;

/**
 * [`append_card_pair`](layout::append_card_pair): append one card to both breakpoints.
 *
 * # Errors
 *
 * Fails on a bad input shape or an unknown card type.
 */
export function dashboardAppendCardPair(layout_value: B.DashboardLayout, card_type: string, id: string, limits: readonly B.CardLimit[]): B.DashboardLayout;

/**
 * [`build_dashboard_stats`](stats::build_dashboard_stats) for the whole dashboard.
 *
 * # Errors
 *
 * Fails if `input` cannot be read as the expected shape.
 */
export function dashboardBuildStats(input: unknown, today: string): unknown;

/**
 * [`card_def`](card_registry::card_def): one card's catalog entry.
 *
 * # Errors
 *
 * Fails on an unknown card type.
 */
export function dashboardCardDef(card_type: string): unknown;

/**
 * [`registry`](card_registry::registry): every card's catalog entry, in picker order.
 *
 * # Errors
 *
 * Fails if the catalog cannot be converted to a JS value.
 */
export function dashboardCardRegistry(): unknown;

/**
 * [`cards_for_role`](card_registry::cards_for_role): the cards a viewer with `role` may add.
 *
 * # Errors
 *
 * Fails if the result cannot be converted to a JS value.
 */
export function dashboardCardsForRole(role?: string | null): unknown;

/**
 * [`close_gaps`](packing::close_gaps).
 *
 * # Errors
 *
 * Fails on a bad input shape or an unknown card type.
 */
export function dashboardCloseGaps(items: readonly B.LayoutItem[], limits: readonly B.CardLimit[], cols: number): B.LayoutItem[];

/**
 * [`compact_vertical`](packing::compact_vertical).
 *
 * # Errors
 *
 * Fails on a bad input shape.
 */
export function dashboardCompactVertical(items: readonly B.LayoutItem[], cols: number): B.LayoutItem[];

/**
 * [`data_sources_for_card_types`](card_registry::data_sources_for_card_types): the union of
 * the cards' data sources, each once.
 *
 * # Errors
 *
 * Fails on an unknown card type or a bad input shape.
 */
export function dashboardDataSourcesForCardTypes(card_types: readonly string[]): string[];

/**
 * [`default_layout`](layout::default_layout): the supervisor or the student default.
 *
 * # Errors
 *
 * Fails if the result cannot be converted to a JS value.
 */
export function dashboardDefaultLayout(supervisor: boolean): B.DashboardLayout;

/**
 * [`finalize_dashboard_layout`](layout::finalize_dashboard_layout).
 *
 * # Errors
 *
 * Fails on a bad input shape or an unknown card type.
 */
export function dashboardFinalizeLayout(layout_value: B.DashboardLayout, limits: readonly B.CardLimit[]): B.DashboardLayout;

/**
 * [`fit_max_heights`](card_registry::fit_max_heights): each fitted list card's largest height.
 *
 * # Errors
 *
 * Fails if the map cannot be converted to a JS value.
 */
export function dashboardFitMaxHeights(): Readonly<Record<string, number>>;

/**
 * [`is_stat_card`](card_registry::is_stat_card).
 *
 * # Errors
 *
 * Fails on an unknown card type.
 */
export function dashboardIsStatCard(card_type: string): boolean;

/**
 * [`cache_key`](layout::cache_key): the cache slot for one project's student or supervisor layout.
 */
export function dashboardLayoutCacheKey(project_id: string, supervisor_layout: boolean): string;

/**
 * [`floors`](packing::floors) for one card type on a grid `cols` wide.
 *
 * # Errors
 *
 * Fails if `limit` is not a card limit.
 */
export function dashboardLayoutFloors(limit: B.CardLimit, cols: number): { minW: number; minH: number; maxW: number; maxH: number };

/**
 * [`layout_signature`](layout::layout_signature).
 *
 * # Errors
 *
 * Fails on a bad input shape.
 */
export function dashboardLayoutSignature(items: readonly B.LayoutItem[]): string;

/**
 * [`lg_layout_needs_repair`](layout::lg_layout_needs_repair).
 *
 * # Errors
 *
 * Fails on a bad input shape or an unknown card type.
 */
export function dashboardLgNeedsRepair(items: readonly B.LayoutItem[], limits: readonly B.CardLimit[]): boolean;

/**
 * [`merge_rgl_positions`](layout::merge_rgl_positions): the grid's positions, normalized to `cols`.
 *
 * # Errors
 *
 * Fails on a bad input shape or an unknown card type.
 */
export function dashboardMergeRglPositions(items: readonly B.LayoutItem[], rgl: readonly B.RglPosition[], limits: readonly B.CardLimit[], cols: number): B.LayoutItem[];

/**
 * [`merge_supervisor_cards`](layout::merge_supervisor_cards). `ids` holds one new card id per
 * supervisor-only card type, in order.
 *
 * # Errors
 *
 * Fails on a bad input shape or an unknown card type.
 */
export function dashboardMergeSupervisorCards(layout_value: B.DashboardLayout, limits: readonly B.CardLimit[], ids: readonly string[]): B.DashboardLayout;

/**
 * [`needs_attention`](stats::needs_attention) for the given papers, milestones, experiments,
 * and `today` (`yyyy-mm-dd`).
 *
 * # Errors
 *
 * Fails if an input cannot be read as the expected shape.
 */
export function dashboardNeedsAttention(papers: unknown, milestones: unknown, experiments: unknown, today: string): unknown;

/**
 * [`normalize_item`](packing::normalize_item).
 *
 * # Errors
 *
 * Fails on a bad input shape or an unknown card type.
 */
export function dashboardNormalizeItem(item: B.LayoutItem, limits: readonly B.CardLimit[], cols: number): B.LayoutItem;

/**
 * [`pack_sm`](packing::pack_sm).
 *
 * # Errors
 *
 * Fails on a bad input shape or an unknown card type.
 */
export function dashboardPackSm(items: readonly B.LayoutItem[], limits: readonly B.CardLimit[]): B.LayoutItem[];

/**
 * [`resolve_deps`](card_registry::resolve_deps): the sources to fetch, every source when no
 * card is visible.
 *
 * # Errors
 *
 * Fails on an unknown card type or a bad input shape.
 */
export function dashboardResolveDeps(card_types: readonly string[]): string[];

/**
 * [`sm_layout_needs_repack`](layout::sm_layout_needs_repack).
 *
 * # Errors
 *
 * Fails on a bad input shape or an unknown card type.
 */
export function dashboardSmNeedsRepack(items: readonly B.LayoutItem[], limits: readonly B.CardLimit[]): boolean;

/**
 * [`supervisee_counts`](stats::supervisee_counts) for one supervisee.
 *
 * # Errors
 *
 * Fails if an input cannot be read as the expected shape.
 */
export function dashboardSuperviseeCounts(milestones: unknown, logs: unknown, today: string): unknown;

/**
 * [`sync_dashboard_layouts`](layout::sync_dashboard_layouts).
 *
 * # Errors
 *
 * Fails on a bad input shape or an unknown card type.
 */
export function dashboardSyncLayouts(layout_value: B.DashboardLayout, limits: readonly B.CardLimit[]): B.DashboardLayout;

/**
 * [`team_attention`](stats::team_attention) across all supervisees.
 *
 * # Errors
 *
 * Fails if `supervisees` cannot be read as the expected shape.
 */
export function dashboardTeamAttention(supervisees: unknown, today: string): unknown;

/**
 * [`top_tags`](stats::top_tags) with the `limit` most-used tags.
 *
 * # Errors
 *
 * Fails if `tags` cannot be read as the expected shape.
 */
export function dashboardTopTags(tags: unknown, limit: number): unknown;

/**
 * [`days_until_date`](timeline::days_until_date): the whole days from `today`, or `null`
 * unless both are real dates.
 */
export function daysUntilDate(iso: string, today: string): number | null;

/**
 * [`decide_annotation_sync`] for a row and a mode string (unknown modes act as `bidirectional`).
 *
 * # Errors
 *
 * Fails if `row` is not a `ZoteroAnnotationSyncRow` object.
 */
export function decideAnnotationSync(row: B.ZoteroAnnotationSyncRow, mode: "bidirectional" | "read_only" | "ignored" | undefined): B.ZoteroAnnotationDecision;

/**
 * [`wf_core::sync::git_policy::decide_git_sync_path`] for JS, as `{ include, reason? }`.
 *
 * # Errors
 *
 * Fails when `rel_path` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units, or the
 * decision cannot be converted to a JS value.
 */
export function decideGitSyncPath(rel_path: string, size_bytes: number, max_file_bytes: number): any;

/**
 * [`wf_core::sync::git_gate::decide_vault_commit`] for JS, as `{ ok, action? | reason? }`.
 *
 * # Errors
 *
 * Fails when `state` is not a valid repo state, or the verdict cannot be converted to a JS value.
 */
export function decideVaultCommit(enabled: boolean, state: any): any;

/**
 * [`declared_charset`]: the charset a page declares, lowercased, else `utf-8`.
 */
export function declaredCharset(content_type: string | null | undefined, bytes: Uint8Array): string;

/**
 * [`declared_length_over_cap`](redirect::declared_length_over_cap): refuse before reading when true.
 */
export function declaredLengthOverCap(declared: number, max_bytes: number): boolean;

/**
 * [`decode_base64`](bytea::decode_base64): bytes from base64 text, as `atob` reads it.
 *
 * # Errors
 * Throws when the text is not base64.
 */
export function decodeBase64(text: string): Uint8Array<ArrayBuffer>;

/**
 * [`decode_bytea`](bytea::decode_bytea): bytes from a PostgREST `\x…` string. PGlite hands a
 * bytea column back as bytes already, so a `Uint8Array` passes through unchanged.
 *
 * # Errors
 *
 * Throws when `value` is neither a string nor a `Uint8Array`.
 */
export function decodeBytea(value: string | Uint8Array): Uint8Array;

/**
 * [`decode_html_entities`]: the named and numeric entities in `value`, decoded once.
 *
 * # Errors
 *
 * Fails if `value` exceeds `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function decodeHtmlEntities(value: string): string;

/**
 * [`decode_ink_words`]: `words` is an array of `{ candidates, known?, join? }`,
 * `vocabulary` an array of strings.
 *
 * # Errors
 *
 * Fails if `words` or `vocabulary` is not such an array.
 */
export function decodeInkWords(words: readonly { candidates: readonly string[]; known?: readonly boolean[] | null; join?: string | null }[], vocabulary: readonly string[], engine_text?: string | null): { text: string; conf: number; alternatives?: string[] };

/**
 * [`decode_locus_value`] as a locus object, or `null` when malformed.
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 */
export function decodeLocus(raw?: string | null): B.AnchorPdfLocus | null;

/**
 * [`decode_share_link_token`](sharing::decode_share_link_token): the token's bytes; accepts
 * either base64 alphabet, padded or not.
 *
 * # Errors
 *
 * Throws an `Error` named `InvalidCharacterError` if `encoded` is not valid base64.
 */
export function decodeShareLinkToken(encoded: string): Uint8Array;

/**
 * [`deepest_first_list_ids`](reading_list::deepest_first_list_ids) (TS `removeList` order).
 *
 * # Errors
 *
 * Fails if `lists` has the wrong shape.
 */
export function deepestFirstListIds(list_id: string, lists: readonly B.ReadingList[]): string[];

/**
 * [`default_expanded`](state::default_expanded).
 *
 * # Errors
 *
 * Fails if the argument is not an array of strings, or the result cannot be serialised.
 */
export function defaultExpanded(roots: readonly string[]): readonly string[];

/**
 * [`default_graph_settings`](graph_settings::default_graph_settings).
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 */
export function defaultGraphSettings(): B.GraphViewSettings;

/**
 * [`wf_core::sync::ink_note::default_ink_note_meta`] for JS.
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 */
export function defaultInkNoteMeta(): B.InkNoteMeta;

/**
 * [`rules::default_mode_for`].
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 */
export function defaultModeFor(kind: string): B.DocumentMode;

/**
 * [`default_open_sections`](state::default_open_sections). Takes `{ id, collapsedByDefault }`
 * objects; extra fields are ignored.
 *
 * # Errors
 *
 * Fails if the argument is not an array of section declarations, or the result cannot be serialised.
 */
export function defaultOpenSections(sections: readonly { id: string; collapsedByDefault?: boolean }[]): string[];

/**
 * The default paste settings (TS `DEFAULT_PASTE_SETTINGS`).
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 */
export function defaultPasteSettings(): B.PasteSettings;

/**
 * [`default_share_link_expires_at`](sharing::default_share_link_expires_at): the default expiry
 * of a new view link. `now_ms` is the JS `Date.now()` value.
 */
export function defaultShareLinkExpiresAt(now_ms: number): string;

/**
 * [`default_source_note_template`](tpl::default_source_note_template): the default source-note
 * template text, with generated metadata and editable summary, key points and notes.
 */
export function defaultSourceNoteTemplate(): string;

/**
 * [`degree_colours`](node_colouring::degree_colours): `[id, colour]` pairs for `[id, degree]` pairs.
 *
 * # Errors
 *
 * Fails if `degree` is not an array of `[id, number]` pairs.
 */
export function degreeColours(degree: readonly (readonly [string, number])[]): [string, string][];

/**
 * [`deleted_local_base`] for JS (TS `deletedLocalBase`). Empty when there are no ops.
 *
 * # Errors
 *
 * Fails when `ops` is not a list of outbox ops.
 */
export function deletedLocalBase(ops: readonly B.OwedOp[]): Record<string, unknown>;

/**
 * [`deleted_remote_sides`] for JS (TS `deletedRemoteSides`). `stored` is the local row or
 * `null`; `null` is returned when neither it nor an owed op is available.
 *
 * # Errors
 *
 * Fails when `ops` is not a list of outbox ops or `stored` is not a plain object.
 */
export function deletedRemoteSides(ops: readonly B.OwedOp[], stored: Record<string, unknown> | null): B.Sides | null;

/**
 * [`deletion_action`] for JS (TS `deletionAction`). `kind` is `"deleted_remote"` or
 * `"deleted_local"`, `choice` is `"keep"` or `"delete"`, and `remote` is the server row or `null`.
 *
 * # Errors
 *
 * Fails when `kind` or `choice` is not one of its strings, or a row is not a plain object.
 */
export function deletionAction(kind: "deleted_remote" | "deleted_local", choice: "keep" | "delete", local: Record<string, unknown>, row_id: string, remote: Record<string, unknown> | null): B.ConflictDeletionAction;

/**
 * [`deletion_for`] (TS `deletionFor`). `kind` is `"deleted_remote"` or `"deleted_local"`,
 * `side` is `"local"` or `"remote"`; returns `"keep"` or `"delete"`.
 *
 * # Errors
 *
 * Fails if `kind` or `side` is not one of those strings.
 */
export function deletionFor(kind: "deleted_remote" | "deleted_local", side: "local" | "remote"): "keep" | "delete";

/**
 * [`wf_core::sync::git_policy::describe_changes`] for JS, from `[{ state: "added" | "modified" | "deleted" }]`.
 *
 * # Errors
 *
 * Fails when `status` is not that shape.
 */
export function describeChanges(status: readonly { state: "added" | "modified" | "deleted" }[]): string;

/**
 * [`describe_free_copy_failure`]: `outcome` is the `"none"` outcome of a search.
 *
 * # Errors
 *
 * Fails if `outcome` does not have the expected shape.
 */
export function describeFreeCopyFailure(outcome: { kind?: "none"; listed: number; attempts: ReadonlyArray<{ url: string; format: string; reason: "not-pdf" | "not-html" | "blocked" | "failed" | "abstract-only" | "no-storage" }>; unreachable: readonly string[]; asked: readonly string[] }, web_article?: boolean | null): string;

/**
 * [`describe_overleaf_status`](sync_status::describe_overleaf_status): the one-line status, or `""`
 * when no status was given (`null` or `undefined`).
 *
 * # Errors
 *
 * Fails if the status is malformed.
 */
export function describeOverleafStatus(status: B.OverleafSyncStatus | null | undefined): string;

/**
 * [`wf_core::sync::git_remote::describe_pull`] for JS.
 *
 * # Errors
 *
 * Fails when `result` is not a valid `GitPullResult` object.
 */
export function describePull(result: B.GitPullResult): string;

/**
 * [`wf_core::sync::git_remote::describe_push`] for JS.
 *
 * # Errors
 *
 * Fails when `result` is not a valid `GitPushResult` object.
 */
export function describePush(result: B.GitPushResult): string;

/**
 * The log line for a rejection reason (`describeRejection`).
 */
export function describeRejection(reason: unknown, origin: string | null, session_lost: boolean): string;

/**
 * [`wf_core::sync::git_remote::describe_status`] for JS.
 *
 * # Errors
 *
 * Fails when `status` is not a valid `{ url, branch, ahead, behind }` object.
 */
export function describeRemoteStatus(status: B.RemoteStatusInput): string;

/**
 * [`describe_sync`]: the one line the panel shows after a folder sync.
 *
 * # Errors
 *
 * Fails if `report` is not `{ written, removed, commitMessage?, commitError? }`.
 */
export function describeSync(report: B.SyncReport): string;

/**
 * [`rejection_copy`](url_safety::rejection_copy) for a reason code such as `"scheme"`.
 *
 * # Errors
 *
 * Fails if the value is not a known reason code.
 */
export function describeUrlRejection(reason: B.UrlRejection): string;

/**
 * [`detect_citation_style`] (TS `detectCitationStyle`). `texts` is the page texts as an array of
 * strings; the result is `"numeric"`, `"author-year"`, `"both"`, or `undefined` for neither.
 *
 * # Errors
 *
 * Fails if `texts` is not an array of strings.
 */
export function detectCitationStyle(texts: readonly string[]): B.CitationStyle | null | undefined;

/**
 * [`detect_columns`] as an array of 0-based column indices.
 *
 * # Errors
 *
 * Fails if `lines` is not an array of `TextLine` objects.
 */
export function detectColumns(lines: readonly B.TextLine[]): number[];

/**
 * [`device_label`](panel_labels::device_label): the adoption suffix name for a platform string.
 */
export function deviceLabel(platform: string): string;

/**
 * [`device_markers`](panel_labels::device_markers): conflict markers named for this device and the cloud.
 */
export function deviceMarkers(ours: string, theirs: string): string;

/**
 * [`diff_annotation_fields`] for a row: the fields that differ, in TS order.
 *
 * # Errors
 *
 * Fails if `row` is not a `ZoteroAnnotationSyncRow` object.
 */
export function diffAnnotationFields(row: B.ZoteroAnnotationSyncRow): B.ZoteroAnnotationFieldConflict[];

/**
 * [`wf_core::sync::text_diff::diff_body`] for JS, as `BodyDiff`.
 *
 * # Errors
 *
 * Fails when either text is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function diffBody(ours: string, theirs: string): B.BodyDiff;

/**
 * [`wf_core::sync::json_entities::diff_json_data`] for JS: what importing a JSON data file would
 * do to the stored rows. `options.origin?.(parsed.path)` says who changed the file.
 *
 * # Errors
 *
 * Fails when an argument does not match its shape, or `origin` throws.
 */
export function diffJsonData(parsed: B.ParsedJsonData, existing: readonly Readonly<Record<string, unknown>>[], options?: { origin?(path: string): B.ChangeSide }): B.JsonDiff;

/**
 * [`wf_core::sync::deserialize::diff_workspace`] for JS: what importing `parsed` would do to
 * `existing`. `options.origin` is asked once for every parsed path up front (so it must be
 * pure); a path it lacks is `Unknown`, and without it there is no origin.
 *
 * # Errors
 *
 * Fails when an argument does not match its shape, or `origin` throws.
 */
export function diffWorkspace(parsed: readonly B.ParsedEntity[], existing: readonly B.ExistingEntity[], options?: { origin?(path: string): B.ChangeSide }): B.ImportDiff;

/**
 * [`wf_core::sync::change_origin::digest_text`] for JS.
 */
export function digestText(text: string): string;

/**
 * [`dir_entry_names`](git_shim::dir_entry_names): direct child names of `dir`, UTF-16 sorted.
 */
export function dirEntryNames(paths: readonly string[], dir: string): string[];

/**
 * [`distance_to_segment_squared`](hit_test::distance_to_segment_squared).
 */
export function distanceToSegmentSquared(px: number, py: number, ax: number, ay: number, bx: number, by: number): number;

/**
 * [`document_boost`](search_tuning::document_boost). `options.now` is epoch milliseconds and
 * defaults to `Date.now()`; `options` defaults to `{}`.
 *
 * # Errors
 *
 * Fails if `doc` or `options` has the wrong shape.
 */
export function documentBoost(doc: { degree: number; updatedAt: string }, options: B.DocumentBoostOptions & { now?: number }): number;

/**
 * [`document_id_of`](semantic_fingerprint::document_id_of): the document a passage id belongs to.
 */
export function documentIdOf(passage: string): string;

/**
 * [`document_id_of_path`](semantic_fingerprint::document_id_of_path): the document id behind a workspace file name.
 */
export function documentIdOfPath(file: string): string;

/**
 * [`rules::document_kind`].
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 */
export function documentKind(kind: string): B.KindDocument;

/**
 * [`rules::document_suffix`].
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 */
export function documentSuffix(kind: string): string;

/**
 * [`double_click_figure`](page_math::double_click_figure): the figure every press lands
 * in, ignoring `skip` (default none), or `null`.
 *
 * # Errors
 *
 * Fails if `figures` is not an array of boxes or `points` is not an array of points.
 */
export function doubleClickFigure(figures: readonly (B.HitBox | undefined)[], points: readonly B.Point[], skip?: number | null): number | null;

/**
 * [`draft_from_text_selection`]: `null` when the selection has no placeable text.
 *
 * # Errors
 *
 * Fails if `input` is not a text-selection draft.
 */
export function draftFromTextSelection(input: B.TextSelectionDraft): T.NewReaderAnnotation | null;

/**
 * [`draft_icon`](edit::draft_icon).
 *
 * # Errors
 *
 * Fails if the argument is not a create kind, or the result cannot be serialised.
 */
export function draftIcon(kind: B.CreateKind): string;

/**
 * [`draft_image_region`]: a region mark, or `null` for an empty region.
 *
 * # Errors
 *
 * Fails if `input` is not an image-region draft.
 */
export function draftImageRegion(input: B.ImageRegionDraft): T.NewReaderAnnotation | null;

/**
 * [`draft_ink_annotation`]: the ink mark to save, or `null` when nothing was drawn.
 *
 * # Errors
 *
 * Fails if `input` is not an ink draft.
 */
export function draftInkAnnotation(input: B.InkDraft): T.NewReaderAnnotation | null;

/**
 * [`draft_makes`](edit::draft_makes).
 *
 * # Errors
 *
 * Fails if the argument is not a create kind, or the result cannot be serialised.
 */
export function draftMakes(kind: B.CreateKind): B.DraftMakes;

/**
 * [`draft_picture`]: a new picture mark sized to half the page at the picture's own aspect.
 *
 * # Errors
 *
 * Fails if `input` is not a picture-draft object.
 */
export function draftPicture(input: B.PictureDraftInput): T.NewReaderAnnotation;

/**
 * [`draft_placeholder`](edit::draft_placeholder).
 *
 * # Errors
 *
 * Fails if the argument is not a create kind, or the result cannot be serialised.
 */
export function draftPlaceholder(kind: B.CreateKind): string;

/**
 * [`draft_reading_log`](reading_digest::draft_reading_log) (TS `draftReadingLog`).
 *
 * # Errors
 *
 * Fails if `papers` or `marks` are not lists of the right shape.
 */
export function draftReadingLog(papers: readonly B.ReadingPaper[], marks: readonly B.ReadingMark[], day: string): string;

/**
 * [`draft_text_box`]: a text-box mark.
 *
 * # Errors
 *
 * Fails if `input` is not a text-box draft.
 */
export function draftTextBox(input: B.TextBoxDraft): T.NewReaderAnnotation;

/**
 * [`drop_parent_id`](edit::drop_parent_id).
 *
 * # Errors
 *
 * Fails if the node does not have the expected shape, or the result cannot be serialised.
 */
export function dropParentId(target: B.WorkspaceTreeNode): string | null;

/**
 * [`duplicate_plan`](duplicate::duplicate_plan) as `{ title, parentId, body }`, or `null`.
 *
 * # Errors
 *
 * Fails if `doc` or `documents` does not have the shape of a duplicate source.
 */
export function duplicatePlan(doc: B.DuplicateSource | null | undefined, documents: readonly B.DuplicateSource[]): B.DuplicatePlan | null;

/**
 * [`edit_sides`] for JS (TS `editSides`). `null` when no non-delete op is owed.
 *
 * # Errors
 *
 * Fails when `ops` is not a list of outbox ops.
 */
export function editSides(ops: readonly B.OwedOp[]): B.Sides | null;

/**
 * [`edited_relative_label`](edited_label::edited_relative_label) (TS `editedRelativeLabel`).
 * `None` (a week or more, or NaN) becomes `null`; the caller then shows the date.
 */
export function editedRelativeLabel(seconds: number): string | null;

/**
 * [`effective_field_boosts`](search_settings::effective_field_boosts).
 *
 * # Errors
 *
 * Fails if `settings` cannot be read as JSON.
 */
export function effectiveFieldBoosts(settings?: B.SearchSettings): B.FieldBoosts;

/**
 * [`effective_relation_types`](graph_settings::effective_relation_types).
 *
 * # Errors
 *
 * Fails if `settings` has the wrong shape.
 */
export function effectiveRelationTypes(settings: B.GraphViewSettings): B.RelationType[];

/**
 * [`ema_smooth`]: debiased EMA over the values; `null` gaps stay gaps.
 */
export function emaSmooth(values: (number | null)[], alpha: number): (number | null)[];

/**
 * [`IDLE_EVICT_MS`](embedding_runtime::IDLE_EVICT_MS): milliseconds an idle embedder keeps its model.
 */
export function embedIdleEvictMs(): number;

/**
 * [`embed_titles`](page::embed_titles): the trimmed title of each `![[...]]` in `body`.
 */
export function embedTitles(body: string): string[];

/**
 * [`embeddable_text`](semantic_fingerprint::embeddable_text): the text a document is embedded from.
 */
export function embeddableText(title: string, aliases: readonly string[], body: string): string;

/**
 * [`empty_cell_paper_ids`]: the papers whose cell for `field_id` is empty and not pending.
 */
export function emptyCellPaperIds(rows: readonly B.ExtractionRow[], field_id: string, pending_paper_ids: readonly string[]): string[];

/**
 * [`empty_integration`](fields::empty_integration): the integration a provider starts from.
 *
 * # Errors
 *
 * Fails if `provider` is not `"github"`, `"gitlab"` or `"mattermost"`.
 */
export function emptyIntegration(provider: B.SyncProvider): B.EmptyIntegration;

/**
 * [`empty_layout`](pane::empty_layout).
 *
 * # Errors
 *
 * Never fails in practice; returns the serializer's result type.
 */
export function emptyLayout(pane_id?: string | null): B.PaneLayout;

/**
 * [`empty_page_history`] as `{ undo: [], redo: [] }`.
 */
export function emptyPageHistory(): B.PageHistory;

/**
 * [`encode_base64`](bytea::encode_base64): padded base64 for bytes.
 */
export function encodeBase64(bytes: Uint8Array): string;

/**
 * [`encode_bytea`](bytea::encode_bytea): PostgREST `\x…` string for bytes.
 */
export function encodeBytea(bytes: Uint8Array): string;

/**
 * [`encode_ink_chunk_body`](chunk::encode_ink_chunk_body): a page packed into an uncompressed body.
 *
 * # Errors
 *
 * Fails on a page the format cannot hold, or one that is not an `InkPage`.
 */
export function encodeInkChunkBody(page: object): Uint8Array;

/**
 * [`encode_locus`] as raw JSON (encode at the URL layer, not here).
 *
 * # Errors
 *
 * Fails if `locus` is not a locus object.
 */
export function encodeLocus(locus: B.AnchorPdfLocus): string;

/**
 * [`nav_open_groups::encode_open_groups`]: the stored JSON for an open-groups list.
 *
 * # Errors
 *
 * Fails if `groups` is not an array of strings.
 */
export function encodeOpenGroups(groups: readonly string[]): string;

/**
 * [`encode_rollup_options`](paper_field::encode_rollup_options) (TS `encodeRollupOptions`).
 *
 * # Errors
 *
 * Fails if `config` is not a rollup config object.
 */
export function encodeRollupOptions(config: B.PaperFieldRollupConfig): string[];

/**
 * [`encode_share_link_token`](sharing::encode_share_link_token): unpadded base64url.
 */
export function encodeShareLinkToken(token: Uint8Array): string;

/**
 * [`local_db_engine_params::engine_start_params`]: `defaults` (a string array) with the shared-buffers flags appended.
 */
export function engineStartParams(defaults: readonly string[]): string[];

/**
 * [`wf_core::sync::folder_layout::entity_dir`] for JS.
 *
 * # Errors
 *
 * Fails when `entity` is not a workspace entity type, or `project_root` is
 * over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function entityDir(entity: string, project_root?: string | null): string;

/**
 * [`entry_file_error`](overleaf::entry_file_error): the message for an unsafe entry file
 * path, or `null`.
 */
export function entryFileError(entry_file: string): string | null;

/**
 * [`enum_label::enum_label`]: the label for `value` under `kind`, humanised when unknown.
 */
export function enumLabel(kind: string, value: string): string;

/**
 * [`enum_label::enum_options`] as `{ value, label }` objects, in the fixed order.
 *
 * # Errors
 *
 * Fails if the result cannot be converted to JS.
 */
export function enumOptions(kind: string): B.EnumOption[];

/**
 * [`erase_ink_paths`]: the anchor with the paths under the eraser removed, or `null` when all were removed.
 *
 * # Errors
 *
 * Fails if `anchor` is malformed.
 */
export function eraseInkPaths(anchor: T.CombinedPdfAnchor, x: number, y: number, radius: number): T.CombinedPdfAnchor | null;

/**
 * [`wf_core::error_report::detail::error_detail`] for JS: the message, digest and stack, one per
 * line. The caller reads the fields off the thrown `Error` and passes them; absent ones are
 * `undefined`.
 */
export function errorDetail(message?: string | null, digest?: string | null, stack?: string | null): string;

/**
 * [`log_buffer::console_line`] for JS: `[level] text`.
 */
export function errorLogConsoleLine(level: string, text: string): string;

/**
 * [`log_buffer::error_entry`] for JS: `{ message, detail? }`.
 *
 * # Errors
 *
 * Fails when the entry cannot be converted to a JS value.
 */
export function errorLogEntry(text: string): unknown;

/**
 * [`log_buffer::is_noise`] for JS: whether a failed request to `url` is left out of the log.
 */
export function errorLogIsNoise(url: string): boolean;

/**
 * [`log_buffer::push_line`] for JS: the new line list, the oldest dropped past the cap.
 *
 * # Errors
 *
 * Fails when `lines` is not an array of strings.
 */
export function errorLogPushLine(lines: unknown, line: string): unknown;

/**
 * [`log_buffer::record_uncaught`] for JS: the new line list with `[uncaught] text` appended.
 *
 * # Errors
 *
 * Fails when `lines` is not an array of strings.
 */
export function errorLogRecordUncaught(lines: unknown, text: string): unknown;

/**
 * [`log_buffer::remember`] for JS: `{ seen, recorded }`.
 *
 * # Errors
 *
 * Fails when `seen` is not an array of strings.
 */
export function errorLogRemember(seen: unknown, text: string): unknown;

/**
 * [`escape_html`](text::escape_html): `&`, `<`, `>` and `"` made safe for markup.
 */
export function escapeHtml(value: string): string;

/**
 * [`escape_latex_text`](markdown_to_latex::escape_latex_text) (TS `escapeLatexText`).
 */
export function escapeLatexText(s: string): string;

/**
 * [`escape_link_label`] for JS.
 */
export function escapeLinkLabel(label: string): string;

/**
 * [`evaluate_ai_access`](access_policy::evaluate_ai_access); `now` is the ISO 8601 clock time.
 *
 * # Errors
 *
 * Fails if `input` has the wrong shape.
 */
export function evaluateAiAccess(input: R<B.AiPolicyInput>, now: string): T.AiPolicyDecision;

/**
 * [`excerptOf`]: a 200-character excerpt of `body` around `terms`, cut like [`index_terms_of_js`].
 *
 * # Errors
 *
 * Fails if `terms` is not an array of strings, or if the terms together need more than
 * `MAX_INDEX_TEXT_UTF16` units (each counts its length + 1), as the TS `buildExcerpt` does.
 */
export function excerptOf(body: string, terms: readonly string[]): { text: string; highlights: { start: number; end: number }[] };

/**
 * [`excerpt_segments`](excerpt_segments::excerpt_segments) as `{text,
 * highlighted}` runs.
 *
 * # Errors
 *
 * Fails if `excerpt` is not a `{text, highlights}` record.
 */
export function excerptSegments(excerpt: { text: string; highlights: readonly { start: number; end: number }[] }): { text: string; highlighted: boolean }[];

/**
 * [`exclusion_reasons`](screening::exclusion_reasons) (TS `exclusionReasons`): why items were
 * excluded at `stage` (default `full_text`), most common first.
 *
 * # Errors
 *
 * Fails if `decisions` or `stage` has the wrong shape.
 */
export function exclusionReasons(decisions: readonly B.ScreeningDecision[], stage?: B.ScreeningStage): B.ExclusionReasonCount[];

/**
 * [`exec_command_name`](edit_menu::exec_command_name): the execCommand id for an edit command,
 * or `undefined` for paste and anything else.
 */
export function execCommandName(command: string): string | undefined;

/**
 * [`expand_embeds`](page::expand_embeds): `body` with each embed whose title is in `resolved`
 * replaced by that note's body as a callout.
 *
 * # Errors
 *
 * Fails if `resolved` holds a key or value that is not a string.
 */
export function expandEmbeds(body: string, resolved: ReadonlyMap<string, string>): string;

/**
 * [`expand_ipv6`](url_safety::expand_ipv6): the eight groups; `null` when the text is not IPv6.
 *
 * # Errors
 *
 * Fails if the groups cannot be converted to a JS value.
 */
export function expandIpv6(value: string): number[] | null;

/**
 * [`experiment_activity_at`](experiment_status::experiment_activity_at).
 *
 * # Errors
 *
 * Fails if `experiment` has the wrong shape.
 */
export function experimentActivityAt(experiment: B.Experiment): number;

/**
 * [`experiment_href`](experiment_status::experiment_href): where an experiment opens.
 */
export function experimentHref(id: string, is_offline_build: boolean): string;

/**
 * [`EXPERIMENTS_HREF`](experiment_status::EXPERIMENTS_HREF): the experiments list.
 */
export function experimentsListHref(): string;

/**
 * [`explain_arm`](related::explain_arm).
 *
 * # Errors
 *
 * Fails if `arm` is not a known arm name.
 */
export function explainArm(arm: B.RelatedArm): string;

/**
 * [`export_asset_path`]: the folder a stored asset is written to in the export.
 */
export function exportAssetPath(root: string, prefix: string, storage_path: string): string;

/**
 * [`export_manifest_json`]: the export's `manifest.json` text.
 */
export function exportManifestJson(exported_at: string, stats: B.ExportStats): string;

/**
 * [`export_readme`]: the export's `README.txt` text.
 */
export function exportReadme(exported_at: string): string;

/**
 * [`wf_core::papers::paper_ref::extract_doi`]: the DOI found in `value`, or `None`.
 *
 * # Errors
 *
 * Fails if `value` exceeds `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function extractDoi(value: string): string | undefined;

/**
 * [`extract_hashtag_refs`](paper::extract_hashtag_refs) (TS `extractHashtagRefs`).
 *
 * # Errors
 *
 * Fails only if the result cannot be converted to a JS value.
 */
export function extractHashtagRefs(text?: string | null | undefined): B.HashtagRef[];

/**
 * [`extract_hashtags`](paper::extract_hashtags) (TS `extractHashtags`).
 */
export function extractHashtags(text?: string | null | undefined): string[];

/**
 * [`extract_headings`](search_document::extract_headings).
 */
export function extractHeadings(body?: string | null): string[];

/**
 * [`extract_lexical`](lexical_concepts::extract_lexical): the concepts found in the documents.
 *
 * # Errors
 *
 * Fails if the request is malformed or the result cannot be converted to a JS value.
 */
export function extractLexical(request: B.LexicalRequest): B.ExtractionResult;

/**
 * [`wf_core::papers::page_metadata::extract_page_metadata`]: metadata of a
 * fetched page (`PageMetadata` in `bindings.ts`).
 *
 * # Errors
 *
 * Fails if `html` or `url` exceeds `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function extractPageMetadata(html: string, url: string): B.PageMetadata;

/**
 * [`extract_page_title`](page_title::extract_page_title): `{ title, suspect }`, or
 * `null` when the HTML has no title.
 *
 * # Errors
 *
 * Fails if `html` exceeds `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function extractPageTitle(html: string): { title: string; suspect: boolean } | null;

/**
 * [`extractVenue`](bibliography::extract_venue): venue named after the title, if any.
 */
export function extractVenue(after_title: string): string | undefined;

/**
 * [`extract_wikilinks`](page::extract_wikilinks) (TS `extractWikilinks`). Offsets are UTF-16;
 * a missing or empty body has none.
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 */
export function extractWikilinks(body?: string | null): B.WikilinkRef[];

/**
 * [`extraction_csv`]: the table as CSV, with a header line.
 */
export function extractionCsv(rows: readonly B.ExtractionRow[], defs: readonly B.ExtractionFieldDef[], columns: readonly string[]): string;

/**
 * [`extraction_markdown`]: the table as a Markdown table.
 */
export function extractionMarkdown(rows: readonly B.ExtractionRow[], defs: readonly B.ExtractionFieldDef[], columns: readonly string[]): string;

/**
 * [`fence_untrusted`](untrusted_context::fence_untrusted).
 *
 * # Errors
 *
 * Fails if `items` is not an array of `{ label, text }` objects.
 */
export function fenceUntrusted(items: readonly B.UntrustedItem[], nonce: string): string;

/**
 * [`DEFAULT_FETCH_LIMITS`](url_safety::DEFAULT_FETCH_LIMITS): the caps read at call time.
 *
 * # Errors
 *
 * Fails if the limits cannot be converted to a JS value.
 */
export function fetchLimits(): B.OutboundFetchLimits;

/**
 * [`figure_alt_for`](figure::figure_alt_for): the figure alt of the image at `path`, or `undefined`.
 *
 * # Errors
 *
 * Fails if `body` is longer than the index text limit.
 */
export function figureAltFor(body: string, path: string): string | null;

/**
 * [`figure_clip_text`]: the clipboard text for a copied figure.
 */
export function figureClipText(clip: B.FigureClip): string;

/**
 * [`figure_corner_hit`](figure::figure_corner_hit): the corner grab distance at `scale`.
 */
export function figureCornerHit(scale: number): number;

/**
 * [`figure_image_frame`](figure::figure_image_frame): the whole picture inside the frame, in percent.
 *
 * # Errors
 *
 * Fails if `value` has the wrong shape.
 */
export function figureImageFrame(value: B.FigureBox): B.FigureImageFrame;

/**
 * [`figure_label`](figure_label::figure_label): the label for an artifact URL. `index` is 0-based.
 */
export function figureLabel(url: string, index: number): string;

/**
 * [`figure_under`](page_math::figure_under): the topmost figure holding `at`, edges
 * included, ignoring `skip` (default none); `null` when there is none.
 *
 * # Errors
 *
 * Fails if `figures` is not an array of boxes or `at` is not a point.
 */
export function figureUnder(figures: readonly (B.HitBox | undefined)[], at: B.Point, skip?: number | null): number | null;

/**
 * [`matching_completions`](cite_links::matching_completions) (TS `filterCompletions`): the
 * indices of the completions the menu shows for `query`, at most 20.
 *
 * # Errors
 *
 * Fails if `items` is not an array of `{ title, label, detail? }`.
 */
export function filterCiteCompletions(items: readonly { title: string; label: string; detail?: string }[], query: string): Uint32Array;

/**
 * [`pglite_sql::filter_operator`] (TS `filterOperator`): the SQL operator for a filter name, or undefined.
 */
export function filterOperator(name: string): string | undefined;

/**
 * [`filter_rows`](tree::filter_rows): the rows to paint and the keys to expand (a JS `Set`).
 *
 * # Errors
 *
 * Fails if `rows` has the wrong shape.
 */
export function filterRows(rows: readonly B.VisibleRow[], query: string): { rows: B.VisibleRow[]; expand: Set<string> };

/**
 * [`find_annotation_backlinks`](backlinks::find_annotation_backlinks) as an array of hits.
 *
 * # Errors
 *
 * Fails if `input` lacks the `annotations`, `pins`, `sections` or `vaultPages` arrays.
 */
export function findAnnotationBacklinks(input: { annotations: readonly { id: string; zoteroKey?: string | null; text: string }[]; pins: readonly { annotationKey: string; reportSectionId: string }[]; sections: readonly { id: string; title: string }[]; vaultPages: readonly { id: string; title: string; body?: string | null }[] }): B.AnnotationBacklinkHit[];

/**
 * [`find_citation_candidates`](analysis_citations::find_citation_candidates) (TS `findCitationCandidates`).
 *
 * # Errors
 *
 * Fails if `items` is not an array of text items.
 */
export function findCitationCandidates(items: readonly B.AnalysisPdfItem[]): B.CitationCandidate[];

/**
 * [`find_document_matches`] as an array of `{ pageIndex, start, end }`; `pages` is `{ pageIndex, text }[]`.
 *
 * # Errors
 *
 * Fails if `pages` is not an array of `{ pageIndex, text }` objects.
 */
export function findDocumentMatches(pages: readonly { pageIndex: number; text: string }[], query: string): { pageIndex: number; start: number; end: number }[];

/**
 * [`find_duplicate_groups`] (TS `findDuplicateGroups`). Groups of two or more papers.
 *
 * # Errors
 *
 * Fails if `papers` is not a list of paper summaries, or the result cannot be converted.
 */
export function findDuplicateGroups(papers: readonly B.TidyPaper[]): B.DuplicateGroup[];

/**
 * [`find_figure_mentions`] (TS `findFigureMentions`). `outline` is optional.
 *
 * # Errors
 *
 * Fails if `pages` or `outline` do not have the expected shape.
 */
export function findFigureMentions(pages: readonly B.FigurePage[], outline?: readonly B.OutlineReaderItem[] | null): B.FigureMention[];

/**
 * [`find_heading_lines`] (TS `findHeadingLines`). `furniture` flags, per line, the lines that
 * count as furniture (never headings).
 *
 * # Errors
 *
 * Fails if `lines` is not an array of text lines or `furniture` is not an array of booleans.
 */
export function findHeadingLines(lines: readonly B.AnalysisTextLine[], body: number, furniture: readonly boolean[]): B.AnalysisTextLine[];

/**
 * [`wf_core::sync::markdown_image::find_image_refs`] for JS, with one `head`.
 *
 * # Errors
 *
 * Fails when `body` or `head` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function findImageRefs(body: string, head: string, allow_space: boolean): B.FoundImageRef[];

/**
 * [`find_marks`]: where each match falls in the document, as a fraction of its height.
 *
 * # Errors
 *
 * Fails if `matches` or `pages` do not have the expected shape.
 */
export function findMarks(matches: readonly B.FindMarkMatch[], num_pages: number, pages: readonly B.FindMarkPage[]): B.FindMark[];

/**
 * [`find_pattern_citation_mentions`](analysis_citations::find_pattern_citation_mentions) (TS
 * `findPatternCitationMentions`). `excluded` defaults to none; `candidates` defaults to
 * [`find_citation_candidates`](analysis_citations::find_citation_candidates) over `page.items`.
 *
 * # Errors
 *
 * Fails if `page`, `refs`, `excluded` or `candidates` do not have the expected shape.
 */
export function findPatternCitationMentions(page: { number: number; text: string; items: readonly B.AnalysisPdfItem[] }, refs: readonly B.AnalysisParsedReference[], excluded?: readonly B.AnalysisPageTextRange[], candidates?: readonly B.CitationCandidate[]): B.AnalysisCitationMention[];

/**
 * [`find_quote_matches`] as an array of `{ start, end }`.
 *
 * # Errors
 *
 * Fails if `quote` is not a quote selector object.
 */
export function findQuoteMatches(text: string, quote: B.AnchorQuoteSelector): { start: number; end: number }[];

/**
 * [`find_reference_section`] (TS `findReferenceSection`). `furniture` is an optional
 * per-line boolean array, `undefined` or `null` for none.
 *
 * # Errors
 *
 * Fails if `lines` is not an array of text lines or `furniture` is not an array of booleans.
 */
export function findReferenceSection(lines: readonly B.AnalysisTextLine[], body_font_size: number, page_count: number, furniture?: readonly boolean[] | null): B.ReferenceSectionSpan | null;

/**
 * [`find_related`](related::find_related): graph walk first, then the lexical arm, then the tag
 * arm; the first non-empty arm wins and later arms run only when needed. `limit` defaults to 10
 * and `options.rng` to `Math.random`; a missing arm finds nothing.
 *
 * # Errors
 *
 * Fails if `deps.graph` or `options` has the wrong shape, or an arm or `rng` throws.
 */
export function findRelated(seedId: string, deps: { graph: { nodes: string[]; edges: Map<string, string[]> }; lexical?: (seedId: string, limit: number) => { id: string; score: number }[]; tagged?: (seedId: string, limit: number) => { id: string; score: number }[] }, limit?: number, options?: { numWalks?: number; maxSteps?: number; damping?: number; rng?: () => number }): B.RelatedResult[];

/**
 * [`find_title_match`](link_resolve::find_title_match). Returns the index of the match, or
 * `undefined` in JS when none matches.
 */
export function findTitleMatch(existing_titles: readonly string[], title: string): number | undefined;

/**
 * [`find_wiki_root`]: the note titled `Wiki`, or nothing.
 */
export function findWikiRoot(pages: readonly B.WikiNote[]): B.WikiNote | null;

/**
 * [`finished_links`](cite_links::finished_links) (TS `finishedLinks`): the target of each
 * `[[link]]` the caret has left. A negative `caret` means the editor has no focus.
 */
export function finishedLinks(doc: string, caret: number): string[];

/**
 * [`fit_cols`](plot_size::fit_cols).
 */
export function fitCols(grid_width: number, gap: number): number;

/**
 * [`fit_layout_to_content`](fit::fit_layout_to_content). `measured` and `maxHeights` map a card id
 * (or card type) to rows; only card types in `maxHeights` fit their content. `measured` is a JS
 * `Map` (a plain object also works).
 *
 * # Errors
 *
 * Fails when an argument is not the expected shape.
 */
export function fitLayoutToContent(items: readonly B.LayoutItem[], measured: ReadonlyMap<string, number>, max_heights: Readonly<Record<string, number>>): B.LayoutItem[];

/**
 * [`fit_scale`](page_math::fit_scale): CSS pixels per 0.1 mm unit, `1` with no width.
 */
export function fitScale(container_width: number, page_width: number): number;

/**
 * [`fits_ink_note_budget`](chunk::fits_ink_note_budget): whether these chunk sizes fit a note.
 */
export function fitsInkNoteBudget(sizes: readonly number[]): boolean;

/**
 * [`flat_path`](folder_layout::flat_path). `entity` is a `WorkspaceEntityType` string.
 *
 * # Errors
 *
 * Fails if `entity` is not a known entity type.
 */
export function flatPath(entity: string, id: string, title: string, project_root?: string | null): string;

/**
 * [`flatten`] over `docs`: the project's text files as paths, in walk order.
 */
export function flattenOverleafDocs(root_folder: unknown): B.LiveDocEntry[];

/**
 * [`flatten`] over `fileRefs`: the project's binary files as paths, in walk order.
 */
export function flattenOverleafFiles(root_folder: unknown): B.LiveDocEntry[];

/**
 * [`flatten_paper_rows`]: the listed papers that exist, each with its index in `known_ids` and
 * its stored and rollup values, in list order.
 */
export function flattenPaperRows(known_ids: readonly string[], paper_ids: readonly string[], values: readonly B.RollupValue[], defs: readonly B.ExtractionFieldDef[]): { paperIndex: number; values: B.ExtractionValues["values"] }[];

/**
 * [`flatten_tree`](tree::flatten_tree).
 *
 * # Errors
 *
 * Fails if `nodes` has the wrong shape.
 */
export function flattenTree(nodes: readonly B.WorkspaceTreeNode[]): B.WorkspaceTreeNode[];

/**
 * [`focus_pane`](pane::focus_pane).
 *
 * # Errors
 *
 * Fails if `layout` has the wrong shape.
 */
export function focusPane(layout: B.PaneLayout, pane_id: string): B.PaneLayout;

/**
 * [`focused_tab_count`](pane::focused_tab_count).
 *
 * # Errors
 *
 * Fails if `layout` has the wrong shape.
 */
export function focusedTabCount(layout: B.PaneLayout): number;

/**
 * [`folder_draft_for_project`](folder_draft::folder_draft_for_project): the parsed draft when it
 * belongs to the project, or `null`.
 *
 * # Errors
 *
 * Fails only if the result cannot be converted to a JS value.
 */
export function folderDraftForProject(raw: string, project_id?: string | undefined): unknown;

/**
 * [`folder_ids_of`](tree::folder_ids_of) as a JS `Set`, filled in sorted order.
 *
 * # Errors
 *
 * Fails if `nodes` has the wrong shape.
 */
export function folderIdsOf(nodes: readonly B.WorkspaceTreeNode[]): Set<string>;

/**
 * [`folder_key`](folder_layout::folder_key) (TS `folderSegments` joined with `/`): the folder
 * of one picked file's relative path.
 */
export function folderKey(relative_path: string): string;

/**
 * [`folder_keys`](folder_layout::folder_keys) (TS `folderKeys`): every folder the picked files
 * lead to, shallowest first.
 */
export function folderKeys(relative_paths: readonly string[]): string[];

/**
 * [`folder_title_from_path`](folder_layout::folder_title_from_path).
 */
export function folderTitleFromPath(path: string): string;

/**
 * [`font_size_of`](analysis_text::font_size_of) (TS `fontSizeOf`).
 *
 * # Errors
 *
 * Fails if `item` is not a text item with `str`, `transform`, `width` and `height`.
 */
export function fontSizeOf(item: B.AnalysisPdfItem): number;

/**
 * [`forget_search_query`](search_history::forget_search_query).
 */
export function forgetSearchQuery(history: readonly string[], query: string): string[];

/**
 * [`format_citation`](cite_key::format_citation) (TS `formatCitation`).
 */
export function formatCitation(key: string, format: string): string;

/**
 * [`format_count`](stats::format_count).
 */
export function formatCount(value: number): string;

/**
 * [`format_cursor`](stats::format_cursor) of `{ line, col }`: "Ln 7, Col 4".
 *
 * # Errors
 *
 * Fails if `cursor` has no numeric `line` and `col`.
 */
export function formatCursor(cursor: { line: number; col: number }): string;

/**
 * "1 Jul 2026" for an ISO date or datetime, `""` when it does not parse.
 */
export function formatDate(input: string, offset_minutes: number): string;

/**
 * "1 Jul 2026, 14:05" for an ISO datetime, `""` when it does not parse.
 */
export function formatDateTime(input: string, offset_minutes: number): string;

/**
 * The display text for a thrown value (`formatError`).
 */
export function formatError(err: unknown, origin: string | null, session_lost: boolean): string;

/**
 * The body message and the log line for a route's error (`formatErrorForResponse`).
 * Returns `{ message, log? }`; `log` is set only for the database and cause paths.
 */
export function formatErrorForResponse(err: unknown, context: string, origin: string | null, session_lost: boolean): { message: string; log?: string };

/**
 * [`format_figure_tokens`](figure::format_figure_tokens): the tokens written in an alt.
 *
 * # Errors
 *
 * Fails if `geometry` has the wrong shape.
 */
export function formatFigureTokens(geometry: B.FigureBox): string;

/**
 * [`format_invite_code`](org::format_invite_code).
 */
export function formatInviteCode(raw: string): string;

/**
 * [`format_log_line`]: one log entry as the text the panel and the log file both show.
 *
 * # Errors
 *
 * Fails if `entry` lacks one of the string fields.
 */
export function formatLogLine(entry: { at: string; level: string; source: string; message: string; detail?: string }): string;

/**
 * [`format_metric_cell`](experiment_status::format_metric_cell): one metric's value as text, for a
 * chip or a table cell. A bigint shows as `String(bigint)`. An object, function or symbol first
 * goes through `JSON.stringify` (its `toJSON`, dropped `undefined`s); a cycle or an unrepresentable
 * value shows "—", and a `toJSON` that returned a primitive shows the JSON text itself.
 *
 * # Errors
 *
 * Fails if `value` cannot be read as JSON.
 */
export function formatMetricCell(metric: string, value: unknown): string;

/**
 * [`format_metric_value`](experiment_status::format_metric_value).
 */
export function formatMetricValue(metric: string, value: number): string;

/**
 * [`format_paper_citation`](cite_key::format_paper_citation) (TS `formatPaperCitation`):
 * resolve then format in one step.
 *
 * # Errors
 *
 * Fails if `paper.id` is not a string.
 */
export function formatPaperCitation(paper: { id: string; doi?: string; arxivId?: string; bibtex?: string; metadata?: Record<string, unknown> }, format: "latex" | "pandoc" | "footnote" | "raw"): string;

/**
 * [`format_quote_block`] for JS (TS `formatQuoteBlock`).
 *
 * # Errors
 *
 * Fails when `quote` is over the text cap.
 */
export function formatQuoteBlock(quote: string): string;

/**
 * [`format_quote_cite_clipboard`] for JS (TS `formatQuoteCiteClipboard`).
 *
 * # Errors
 *
 * Fails when `quote` is over the text cap.
 */
export function formatQuoteCiteClipboard(quote: string, paper_title: string): string;

/**
 * [`format_reference`](reference_text::format_reference).
 *
 * # Errors
 *
 * Fails when `paper` is not a paper.
 */
export function formatReference(paper: Omit<B.ReferencePaper, "authors"> & { authors: readonly string[] }): string;

/**
 * "Just now", "5m ago", "2h ago", "3d ago", or the date, relative to `now_iso`.
 */
export function formatRelative(input: string, now_iso: string, offset_minutes: number): string;

/**
 * [`format_words`](stats::format_words).
 */
export function formatWords(words: number): string;

/**
 * [`attempt_limits`]: `{ pdf, html }`, the caps on attempts per format.
 *
 * # Errors
 *
 * Fails if the result cannot be converted to a JS value.
 */
export function freeCopyAttemptLimits(): { pdf: number; html: number };

/**
 * [`wf_core::sync::blob_links::from_relative_blob_links_mapped`] for JS. `resolved`
 * is `{ "assets/<scope>/<path>": storagePath }`.
 *
 * # Errors
 *
 * Fails when `body` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units, or `resolved` is
 * not an object of strings.
 */
export function fromRelativeBlobLinks(body: string, resolved: Readonly<Record<string, string>>): string;

/**
 * [`frontmatter_list`](wf_core::sync::frontmatter::frontmatter_list) for JS: a list field
 * as its entries as text, or a non-blank scalar string as one entry.
 *
 * # Errors
 *
 * Fails when `frontmatter` is not an object.
 */
export function frontmatterList(frontmatter: Readonly<Record<string, unknown>>, key: string): string[];

/**
 * [`frontmatter_string`](wf_core::sync::frontmatter::frontmatter_string) for JS: the
 * field as text, or `undefined` when it is absent, a list, or blank.
 *
 * # Errors
 *
 * Fails when `frontmatter` is not an object.
 */
export function frontmatterString(frontmatter: Readonly<Record<string, unknown>>, key: string): string | undefined;

/**
 * [`full_image_thumbnail_path`](paper_image::full_image_thumbnail_path) (TS `PaperImageStore.remove`). The thumbnail, or `undefined`.
 */
export function fullImageThumbnailPath(path: string): string | undefined;

/**
 * [`furniture_key`].
 */
export function furnitureKey(s: string): string;

/**
 * [`furniture_lines`] (TS `furnitureLines`): one boolean per line, `true` for running heads
 * and folios.
 *
 * # Errors
 *
 * Fails if `lines` is not an array of text lines.
 */
export function furnitureLines(lines: readonly B.AnalysisTextLine[]): boolean[];

/**
 * [`wf_core::search::fusion::fuse_rankings`]: distinct ids, best fused rank first.
 * `k` defaults to [`RRF_K`]; `limit` of `None` or 0 means no limit.
 *
 * # Errors
 *
 * Fails if a list is malformed, the lists have more than `MAX_FUSION_IDS` ids
 * in total, or a weight is not finite and >= 0.
 */
export function fuseRankings(lists: any, k?: number | null, limit?: number | null): any;

/**
 * [`fuzziness_for_term`](search_tuning::fuzziness_for_term).
 */
export function fuzzinessForTerm(term: string): number;

/**
 * [`gate_vector_mask`](hybrid_fusion::gate_vector_mask) as a boolean array.
 *
 * # Errors
 *
 * Fails if `scores` is not an array of numbers.
 */
export function gateVectorMask(scores: readonly number[], floor: number, keep_top: number): boolean[];

/**
 * [`gemini_install`](mcp_client_config::gemini_install).
 */
export function geminiInstall(): string;

/**
 * [`get_user_integration_field`](integration_credentials::get_user_integration_field): a
 * provider field from the integrations bag or the legacy flat columns; `undefined` when empty.
 *
 * # Errors
 *
 * Fails if `settings` cannot be read as JSON or the requested field is not a string.
 */
export function getUserIntegrationField(settings: B.CredentialSettings, provider_id: string, field_id: string): string | undefined;

/**
 * [`basic_auth`](wf_core::sync::git_auth::basic_auth): base64 of `username:token`. An absent user name is `x-access-token`.
 */
export function gitBasicAuth(token: string, username?: string | null): string;

/**
 * [`git_connection`](fields::git_connection).
 *
 * # Errors
 *
 * Fails if `integration` has the wrong shape.
 */
export function gitConnection(integration: B.Integration): B.GitConnection;

/**
 * [`git_connection_ready`](fields::git_connection_ready).
 *
 * # Errors
 *
 * Fails if `integration` has the wrong shape.
 */
export function gitConnectionReady(integration: B.Integration): boolean;

/**
 * [`nul_list`](wf_core::sync::vault_git_parse::nul_list): the non-empty entries of a NUL-separated listing.
 *
 * # Errors
 *
 * Fails when the result cannot be converted to a JS value.
 */
export function gitNulList(stdout: string): string[];

/**
 * [`overwritten_files`](wf_core::sync::vault_git_parse::overwritten_files): the paths in a "would be overwritten" listing.
 *
 * # Errors
 *
 * Fails when the result cannot be converted to a JS value.
 */
export function gitOverwrittenFiles(output: string): string[];

/**
 * [`parse_log`](wf_core::sync::vault_git_parse::parse_log): `[{ oid, authoredAt, author, message }]`.
 *
 * # Errors
 *
 * Fails when the result cannot be converted to a JS value.
 */
export function gitParseLog(stdout: string): { oid: string; authoredAt: string; author: string; message: string }[];

/**
 * [`parse_status`](wf_core::sync::vault_git_parse::parse_status): `[{ path, state }]` from porcelain `-z` output.
 *
 * # Errors
 *
 * Fails when the result cannot be converted to a JS value.
 */
export function gitParseStatus(stdout: string): { path: string; state: "deleted" | "added" | "modified" }[];

/**
 * [`path_chunks`](wf_core::sync::vault_git_parse::path_chunks): batches of paths for one command line each.
 * `max_units` defaults to [`PATH_CHUNK_MAX_UNITS`](wf_core::sync::vault_git_parse::PATH_CHUNK_MAX_UNITS).
 *
 * # Errors
 *
 * Fails when `paths` is not an array of strings, or when the result cannot be converted to a JS value.
 */
export function gitPathChunks(paths: readonly string[], max_units?: number | null): string[][];

/**
 * [`git_read_failure_message`] for JS (TS `gitReadFailureMessage`).
 */
export function gitReadFailureMessage(status: number, body: string): string;

/**
 * [`git_read_plan`] for JS (TS `gitReadPlan`).
 *
 * # Errors
 *
 * Fails when `input` is not a git read input with the expected fields.
 */
export function gitReadPlan(input: B.GitReadInput): B.GitReadPlan;

/**
 * [`git_reason`](git_reason::git_reason): git's `fatal:`/`error:` lines from a failed command's text.
 */
export function gitReason(text: string): string;

/**
 * [`remote_auth`](wf_core::sync::git_auth::remote_auth): `{ flags, env }` for `{ url, token?, username? }`.
 *
 * # Errors
 *
 * Fails when `input` is not an object with a string `url`, or when the result cannot be converted to a JS value.
 */
export function gitRemoteAuth(input: { url: string; token?: string; username?: string }): { flags: string[]; env: Record<string, string> };

/**
 * [`git_status_state`](git_shim::git_status_state): `"added"`, `"deleted"`, `"modified"`, or
 * `undefined` for an unchanged `statusMatrix` row.
 */
export function gitStatusState(head: number, workdir: number): string | undefined;

/**
 * [`github_commits`] for JS (TS `githubCommits`).
 *
 * # Errors
 *
 * Fails when `items` is not a list of GitHub commits with the expected fields.
 */
export function githubCommits(items: B.GhCommit[]): B.GitCommit[];

/**
 * [`github_repo_pdf_path`] (TS `githubRepoPdfPath`): the repo-relative PDF path, or null.
 */
export function githubRepoPdfPath(given_pdf_path: string | null | undefined, paper_id: string): string | null;

/**
 * [`gitlab_combined_active`].
 *
 * # Errors
 *
 * Fails if `config` has the wrong shape, or the result cannot be converted to JS.
 */
export function gitlabCombinedActive(config: Omit<B.IntegrationConfig, "gitRead"> & { gitRead: readonly string[] }): boolean;

/**
 * [`gitlab_commits`] for JS (TS `gitlabCommits`).
 *
 * # Errors
 *
 * Fails when `items` is not a list of GitLab commits with the expected fields.
 */
export function gitlabCommits(items: B.GlCommit[]): B.GitCommit[];

/**
 * [`gitlab_log_file_plan`] for JS (TS `gitlabLogFilePlan`).
 *
 * # Errors
 *
 * Fails when `input` is not a GitLab log file input with the expected fields.
 */
export function gitlabLogFilePlan(input: B.GitlabLogFileInput): B.GitlabLogFilePlan;

/**
 * [`graph_degrees`](wiki_graph::graph_degrees): link count per node, for `SearchDoc.degree`.
 *
 * # Errors
 *
 * Fails if `graph` has the wrong shape.
 */
export function graphDegrees(graph: { nodes: string[]; edges: Map<string, string[]> }): Map<string, number>;

/**
 * [`graph_density`](wiki_graph::graph_density): node and edge counts, mean degree, largest
 * component share.
 *
 * # Errors
 *
 * Fails if `graph` has the wrong shape.
 */
export function graphDensity(graph: { nodes: string[]; edges: Map<string, string[]> }): B.GraphDensity;

/**
 * [`graph_filter_count`](graph_settings::graph_filter_count) for the selected tags and lists.
 *
 * # Errors
 *
 * Fails if `settings` has the wrong shape.
 */
export function graphFilterCount(selected_tags: string[], selected_lists: string[], settings: B.GraphViewSettings): number;

/**
 * [`graph_filter_count`](graph_settings::graph_filter_count), given the two selection sizes.
 *
 * # Errors
 *
 * Fails if `settings` has the wrong shape.
 */
export function graphFilterCountFor(selected_tags: number, selected_lists: number, settings: B.GraphViewSettings): number;

/**
 * [`graph_palette`](graph_colour::graph_palette): every fixed colour the graph draws.
 *
 * # Errors
 *
 * Fails only if the palette cannot be serialised.
 */
export function graphPalette(): { relation: Record<string, string>; readingStatus: Record<string, string>; note: string; paper: string; wikilink: string; report: string; experiment: string; experimentLink: string; uncoloured: string; rampGradient: string; cluster: string[] };

/**
 * [`graph_tag_names`](graph_tags::graph_tag_names): every filterable tag, sorted.
 *
 * # Errors
 *
 * Fails if `papers`, `notes` or `lists` has the wrong shape.
 */
export function graphTagNames(papers: readonly B.TaggedPaper[], notes: readonly B.TaggedNote[], lists: readonly B.NamedList[], include_lists: boolean): string[];

/**
 * [`graph_topology_key`](topology::graph_topology_key): what the simulation is laid out over; a
 * change to the returned key restarts it. `shown` is `{ nodes, links }` with `id` on each entry.
 *
 * # Errors
 *
 * Fails if `shown` has the wrong shape.
 */
export function graphTopologyKey(shown: { nodes: readonly { id: string }[]; links: readonly { id: string }[] }, local_seed: string | null, local_depth: number): string;

/**
 * [`group_by_day`] for JS (TS `groupByDay`): `{ day, indexes }[]`, newest day first.
 *
 * # Errors
 *
 * Fails when `entryDates` is not an array of strings.
 */
export function groupByDay(entry_dates: readonly string[]): B.LogDayGroup[];

/**
 * [`group_eligible`] for JS (TS `groupEligible`): whether a refused pull may land in a
 * table-wide group.
 *
 * # Errors
 *
 * Fails when `input` is not `{ deleted, uniqueClash, pendingOps }` with a whole `pendingOps`.
 */
export function groupEligible(input: { deleted: boolean; uniqueClash: boolean; pendingOps: number }): boolean;

/**
 * [`group_hunks`](panel_labels::group_hunks): unchanged and changed runs of a body diff.
 *
 * # Errors
 *
 * Fails if `lines` has the wrong shape, or the result cannot be serialised.
 */
export function groupHunks(lines: readonly B.DiffLine[]): B.HunkGroup[];

/**
 * [`group_palette_rows`](palette_groups::group_palette_rows): the headings present, each with the
 * indices of its rows, from the group of each row.
 *
 * # Errors
 *
 * Fails if `groups` has the wrong shape.
 */
export function groupPaletteRows(groups: readonly B.PaletteGroup[]): B.GroupedRows[];

/**
 * [`group_proposals`](proposal_groups::group_proposals). `items` is a list of objects with
 * `kind` and `resourceId`; `by` is `"document"` or `"kind"`; `knownIds` is an optional string
 * array. Returns `{ key, indices }[]`, with indices into `items`.
 *
 * # Errors
 *
 * Fails if an input cannot be read as the expected shape.
 */
export function groupProposals(items: readonly B.ProposalRef[], by: "document" | "kind", known_ids?: readonly string[]): B.ProposalGroup[];

/**
 * [`group_results`](quick::group_results) as an array of `{ kind, label, results }`.
 *
 * # Errors
 *
 * Fails if `results` is not an array of quick-open results.
 */
export function groupResults(results: readonly B.QuickOpenResult[]): B.QuickOpenGroup[];

/**
 * [`group_runs`](groups::group_runs).
 *
 * # Errors
 *
 * Fails if `leaf` has the wrong shape.
 */
export function groupRuns(leaf: B.PaneLeaf): B.TabRun[];

/**
 * [`group_subtree_items`]: the subtree's items grouped by list, in subtree order.
 */
export function groupSubtreeItems(node: B.ReadingListTreeNode, items: readonly B.ReadingListItem[]): B.SubtreeListItems[];

/**
 * [`grown_text_rect`]: a `[x1, y1, x2, y2]` rect grown to at least `height`.
 *
 * # Errors
 *
 * Fails if `rect` is not four numbers.
 */
export function grownTextRect(rect: readonly [number, number, number, number], height: number): [number, number, number, number];

/**
 * [`wf_core::storage::blob::guess_blob_content_type`]: MIME type for `path`
 * by its extension.
 *
 * # Errors
 *
 * Fails if `path` exceeds `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function guessBlobContentType(path: string): string;

/**
 * [`guess_title`](paper_drop::guess_title) (TS `guessTitle`).
 */
export function guessTitle(text: string): string | undefined;

/**
 * [`has_active_lab`](org::has_active_lab). `ownsActiveOrg` defaults to `false`.
 *
 * # Errors
 *
 * Fails if `memberships` has the wrong shape.
 */
export function hasActiveLab(active_org_id: string | null | undefined, memberships: readonly B.Membership[], owns_active_org?: boolean | null): boolean;

/**
 * [`wf_core::sync::text_diff::has_conflict_markers`] for JS.
 *
 * # Errors
 *
 * Fails when `text` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function hasConflictMarkers(text: string): boolean;

/**
 * [`rules::has_ink_view`].
 */
export function hasInkView(kind: string): boolean;

/**
 * [`rules::has_lazy_body`].
 */
export function hasLazyBody(kind: string): boolean;

/**
 * [`has_pdf_magic`]: whether the first bytes carry the `%PDF-` signature.
 */
export function hasPdfMagic(bytes: Uint8Array): boolean;

/**
 * [`rules::has_pdf_view`].
 */
export function hasPdfView(kind: string): boolean;

/**
 * [`has_results_tables`]: whether any section in the report tree, or a descendant, has an
 * `exptable:` reference.
 *
 * # Errors
 *
 * Fails if `nodes` has the wrong shape.
 */
export function hasResultsTables(nodes: readonly B.ResultsTablesTreeNode[]): boolean;

/**
 * [`has_text`] (TS `ModelConceptExtractor.extract` document filter).
 */
export function hasText(text?: string | null | undefined): boolean;

/**
 * [`heading_outline`] (TS `headingOutline`).
 *
 * # Errors
 *
 * Fails if `headings` is not an array of text lines.
 */
export function headingOutline(headings: readonly B.AnalysisTextLine[]): B.OutlineReaderItem[];

/**
 * [`heading_slug`](heading_slug::heading_slug): the anchor id for a heading.
 */
export function headingSlug(text: string): string;

/**
 * [`highlight_within_excerpt`](evidence::highlight_within_excerpt). `locus` is a PDF locus object or
 * `undefined`; the result is `{ before, match, after, confidence }`, or `null` when nothing matches.
 *
 * # Errors
 *
 * Fails if `locus` is not a PDF locus object, or the result cannot be converted.
 */
export function highlightWithinExcerpt(excerpt: string, locus: B.AnchorPdfLocus | undefined): B.ExcerptHighlight | null;

/**
 * [`highlights_digest`](reading_digest::highlights_digest) (TS `highlightsDigest`).
 *
 * # Errors
 *
 * Fails if `marks` is not a list of digest marks.
 */
export function highlightsDigest(marks: readonly B.DigestMark[], existing: string): string;

/**
 * [`home_config_path`](shell_paths::home_config_path): the home pointer file for a build variant.
 */
export function homeConfigPath(home: string, variant: string | null | undefined, sep: string): string;

/**
 * [`host_of`]: the host and port of a PDF address for a failure line, or the address when it has none.
 */
export function hostOf(url: string): string;

/**
 * [`HTML_FINAL_URL_HEADER`]: the response header naming the post-redirect address.
 */
export function htmlFinalUrlHeader(): string;

/**
 * [`HTML_PROXY_MAX_BYTES`]: the largest page the relay accepts, in bytes.
 */
export function htmlProxyMaxBytes(): number;

/**
 * [`HTML_PROXY_PATH`]: the relay route.
 */
export function htmlProxyPath(): string;

/**
 * `(HTTP 502 Bad Gateway from /api/x)`: the status line and the URL's path (`httpContext`).
 */
export function httpContext(url: string, status: number, status_text: string): string;

/**
 * [`http_status_for_kind`](error_status::http_status_for_kind): the HTTP status for an error kind.
 */
export function httpStatusForKind(kind: string): number;

/**
 * [`enum_label::humanise`]: `made_up_kind` reads `Made up kind`.
 */
export function humanise(value: string): string;

/**
 * [`humanize`](panel_labels::humanize): a field name as a label.
 */
export function humanize(field: string): string;

/**
 * [`hydrate_tab_modes`](pane::hydrate_tab_modes): stamp `mode_for(tab)` onto every tab that
 * has no mode yet. A tab that already carries a mode is left alone. Returns `layout` itself
 * when no tab lacks a mode.
 *
 * # Errors
 *
 * Fails if `layout` or a returned mode has the wrong shape, or rethrows what `mode_for` throws.
 */
export function hydrateTabModes(layout: B.PaneLayout, mode_for: (tab: B.TabRef) => B.DocumentMode): B.PaneLayout;

/**
 * [`hydrate_user_settings`](user_settings::hydrate_user_settings): merge the integrations bag
 * from the legacy columns when loading from persistence.
 *
 * # Errors
 *
 * Fails if `settings` cannot be read as JSON.
 */
export function hydrateUserSettings(settings: B.UserSettings): B.UserSettings;

/**
 * [`wf_core::sync::folder_layout::id_suffix`] for JS.
 *
 * # Errors
 *
 * Fails when `id` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function idSuffix(id: string): string;

/**
 * [`pglite_sql::ident`] (TS `ident`): a trimmed, double-quoted column name.
 *
 * # Errors
 *
 * Returns an error for a name the local database will not accept.
 */
export function ident(name: string): string;

/**
 * [`wf_core::sync::markdown_image::image_alt_from_filename`] for JS.
 *
 * # Errors
 *
 * Fails when `name` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function imageAltFromFilename(name?: string | null): string;

/**
 * [`wf_core::sync::markdown_image::image_extension_for_mime`] for JS.
 *
 * # Errors
 *
 * Fails when `mime` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function imageExtensionForMime(mime: string): string;

/**
 * [`wf_core::sync::markdown_image::image_paths_in_body`] for JS. The body is
 * always normalised with `normalize_markdown_image_syntax` first, as every
 * TS caller does; `prefix` is literal text, not a regex.
 *
 * # Errors
 *
 * Fails when `body` or `prefix` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function imagePathsInBody(body: string, prefix: string): string[];

/**
 * [`images_of`](paper_image::images_of) (TS `imagesOf`). `null` metadata has no images.
 *
 * # Errors
 *
 * Fails if `metadata` is not an object of JSON values.
 */
export function imagesOf(metadata: Record<string, unknown> | null | undefined): string[];

/**
 * [`import_relative_path`](import_links::import_relative_path). An empty `webkit_relative_path`
 * means unset.
 */
export function importRelativePath(webkit_relative_path: string, name: string): string;

/**
 * [`importable_entities`](folder_diff::importable_entities): the vault pages, and the files
 * whose note id is in `note_ids`, in input order.
 *
 * # Errors
 *
 * Fails if `entities` is not a list of parsed folder files, `note_ids` holds a non-string, or
 * the result cannot be serialized.
 */
export function importableEntities(entities: readonly B.ParsedEntity[], noteIds: ReadonlySet<string>): B.ParsedEntity[];

/**
 * [`pglite_sql::in_items`] (TS `inItems`): the pieces of an `in` list written as text.
 *
 * # Errors
 *
 * Returns an error if the result cannot be converted to JS.
 */
export function inItems(text: string): string[];

/**
 * [`in_reference_list`](analysis_citations::in_reference_list) (TS `inReferenceList`).
 *
 * # Errors
 *
 * Fails if `ranges` is not an array of page text ranges.
 */
export function inReferenceList(page: number, start: number, end: number, ranges: readonly B.AnalysisPageTextRange[]): boolean;

/**
 * [`account_menu::inbox_links`]: the Inbox rows as `{ key, label, path, icon, badge? }`.
 *
 * # Errors
 *
 * Fails if `input` is not an `InboxInput`-shaped object, or the result cannot be converted to JS.
 */
export function inboxLinks(input: B.InboxInput): B.InboxLink[];

/**
 * [`enum_label::incoming_relation_label`]: `cites` reads `Cited by`.
 */
export function incomingRelationLabel(relation: string): string;

/**
 * [`wf_core::search::tokenizer::index_terms`]: what MiniSearch indexes for `text`.
 *
 * # Errors
 *
 * Fails if `text` exceeds `MAX_INDEX_TEXT_UTF16` UTF-16 units, or if
 * `options` is not a valid `TokenizerOptions` object.
 */
export function indexTerms(text: string, options: B.TokenizerOptions): string[];

/**
 * [`indexTermsOf`]: the index terms of `text`, cut to the longest text the index accepts rather
 * than throwing. Rust `index_terms` with the search tokenizer defaults.
 */
export function indexTermsOf(text: string): string[];

/**
 * [`initial_phase`]: the phase before the first cycle.
 *
 * # Errors
 *
 * Fails if the result cannot be serialised.
 */
export function initialPhase(online: boolean): "idle" | "offline" | "error";

/**
 * [`initial_reader_viewport`] as `{ scale, fit, rotation, page }` (TS `initialReaderViewport`).
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 */
export function initialReaderViewport(page?: number | null): { scale: number; fit: B.ReaderFitMode; rotation: 0 | 90 | 180 | 270; page: number };

/**
 * [`palette_argb`] over the light theme: a default ink colour as `#aarrggbb`, for the
 * native shell's pen. Canvas drawing stays TS; this answers only the hex string.
 */
export function inkArgbHex(colour: string, alpha: number): string;

/**
 * [`ink_attachment_index`](ink_page::ink_attachment_index): the attachment index of `path`, or `0`.
 */
export function inkAttachmentIndex(body: string, path?: string | null | undefined): number;

/**
 * [`backing_ratio`]: the pixel ratio a canvas of the given CSS size is given.
 */
export function inkBackingRatio(css_width: number, css_height: number, device_pixel_ratio: number): number;

/**
 * [`band_union`](wf_core::ink::recognise::band_union) over flat `start, end` pairs: the
 * spanning `[start, end]`, or `null` when there are none.
 */
export function inkBandUnion(bands: Float64Array): [number, number] | null;

/**
 * [`bounds_contain`](page_buffer::bounds_contain): whether a point lies in a box.
 */
export function inkBoundsContain(bounds: Float64Array, x: number, y: number, slack: number): boolean;

/**
 * [`bounds_intersect`](page_buffer::bounds_intersect): whether two boxes touch or overlap.
 */
export function inkBoundsIntersect(a: Float64Array, b: Float64Array, slack: number): boolean;

/**
 * [`bounds_of`](page_buffer::bounds_of): the box over a stroke's parallel coordinates.
 */
export function inkBoundsOf(xs: Float32Array, ys: Float32Array): Float64Array;

/**
 * [`bounds_union`](page_buffer::bounds_union): the covering box. An empty `a` starts from `b`.
 */
export function inkBoundsUnion(a: Float64Array, b: Float64Array): Float64Array;

/**
 * [`ink_chunk_blob_key`](ink_paths::ink_chunk_blob_key): where a chunk sits in the blob bucket.
 *
 * # Errors
 *
 * Fails when `noteId` or `chunkId` is unusable.
 */
export function inkChunkBlobKey(user_id: string, note_id: string, chunk_id: string): string;

/**
 * [`ink_chunk_blob_spec`](ink_paths::ink_chunk_blob_spec): `{ bucket, contentType }`.
 */
export function inkChunkBlobSpec(): { bucket: string; contentType: string };

/**
 * [`ink_chunk_body_size`](chunk::ink_chunk_body_size): the body length a page would take.
 *
 * # Errors
 *
 * Fails on a body over `u32`, or a value that is not an `InkPage`.
 */
export function inkChunkBodySize(page: object): number;

/**
 * [`ink_chunk_header_bytes`](chunk::ink_chunk_header_bytes): the header for a payload.
 */
export function inkChunkHeaderBytes(body_size: number, payload_size: number, compressed: boolean): Uint8Array;

/**
 * [`chunk_id_of_file_name`](ink_paths::chunk_id_of_file_name): the chunk id a filename
 * names, or `null` when it is not `<chunk id>.inkb`.
 */
export function inkChunkIdOfFileName(name: string): string | null;

/**
 * [`ink_chunk_ids_in_listing`](ink_paths::ink_chunk_ids_in_listing): the sorted chunk ids among
 * the `paths` of a folder listing.
 *
 * # Errors
 *
 * Fails when `paths` is not an array of strings.
 */
export function inkChunkIdsInListing(paths: string[]): string[];

/**
 * [`ink_chunk_path`](ink_paths::ink_chunk_path).
 *
 * # Errors
 *
 * Fails when `chunkId` or `noteId` is unusable.
 */
export function inkChunkPath(note_id: string, chunk_id: string): string;

/**
 * [`INK_CHUNK_RAW_THRESHOLD`](chunk::INK_CHUNK_RAW_THRESHOLD): the body size below which a chunk is stored raw.
 */
export function inkChunkRawThreshold(): number;

/**
 * [`should_try_compress`](chunk::should_try_compress): whether the codec runs on a body this size.
 */
export function inkChunkShouldTryCompress(body_len: number): boolean;

/**
 * [`stores_compressed`](chunk::stores_compressed): whether the packed payload is stored.
 */
export function inkChunkStoresCompressed(body_len: number, packed_len: number): boolean;

/**
 * [`clamp_background_index`](page_buffer::clamp_background_index): the header byte for an attachment index.
 */
export function inkClampBackgroundIndex(index: number): number;

/**
 * The ink tuning constants as one object.
 *
 * # Errors
 *
 * Fails only if the object cannot be serialised.
 */
export function inkConstants(): B.InkConstants;

/**
 * The contact-area constants: `{ cssPxPerMm, palmContactAreaMm2 }`, read once by the palm gate.
 *
 * # Errors
 *
 * Fails only if the result object cannot be written.
 */
export function inkContactConsts(): { cssPxPerMm: number; palmContactAreaMm2: number };

/**
 * [`ink_curve_at`] as `{ x, y }`. A span past the end gives `{ x: NaN, y: NaN }`,
 * as the TS copy's out-of-range reads do.
 *
 * # Errors
 *
 * Fails only if the point cannot be converted to a JS value.
 */
export function inkCurveAt(xs: ArrayLike<number>, ys: ArrayLike<number>, i: number, u: number): { x: number; y: number };

/**
 * [`ink_engine_info`](ink_engine::ink_engine_info): the engine's declared facts, or
 * `null` for an unknown id.
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 */
export function inkEngineInfo(id: string): { id: string; offline: boolean; online: boolean; platform: string } | null;

/**
 * [`ink_engine_rank`](ink_engine::ink_engine_rank): the engine's preference rank, or the
 * engine count for an unknown id.
 */
export function inkEngineRank(id: string): number;

/**
 * [`ink_enum_index`](ink_page::ink_enum_index): the position of `value` in `values`, or `0`.
 *
 * # Errors
 *
 * Fails if `values` is not an array of strings.
 */
export function inkEnumIndex(values: readonly string[], value: string): number;

/**
 * [`ink_enum_value`](ink_page::ink_enum_value): the name at `index`, or the first entry
 * where out of range; `undefined` for an empty list.
 *
 * # Errors
 *
 * Fails if `values` is not an array of strings.
 */
export function inkEnumValue(values: readonly string[], index: number): string;

/**
 * [`flat_stroke_samples`](native_stroke::flat_stroke_samples): `[x, y, pressure, t, …]`
 * view pixels in, `x, y, pressure, t` quadruples in CSS pixels out. Takes `Float64Array`
 * because `t` is the device uptime in ms, which `Float32Array` would round.
 */
export function inkFlatStrokeSamples(points: Float64Array, dpr: number): Float64Array;

/**
 * [`ink_haptics_on`](prefs::ink_haptics_on): whether ink haptics are on for a saved value.
 */
export function inkHapticsOn(raw?: string | null): boolean;

/**
 * [`is_page_source`](page_background::is_page_source): whether a file can be a page background.
 */
export function inkIsPageSource(mime: string, name: string): boolean;

/**
 * [`is_pdf`](page_background::is_pdf): whether a file's MIME type or name marks it a PDF.
 */
export function inkIsPdf(mime: string, name: string): boolean;

/**
 * [`kept_indices`](page_buffer::kept_indices): the old index of each live stroke, in order.
 */
export function inkKeptIndices(alive: Uint8Array): Uint32Array;

/**
 * [`lasso_keeps`](hit_test::lasso_keeps): whether a lasso polygon keeps a stroke (half its points inside).
 */
export function inkLassoKeeps(xs: Float32Array, ys: Float32Array, polygon: Float64Array): boolean;

/**
 * [`helper_line`]: one Windows Ink helper line as `{ text, conf, alternatives? }`.
 *
 * # Errors
 *
 * Fails if `line` is not a helper line or `vocabulary` not an array of strings.
 */
export function inkLineFromHelper(line: { text: string; confidence: number; words?: readonly { candidates: readonly string[]; known?: readonly boolean[] | null; join?: string | null }[] | null; alternatives?: readonly string[] | null }, vocabulary: readonly string[]): { text: string; conf: number; alternatives?: string[] };

/**
 * [`ink_line_records`]: `counts[i]` strokes per line, `bands` as flat
 * `yMin, yMax` pairs, `recognised` an array of `{ text, confidence }` or
 * undefined per line (default `[]`).
 *
 * # Errors
 *
 * Fails if `recognised` is not such an array.
 */
export function inkLineRecords(counts: Uint32Array, bands: Float64Array, recognised?: readonly ({ text: string; confidence: number } | undefined)[]): B.InkLineRecord[];

/**
 * [`ink_line_strokes`](ink_engine::ink_line_strokes): the strokes of one line, given
 * the line record `{ strokeStart, strokeCount, ... }`. The caller's own stroke objects come
 * back in a new array.
 *
 * # Errors
 *
 * Fails if `line` lacks `strokeStart` / `strokeCount`.
 */
export function inkLineStrokes(strokes: readonly T.ReadonlyInkStroke[], line: { strokeStart: number; strokeCount: number }): B.InkStroke[];

/**
 * [`ink_note_width_to_pdf_points`].
 */
export function inkNoteWidthToPdfPoints(tenths: number): number;

/**
 * [`ink_page_background`](ink_page::ink_page_background): the background path, or `null`.
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 */
export function inkPageBackground(text: string): string | null;

/**
 * [`page_bounds`](page_buffer::page_bounds): the page's box. `boxes` is four numbers per
 * stroke, and `live[i]` is 0 for a dead stroke or one with no points.
 */
export function inkPageBounds(boxes: Float64Array, live: Uint8Array): Float64Array;

/**
 * [`ink_page_confidence`] over the lines' `conf` values.
 *
 * # Errors
 *
 * Throws as the JS read `line.conf` would on a non-object line.
 */
export function inkPageConfidence(lines: readonly { conf: number }[]): number;

/**
 * [`ink_page_figures`](figure::ink_page_figures): the figures a page's text places, in line
 * order. A missing crop has no `crop` key.
 *
 * # Errors
 *
 * Fails if `text` is longer than the index text limit.
 */
export function inkPageFigures(text: string): B.FigurePlacement[];

/**
 * [`ink_page_marker`](ink_page::ink_page_marker): the `<!-- page N -->` line for page `page`.
 */
export function inkPageMarker(page: number): string;

/**
 * [`ink_page_over_budget`](ink_page::ink_page_over_budget): whether the page has too many strokes.
 *
 * # Errors
 *
 * Fails if `page` has the wrong shape.
 */
export function inkPageOverBudget(page: { strokes: readonly unknown[] }): boolean;

/**
 * [`page_scissor`](page_scissor::page_scissor): the page's `[x, y, width, height]` scissor
 * box on a device-pixel surface. `view` is the view's `scale` and `offsetX`/`offsetY` in
 * CSS px; `page` and `surface` are sizes.
 *
 * # Errors
 *
 * Throws if `view`, `page` or `surface` cannot be read.
 */
export function inkPageScissor(view: { scale: number; offsetX: number; offsetY: number }, dpr: number, page: { width: number; height: number }, surface: { width: number; height: number }): [number, number, number, number];

/**
 * [`ink_page_summary`] over `{ text, conf }` lines: `{ text, confidence, unsure }`.
 *
 * # Errors
 *
 * Fails if `lines` is not an array of `{ text: string, conf: number }`.
 */
export function inkPageSummary(lines: readonly { text: string; conf: number }[]): { text: string; confidence: number; unsure: number };

/**
 * [`ink_page_svg`]: the page as an SVG document; `options` defaults to `{}`.
 *
 * # Errors
 *
 * Fails if `page` or `options` does not match its shape.
 */
export function inkPageSvg(page: B.InkSvgPage, options?: B.InkSvgOptions): string;

/**
 * [`ink_path_json_size`].
 */
export function inkPathJsonSize(path: readonly number[]): number;

/**
 * [`ink_paths_bounds`]; `[x1, y1, x2, y2]` or `null`.
 */
export function inkPathsBounds(paths: readonly (readonly number[])[]): [number, number, number, number] | null;

/**
 * [`ink_paths_hit_test`]; `paths` is an array of number arrays.
 */
export function inkPathsHitTest(paths: readonly (readonly number[])[], x: number, y: number, radius: number): boolean;

/**
 * [`ink_paths_in_polygon`]: whether a loop has caught a stroke, at least `share` of its points
 * inside. `paths` is one flat `x, y` array per path; `share` defaults to [`LASSO_CAUGHT_SHARE`].
 *
 * # Errors
 *
 * Fails if `paths` is not an array of number arrays.
 */
export function inkPathsInPolygon(paths: readonly (readonly number[])[], polygon: readonly number[], share?: number | null): boolean;

/**
 * [`pen_pressure_byte`](worker_route::pen_pressure_byte): a 0 to 1 pen pressure as a page byte.
 */
export function inkPenPressureByte(pressure: number): number;

/**
 * [`pick_candidates`](stroke_index::pick_candidates): the R-tree candidates that are
 * alive and meet the query box. `bounds` is four numbers per candidate, `alive` one
 * byte per candidate, and `query` is `[minX, minY, maxX, maxY]`.
 */
export function inkPickCandidates(indices: Uint32Array, alive: Uint8Array, bounds: Float64Array, query: Float64Array, slack: number): Uint32Array;

/**
 * [`point_in_polygon`](hit_test::point_in_polygon) over a flat `x,y` array.
 *
 * # Errors
 *
 * Fails if `polygon` is not an array of numbers.
 */
export function inkPointInPolygon(px: number, py: number, polygon: readonly number[]): boolean;

/**
 * [`polygon_bounds`](hit_test::polygon_bounds): `[minX, minY, maxX, maxY]` of a flat `x,y` polygon.
 */
export function inkPolygonBounds(polygon: Float64Array): Float64Array;

/**
 * [`position_options`](one_euro::position_options) as `{ minCutoff, beta, derivativeCutoff }`.
 * Read at call time, so no app module holds a copy of the tuning.
 */
export function inkPositionOptions(): B.OneEuroOptions;

/**
 * [`ink_pressure_factor`].
 */
export function inkPressureFactor(pressure?: number | null): number;

/**
 * [`pressure_options`](one_euro::pressure_options) as `{ minCutoff, beta, derivativeCutoff }`.
 */
export function inkPressureOptions(): B.OneEuroOptions;

/**
 * [`ink_print_document`]: the page as an HTML document for a print frame's `srcdoc`.
 */
export function inkPrintDocument(doc: B.InkPrintDocument): string;

/**
 * [`ink_sidecar_dir`](ink_paths::ink_sidecar_dir).
 *
 * # Errors
 *
 * Fails when `noteId` is not a safe id.
 */
export function inkSidecarDir(note_id: string): string;

/**
 * The y band `[min, max]` of a stroke's points, or `null` for a stroke with no
 * finite y ([`ink_stroke_band`](wf_core::ink::segment::ink_stroke_band)).
 *
 * # Errors
 *
 * Throws as the JS read `stroke.points` would on a non-object.
 */
export function inkStrokeBand(stroke: { points: ArrayLike<number> }): [number, number] | null;

/**
 * [`ink_stroke_band`](wf_core::ink::segment::ink_stroke_band): `[yMin, yMax]` over a
 * stroke's flat x,y points, or `undefined` when no y is finite.
 */
export function inkStrokeBandOf(points: Float64Array): Float64Array | undefined;

/**
 * [`stroke_history_step`]: `stacks` is `{ history, redone }`, `op` is
 * `{ op: "record", step } | { op: "undo" } | { op: "redo" }`. Gives
 * `{ stacks, action }`, where `action` is `{ op: "restore" | "erase" | "translate", indices, dx?, dy? }` or `null`.
 *
 * # Errors
 *
 * Fails if the stacks or the request do not have the expected shape.
 */
export function inkStrokeHistoryStep(stacks: { history: ({ kind: "erase" | "draw"; indices: number[] } | { kind: "move"; indices: number[]; dx: number; dy: number })[]; redone: ({ kind: "erase" | "draw"; indices: number[] } | { kind: "move"; indices: number[]; dx: number; dy: number })[] }, op: { op: "record"; step: ({ kind: "erase" | "draw"; indices: number[] } | { kind: "move"; indices: number[]; dx: number; dy: number }) } | { op: "undo" } | { op: "redo" }): { stacks: { history: ({ kind: "erase" | "draw"; indices: number[] } | { kind: "move"; indices: number[]; dx: number; dy: number })[]; redone: ({ kind: "erase" | "draw"; indices: number[] } | { kind: "move"; indices: number[]; dx: number; dy: number })[] }; action: { op: "restore" | "erase" | "translate"; indices: number[]; dx?: number; dy?: number } | null };

/**
 * [`stroke_instance_count`]: the instances a stroke of `points` samples packs to.
 */
export function inkStrokeInstanceCount(points: number): number;

/**
 * [`stroke_near_segment`](hit_test::stroke_near_segment): whether a stroke passes within `radius` of a swept segment.
 */
export function inkStrokeNearSegment(xs: Float32Array, ys: Float32Array, fx: number, fy: number, tx: number, ty: number, radius: number): boolean;

/**
 * [`stroke_pressures`](page_buffer::stroke_pressures): one pressure byte per point, for
 * `count` points read from the reported `pressures` (a missing or NaN entry is 0).
 */
export function inkStrokePressures(pressures: Float64Array, count: number): Uint8Array;

/**
 * [`ink_tangent_at`] as `{ x, y }`; `side` is `"in"` or `"out"` (default
 * `"out"`; anything else is `"out"`). An index past the end gives `{ x: 0, y: 0 }`.
 *
 * # Errors
 *
 * Fails only if the point cannot be converted to a JS value.
 */
export function inkTangentAt(xs: ArrayLike<number>, ys: ArrayLike<number>, i: number, side: "in" | "out"): { x: number; y: number };

/**
 * [`trail_alpha`](trail::trail_alpha): the trail's opacity for a tool (translucent for a highlighter).
 */
export function inkTrailAlpha(tool: string): number;

/**
 * [`INK_UNSURE_CONFIDENCE`], read at call time.
 */
export function inkUnsureConfidence(): number;

/**
 * [`ink_velocity_between`].
 */
export function inkVelocityBetween(x0: number, y0: number, t0: number, x1: number, y1: number, t1: number): number;

/**
 * [`ink_velocity_factor`]; `fullTaper` defaults to `INK_VELOCITY_FULL_TAPER`.
 */
export function inkVelocityFactor(velocity: number, full_taper?: number | null): number;

/**
 * [`ink_vocabulary_hints`]; `limit` defaults to 500.
 *
 * # Errors
 *
 * Fails if `sources` is not an array of string arrays.
 */
export function inkVocabularyHints(sources: readonly (readonly string[])[], limit?: number | null): string[];

/**
 * The words a recogniser vocabulary allows, in order
 * ([`ink_vocabulary_words`](wf_core::ink::decode::ink_vocabulary_words), sorted).
 *
 * # Errors
 *
 * Fails if `vocabulary` is not an array of strings.
 */
export function inkVocabularyWordList(vocabulary: readonly string[]): string[];

/**
 * The words a recogniser vocabulary allows, as a `Set` (in sorted insertion order).
 *
 * # Errors
 *
 * Fails if `vocabulary` is not an array of strings.
 */
export function inkVocabularyWords(vocabulary: readonly string[]): Set<string>;

/**
 * [`ink_width_for_pressure`]; `base` defaults to `INK_DEFAULT_WIDTH`.
 */
export function inkWidthForPressure(pressure?: number | null, base?: number | null): number;

/**
 * [`ink_worker_route`](worker_route::ink_worker_route): the handler a worker message runs.
 */
export function inkWorkerRoute(input: { type: string; state: { liveStrokeId: number | null; pageIndex: number }; strokeId?: number | null; pageIndex?: number; predicted?: boolean }): { action: string; predicted: boolean };

/**
 * [`ink_zoom_in`].
 */
export function inkZoomIn(zoom: number): number;

/**
 * [`ink_zoom_out`].
 */
export function inkZoomOut(zoom: number): number;

/**
 * [`integrations_bag_from_legacy`](integration_credentials::integrations_bag_from_legacy);
 * `undefined` when no legacy field is set.
 *
 * # Errors
 *
 * Fails if `settings` cannot be read as JSON.
 */
export function integrationsBagFromLegacy(settings: B.CredentialSettings): Record<string, Record<string, string>> | undefined;

/**
 * [`cache_invalidation::invalidation_map`]: one entry per resource type.
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 */
export function invalidationMap(): B.InvalidationEntry[];

/**
 * [`cache_invalidation::plan`] for the resource type named `resource_type`, or `undefined` for an
 * unknown name.
 *
 * # Errors
 *
 * Fails if `resource_type` exceeds `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function invalidationPlan(resource_type: string): any;

/**
 * [`inverted_abstract`](related_paper_hit::inverted_abstract): the abstract text, or `undefined`.
 *
 * # Errors
 *
 * Fails if `index` is neither an object nor missing.
 */
export function invertedAbstract(index: unknown): string | undefined;

/**
 * [`is_absolute_entry`](experiment_artifacts::is_absolute_entry).
 */
export function isAbsoluteEntry(entry: string): boolean;

/**
 * [`is_absolute_url`](experiment_artifacts::is_absolute_url).
 */
export function isAbsoluteUrl(value: string): boolean;

/**
 * [`is_all_pages`](pdf_pages::is_all_pages).
 */
export function isAllPages(answer: string): boolean;

/**
 * [`is_allowed_pdf_proxy_url`]: https, no credentials, and an allowlisted host.
 */
export function isAllowedPdfProxyUrl(raw: string): boolean;

/**
 * [`is_annotation_sync_state`] for any JS value: false unless `value` is a string.
 */
export function isAnnotationSyncState(value: string): boolean;

/**
 * [`is_api_host`](api_host::is_api_host): the URL's host is `weaveforge.org` or a subdomain of it.
 */
export function isApiHost(url: string): boolean;

/**
 * [`wf_core::sync::json_entities::is_app_owned_path`] for JS.
 *
 * # Errors
 *
 * Fails when `path` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function isAppOwnedPath(path: string): boolean;

/**
 * [`is_app_storage_key`](storage_keys::is_app_storage_key): whether a browser storage key holds
 * account or workspace state, so sign-out wipes it.
 */
export function isAppStorageKey(key: string): boolean;

/**
 * [`is_bare_url`] for JS: whether `text` is one http(s) address (TS `BARE_URL.test`).
 */
export function isBareUrl(text: string): boolean;

/**
 * [`is_bib_file`](paper_drop::is_bib_file) (TS `isBibFile`).
 */
export function isBibFile(name: string): boolean;

/**
 * [`is_bibliographic_match`](analysis_text::is_bibliographic_match) (TS `isBibliographicMatch`).
 *
 * # Errors
 *
 * Fails if `hints` or `candidate` is not an object of the expected shape.
 */
export function isBibliographicMatch(hints: { title?: string | null; year?: number | null }, candidate: { title: string; year?: number | null }): boolean;

/**
 * [`is_blank_query`](semantic_hits::is_blank_query): whether a query has nothing to search for.
 */
export function isBlankQuery(query: string): boolean;

/**
 * [`is_blanket_share`](sharing::is_blanket_share); `null` or `undefined` means every resource.
 */
export function isBlanketShare(resource_id?: string | null | undefined): boolean;

/**
 * [`is_bold_font`]; `fontName` may be undefined.
 */
export function isBoldFont(font_name?: string | null): boolean;

/**
 * [`local_first_route::is_both_ends_rpc`].
 */
export function isBothEndsRpc(name: string): boolean;

/**
 * [`is_cache_pdf_url`]: whether `url` is a `cache://` reference.
 */
export function isCachePdfUrl(url: string): boolean;

/**
 * [`is_caught_up`]: whether a pass ran to the end with no more pages to pull.
 */
export function isCaughtUp(stopped_because: string | null | undefined, pulled_more: boolean): boolean;

/**
 * [`is_citation_destination`] (TS `isCitationDestination`). `name` is optional.
 */
export function isCitationDestination(name?: string | null): boolean;

/**
 * [`is_commit_enter`](commit_enter::is_commit_enter): Enter outside an IME composition.
 */
export function isCommitEnter(key: string, key_code: number | null | undefined, is_composing: boolean): boolean;

/**
 * [`is_conference_copy`] (TS `isConferenceCopy`).
 *
 * # Errors
 *
 * Fails if `paper` is not a paper summary.
 */
export function isConferenceCopy(paper: B.TidyPaper): boolean;

/**
 * [`rules::is_creatable_kind`].
 */
export function isCreatableKind(kind: string): boolean;

/**
 * [`is_dismiss_tap`]: `down` and `up` are `{ x, y, time }`; `down` may be `null`.
 *
 * # Errors
 *
 * Fails if `down` or `up` is not a press object of numbers.
 */
export function isDismissTap(down: B.PagePress | null, up: B.PagePress, bar_open: boolean): boolean;

/**
 * [`rules::is_document_kind`].
 */
export function isDocumentKind(kind: string): boolean;

/**
 * [`is_document_node`](tree::is_document_node).
 *
 * # Errors
 *
 * Fails if `node` has the wrong shape.
 */
export function isDocumentNode(node: Pick<B.WorkspaceTreeNode, "kind" | "folder">): boolean;

/**
 * [`is_edit_command`](edit_menu::is_edit_command): paste or an execCommand edit command.
 */
export function isEditCommand(command: string): boolean;

/**
 * [`is_editable_reader_target`]: whether an event target owns its keystrokes (a text
 * field, a select or its option, or anything contenteditable). A falsy target never does;
 * `tagName` counts only when it is a string.
 */
export function isEditableReaderTarget(target: EventTarget | { tagName?: unknown; isContentEditable?: unknown } | null | undefined): boolean;

/**
 * [`is_electron_entry`](mcp_config_rewrite::is_electron_entry): an entry the Electron app wrote.
 */
export function isElectronMcpEntry(entry: unknown): boolean;

/**
 * [`is_empty_paper_summary`](paper::is_empty_paper_summary) (TS `isEmptyPaperSummary`).
 */
export function isEmptyPaperSummary(summary?: string | null | undefined): boolean;

/**
 * [`is_explicit_lab_membership`](org::is_explicit_lab_membership).
 *
 * # Errors
 *
 * Fails if `membership` has the wrong shape.
 */
export function isExplicitLabMembership(membership: B.Membership): boolean;

/**
 * [`is_folder_draft_path`](folder_draft::is_folder_draft_path): whether a file name is a draft.
 */
export function isFolderDraftPath(path: string): boolean;

/**
 * [`is_highlighter_ink`]; `undefined` is `None`.
 */
export function isHighlighterInk(width?: number | null): boolean;

/**
 * [`is_html_content_type`]: whether a response counts as a web page.
 */
export function isHtmlContentType(value?: string | null): boolean;

/**
 * [`is_https_address`](paper_update::is_https_address) (TS `setPdfSource`): whether the address is https.
 */
export function isHttpsAddress(url: string): boolean;

/**
 * [`is_hydrated_page`](page_text::is_hydrated_page): the page has a body and no preview stands in.
 * Never fails: the caller checks [`text_within_cap_js`] first and falls back to TS above the cap.
 */
export function isHydratedPage(body?: string | null, body_preview?: string | null): boolean;

/**
 * [`is_inherited_link_code`]: whether a database error code means only the inherited link failed.
 */
export function isInheritedLinkCode(code?: string | null | undefined): boolean;

/**
 * [`wf_core::sync::ink_note::is_ink_chunk_id`] for JS.
 *
 * # Errors
 *
 * Fails when `text` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function isInkChunkId(text: string): boolean;

/**
 * [`is_ink_engine_id`](ink_engine::is_ink_engine_id).
 */
export function isInkEngineId(id: string): boolean;

/**
 * [`wf_core::sync::ink_note::is_ink_note_body`] for JS.
 *
 * # Errors
 *
 * Fails when `body` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function isInkNoteBody(body: string): boolean;

/**
 * [`is_ink_note_frontmatter`](ink_note::is_ink_note_frontmatter).
 *
 * # Errors
 *
 * Fails if `frontmatter` is not an object.
 */
export function isInkNoteFrontmatter(frontmatter: Record<string, unknown>): boolean;

/**
 * [`is_ink_note_id`](ink_paths::is_ink_note_id).
 */
export function isInkNoteId(id: string): boolean;

/**
 * [`is_ink_tool`]: `ink` and `highlighter` draw on the page.
 */
export function isInkTool(tool: string): boolean;

/**
 * [`is_ip_address`](url_safety::is_ip_address).
 */
export function isIpAddress(value: string): boolean;

/**
 * [`is_iso_day`](milestone::is_iso_day).
 */
export function isIsoDay(value: string): boolean;

/**
 * [`cache_invalidation::is_known_resource_type`]: whether `value` names a resource type.
 */
export function isKnownResourceType(value: string): boolean;

/**
 * [`is_large_corpus`](search_document::is_large_corpus).
 */
export function isLargeCorpus(documents: number): boolean;

/**
 * [`is_legacy_token_hex`](local_api_guard::is_legacy_token_hex): whether a stored token is a legacy plaintext one.
 */
export function isLegacyTokenHex(stored: string): boolean;

/**
 * [`is_library_listing_fresh`]: whether a library listing taken at `listedAt` still answers at `now`.
 */
export function isLibraryListingFresh(listed_at: number, now: number): boolean;

/**
 * [`pglite_sql::is_literal`] (TS `isLiteral`): `null`, `true` or `false`.
 *
 * # Errors
 *
 * Returns an error for any other operand.
 */
export function isLiteral(text: string): string;

/**
 * [`is_local_zotero_url`]: whether `url` is the local Zotero API's own path with no credentials.
 */
export function isLocalZoteroUrl(url: string): boolean;

/**
 * [`is_loopback_host`](local_api_guard::is_loopback_host): whether a `Host` header is this machine on `port`.
 */
export function isLoopbackHost(host: string | null | undefined, port: number): boolean;

/**
 * [`is_markdown_file`](import_links::is_markdown_file).
 */
export function isMarkdownFile(name: string): boolean;

/**
 * [`is_missing_service_role`](org::is_missing_service_role).
 */
export function isMissingServiceRole(message: string): boolean;

/**
 * [`wf_core::error_report::network_failure::is_network_failure`] for JS.
 *
 * # Errors
 *
 * Fails when `message` is over the text cap.
 */
export function isNetworkFailure(message: string): boolean;

/**
 * Whether a thrown value is a request that never reached a server (`isNetworkFailureValue`).
 */
export function isNetworkFailureValue(err: unknown): boolean;

/**
 * [`is_newer`]: whether `candidate` is later than `current`, both `[major, minor, patch]`.
 *
 * # Errors
 *
 * Fails if either argument is not three numbers.
 */
export function isNewerVersion(candidate: [number, number, number], current: [number, number, number]): boolean;

/**
 * [`is_note_import_file`](import_links::is_note_import_file).
 */
export function isNoteImportFile(name: string): boolean;

/**
 * [`is_on_sampling_grid`](experiments::is_on_sampling_grid).
 */
export function isOnSamplingGrid(step: number): boolean;

/**
 * [`is_valid_project_id`](overleaf::is_valid_project_id).
 */
export function isOverleafProjectId(id: string): boolean;

/**
 * [`is_text_source_file`](path_guard::is_text_source_file): whether the reader keeps this file name.
 */
export function isOverleafTextSource(name: string): boolean;

/**
 * [`is_paper_field_kind`](paper_field::is_paper_field_kind) (TS `isPaperFieldKind`).
 */
export function isPaperFieldKind(value: string): boolean;

/**
 * [`is_html_content_type`](paste_content::is_html_content_type): a body a title can be read from.
 */
export function isPasteHtmlContentType(content_type: string): boolean;

/**
 * [`is_pdf_content_type`]: whether a `Content-Type` value names a PDF. `null` or empty is not.
 */
export function isPdfContentType(value?: string | null): boolean;

/**
 * [`is_pdf_file`](paper_drop::is_pdf_file) (TS `isPdfFile`).
 */
export function isPdfFile(name: string, mime_type: string): boolean;

/**
 * [`is_pdf_too_large`](paper_drop::is_pdf_too_large) (TS `isPdfTooLarge`).
 */
export function isPdfTooLarge(size_bytes: number): boolean;

/**
 * [`is_pen_barrel_pointer`](pen_pointer::is_pen_barrel_pointer): whether a pen touched
 * down with its barrel button held.
 */
export function isPenBarrelPointer(pointer_type: string, button?: number | null, buttons?: number | null): boolean;

/**
 * [`is_pen_eraser_pointer`](pen_pointer::is_pen_eraser_pointer): whether a pointer
 * event is the pen's eraser end.
 */
export function isPenEraserPointer(pointer_type: string, button?: number | null, buttons?: number | null): boolean;

/**
 * [`is_placeholder_title`](paper_title::is_placeholder_title) (TS `isPlaceholderTitle`).
 */
export function isPlaceholderTitle(title?: string | null | undefined): boolean;

/**
 * [`is_plain_click`] (TS `isPlainClick`): a plain left click that a link would follow in this
 * window.
 */
export function isPlainClick(e: { button: number; defaultPrevented: boolean; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }): boolean;

/**
 * [`is_preview_key`](palette_sort::is_preview_key): whether a key press opens the preview.
 *
 * # Errors
 *
 * Fails if `event` has the wrong shape.
 */
export function isPreviewKey(event: B.PaletteKey, in_text_box: boolean): boolean;

/**
 * True for the preview tab, which is one tab not tied to a document.
 */
export function isPreviewTab(tab: B.TabRef | undefined): boolean;

/**
 * [`is_private_host`](private_host::is_private_host): a host this machine or its network answers for.
 */
export function isPrivateHost(hostname: string): boolean;

/**
 * [`is_public_address`](url_safety::is_public_address).
 */
export function isPublicAddress(address: string): boolean;

/**
 * [`is_public_https_url`](private_host::is_public_https_url): https, no credentials, public host.
 * `false` for text that does not parse, as the TS `catch` did.
 */
export function isPublicHttpsUrl(raw: string): boolean;

/**
 * [`is_quotation_type`](annotation_quotation_type::is_quotation_type) (TS `isQuotationType`).
 */
export function isQuotationType(value: string): boolean;

/**
 * [`is_reader_annotation_type`] for any JS value: false unless `value` is a string.
 */
export function isReaderAnnotationType(value: string): boolean;

/**
 * [`is_reader_object_url`]: whether `raw` is a `blob:` URL minted by `origin`.
 */
export function isReaderObjectUrl(raw?: string | null | undefined, origin?: string | null | undefined): boolean;

/**
 * [`is_recent_target`] (TS `isRecentTarget`): a stored value with string `kind` and `id`.
 * Anything that does not deserialize as JSON is not a target.
 */
export function isRecentTarget(value: unknown): boolean;

/**
 * [`is_cache_entry_fresh`]: whether a lookup stamped at `storedAt` still answers at `now`.
 */
export function isReferenceCacheEntryFresh(stored_at: number, now: number): boolean;

/**
 * [`is_remote_pdf_url`]: whether `url` is an http(s) address or a same-origin path.
 */
export function isRemotePdfUrl(url: string): boolean;

/**
 * [`is_rotated_text`](analysis_outline::is_rotated_text) (TS `isRotatedText`).
 */
export function isRotatedText(transform: readonly number[]): boolean;

/**
 * [`wf_core::workspace::is_safe_workspace_path`] for JS.
 *
 * # Errors
 *
 * Fails when `path` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function isSafeWorkspacePath(path: string): boolean;

/**
 * [`is_search_file`](vault_search::is_search_file): whether the search reads this file.
 */
export function isSearchFile(path: string): boolean;

/**
 * [`is_secret_name`](secret_names::is_secret_name): whether `name` is a secret the app stores.
 */
export function isSecretName(name: string): boolean;

/**
 * [`is_open`](state::is_open): whether section `id` is open in `sections`.
 *
 * # Errors
 *
 * Fails if `sections.open` does not hold only strings.
 */
export function isSectionOpen(sections: { open: ReadonlySet<string> }, id: string): boolean;

/**
 * [`is_settled`](panel_labels::is_settled): whether a field's choice is complete.
 *
 * # Errors
 *
 * Fails if `choice` has the wrong shape.
 */
export function isSettled(choice: B.PanelChoice | undefined, ours: string, theirs: string): boolean;

/**
 * [`is_signed_out_refusal`] (TS `isSignedOutRefusal`): true when a refusal means "sign in".
 */
export function isSignedOutRefusal(message: string, code?: string | null): boolean;

/**
 * [`is_skipped_dir`](vault_search::is_skipped_dir): whether the walk skips this directory.
 */
export function isSkippedDir(path: string): boolean;

/**
 * [`is_stale_running_experiment`](experiment_status::is_stale_running_experiment); `undefined` last
 * metric time means none. `nowMs` defaults to `Date.now()`, `staleMs` to [`STALE_RUNNING_MS`].
 *
 * # Errors
 *
 * Fails if `experiment` has the wrong shape.
 */
export function isStaleRunningExperiment(experiment: B.Experiment, now_ms?: number | null, stale_ms?: number | null, last_metric_at_ms?: number | null): boolean;

/**
 * [`is_stored_pdf_url`]: whether the reader answers `url` from the app's own store.
 */
export function isStoredPdfUrl(url: string): boolean;

/**
 * [`is_substantial_paper_text`]: whether the text reaches `min_chars` once whitespace is collapsed.
 */
export function isSubstantialPaperText(text: string, min_chars: number): boolean;

/**
 * [`is_supervisor_role`](member::is_supervisor_role).
 */
export function isSupervisorRole(role?: string | null | undefined): boolean;

/**
 * [`local_first_route::is_synced_table`].
 */
export function isSyncedTable(table: string): boolean;

/**
 * [`is_temporary_name`](vault_search::is_temporary_name): whether a listing must skip this entry.
 */
export function isTemporaryName(name: string): boolean;

/**
 * [`is_typing_target`](typing_target::is_typing_target) on the element's tag name and editability.
 */
export function isTypingTarget(tag_name: string | null | undefined, is_content_editable: boolean): boolean;

/**
 * [`wf_core::sync::git_policy::is_under_ignored_folder`] for JS.
 *
 * # Errors
 *
 * Fails when `rel_path` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function isUnderIgnoredFolder(rel_path: string): boolean;

/**
 * [`is_unique_clash`] for JS (TS `isUniqueClash`).
 */
export function isUniqueClash(message: string): boolean;

/**
 * [`is_unsure_confidence`].
 */
export function isUnsureConfidence(conf: number): boolean;

/**
 * Whether a line's `conf` is too low, or missing, to trust ([`is_unsure_confidence`]).
 *
 * # Errors
 *
 * Throws as the JS read `line.conf` would on a non-object.
 */
export function isUnsureLine(line: { conf: number }): boolean;

/**
 * [`is_user_integration_connected`](integration_credentials::is_user_integration_connected).
 *
 * # Errors
 *
 * Fails if `settings` cannot be read as JSON, `field_ids` is not a string array, or a field
 * checked before the first set one is not a string.
 */
export function isUserIntegrationConnected(settings: B.CredentialSettings, provider_id: string, field_ids: readonly string[]): boolean;

/**
 * [`is_vector_cache_file`](paths::is_vector_cache_file): whether a folder-cache entry is a vector file.
 */
export function isVectorCacheFile(path: string): boolean;

/**
 * [`is_web_article`]: `ids` is an `OpenAccessIds`.
 *
 * # Errors
 *
 * Fails if `ids` does not have the expected shape.
 */
export function isWebArticle(ids: { doi?: string | null; arxivId?: string | null; pmcid?: string | null; knownPdfUrl?: string | null; pageUrl?: string | null }): boolean;

/**
 * True when `id` has the UUID shape of an Overleaf session id. The caller checks it is a string first.
 */
export function isWorkshopSessionId(id: string): boolean;

/**
 * [`is_zip_file`](import_links::is_zip_file).
 */
export function isZipFile(name: string): boolean;

/**
 * [`is_child_item`](zotero_library::is_child_item): true for an attachment, note, annotation or
 * an item with a parent.
 *
 * # Errors
 *
 * Fails if `item` cannot be read as an object.
 */
export function isZoteroChildItem(item: unknown): boolean;

/**
 * [`is_zotero_library_sync_mode`] for any JS value: false unless `value` is a string.
 */
export function isZoteroLibrarySyncMode(value: string): boolean;

/**
 * [`iso_date`](calendar_date::iso_date): the calendar part of an ISO timestamp.
 */
export function isoDate(iso: string): string;

/**
 * [`iso_day_from_parts`](milestone::iso_day_from_parts): `month` is 1-based.
 */
export function isoDayFromParts(year: number, month: number, day: number): string;

/**
 * [`item_ids_for_papers`]: the item id of each paper in order, or the message that refuses it.
 */
export function itemIdsForPapers(list_id: string, items: readonly B.ReadingListItem[], paper_ids: readonly string[]): B.ItemIdsPlan;

/**
 * [`item_to_rect`] as `[x1, y1, x2, y2]`, or `null`. Omitted bounds take the TS defaults (`0` and `Infinity`).
 *
 * # Errors
 *
 * Fails if `item` is not a text item object, or the result cannot be converted.
 */
export function itemToRect(item: B.SelectionPageTextItem, char_from?: number | null, char_to?: number | null): number[] | null;

/**
 * [`join_bibtex`](bibtex::join_bibtex): entries joined with a blank line, or `% (empty)`.
 *
 * # Errors
 *
 * Fails if `entries` is not an array of strings.
 */
export function joinBibtex(entries: readonly string[]): string;

/**
 * [`join_ink_text_layer`](ink_page::join_ink_text_layer): one text layer per page, joined.
 *
 * # Errors
 *
 * Fails if `pages` is not an array of strings.
 */
export function joinInkTextLayer(pages: readonly string[]): string;

/**
 * The text for a body that failed to parse, keeping the parser's reason (`jsonBodyError`).
 */
export function jsonBodyError(err: unknown): string;

/**
 * [`wf_core::sync::json_entities::json_data_path`] for JS.
 *
 * # Errors
 *
 * Fails when `project_root` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units or `kind` is not a
 * known kind.
 */
export function jsonDataPath(project_root: string, kind: B.WorkspaceJsonKind): string;

/**
 * [`json_edit_since`](folder_mirror::json_edit_since). `base` is the recorded digest map.
 *
 * # Errors
 *
 * Fails when `base` is not an object of string digests.
 */
export function jsonEditSince(base: Readonly<Record<string, string>>, path: string, text: string): boolean;

/**
 * [`wf_core::sync::json_entities::json_kind_of_path`] for JS; `null` for none.
 *
 * # Errors
 *
 * Fails when `path` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function jsonKindOfPath(path: string): B.WorkspaceJsonKind | null;

/**
 * [`keep_all_picks`]: the field picks a "keep all" makes on one side.
 *
 * # Errors
 *
 * Fails if `fields` is not an array of strings, or `side` is not `"local"` or `"remote"`.
 */
export function keepAllPicks(fields: readonly string[], side: "local" | "remote"): { field: string; side: "local" | "remote" }[];

/**
 * [`keep_both_title`](folder_merge::keep_both_title): the title of the copy kept beside a conflict.
 */
export function keepBothTitle(title: string): string;

/**
 * [`shortcut_label::key_label`]: one keycap, `⌘` reads `Ctrl` off a Mac.
 */
export function keyLabel(key: string, mac: boolean): string;

/**
 * [`rules::kind_icon`].
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 */
export function kindIcon(kind: string): string;

/**
 * [`rules::kind_icon_class`]. `open` defaults to false.
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 */
export function kindIconClass(kind: string, open?: boolean | null): string | null;

/**
 * [`kind_multiplier`](search_settings::kind_multiplier); an unknown `kind` reads as `1`.
 *
 * # Errors
 *
 * Fails if `settings` cannot be read as JSON.
 */
export function kindMultiplier(kind: B.SearchKind, settings?: B.SearchSettings): number;

/**
 * [`rules::KINDS`] as a string array.
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 */
export function kindNames(): readonly B.TreeNodeKind[];

/**
 * [`kind_of`](panel_labels::kind_of): the label for a synced table.
 */
export function kindOf(table: string): string;

/**
 * [`kind_of_id`](search_document::kind_of_id). `undefined` when there is no `:`.
 */
export function kindOfId(id: string): string | undefined;

/**
 * [`rules::kind_owner`].
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 */
export function kindOwner(kind: string): B.KindOwner;

/**
 * [`rules::kind_suffix`].
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 */
export function kindSuffix(kind: string): string | null;

/**
 * [`rules::kind_tint_class`].
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 */
export function kindTintClass(kind: string): string | null;

/**
 * [`kinds_for_resource`](search_index_state::kinds_for_resource): the kinds a write can change, or `null` when unmapped.
 *
 * # Errors
 *
 * Fails only if the result cannot be serialized.
 */
export function kindsForResource(resource_type: string): B.SearchKind[] | null;

/**
 * [`wf_core::papers::open_access::known_candidates`]: the paper's own PDF and page.
 *
 * # Errors
 *
 * Fails only if the result cannot be converted to a JS value.
 */
export function knownCandidates(known_pdf?: string | null | undefined, page?: string | null | undefined): B.OpenAccessCandidate[];

/**
 * [`route_title::label_for_path`]: the screen's own name, or `null` for a route with none.
 *
 * # Errors
 *
 * Fails if `nav_items` is not an array of `{ path, label }` objects.
 */
export function labelForPath(pathname: string, nav_items: readonly B.NavRouteInput[]): string | null;

/**
 * [`labelNumber`](bibliography::label_number): entry number from the exec groups.
 *
 * # Errors
 *
 * Returns an error when `groups` is not an array of strings or `undefined`.
 */
export function labelNumber(groups: readonly (string | undefined)[]): number;

/**
 * [`label_size`](graph_sizing::label_size) as `{ font, line, gap }`: how big a label draws at
 * `zoom`. `kind === "tag"` picks the tag label's base size; `bounded` defaults to `true`.
 *
 * # Errors
 *
 * Fails only if the result cannot be serialised.
 */
export function labelSize(kind: string, zoom: number, bounded?: boolean | null): B.LabelSize;

/**
 * [`ladder_order`] (TS `ladderOrder`): the indexes of the supporting resolvers, in order.
 *
 * # Errors
 *
 * Fails if `supports` is not an array of booleans.
 */
export function ladderOrder(supports: readonly boolean[]): number[];

/**
 * [`latest_by_reviewer`](screening::latest_by_reviewer) (TS `latestByReviewer`): the latest
 * decision each reviewer recorded for one item, keyed by reviewer id.
 *
 * # Errors
 *
 * Fails if `decisions` or `stage` has the wrong shape.
 */
export function latestByReviewer(decisions: readonly B.ScreeningDecision[], item_id: string, stage: B.ScreeningStage): Map<string, B.ScreeningDecision>;

/**
 * [`latest_by_reviewer`](screening::latest_by_reviewer) (TS `latestByReviewerList`): the
 * latest decision of each reviewer for one item, as a list in `Map` order.
 *
 * # Errors
 *
 * Fails if `decisions` or `stage` has the wrong shape.
 */
export function latestByReviewerList(decisions: readonly B.ScreeningDecision[], item_id: string, stage: B.ScreeningStage): B.ScreeningDecision[];

/**
 * [`layout_annotation_margin_notes`]: the page's annotations, as the margin reads them. Returns
 * `{ index, top, anchorTop }[]` where `index` is the annotation's position in `annotations`.
 *
 * # Errors
 *
 * Fails if `annotations` or `projection` do not have the expected shape.
 */
export function layoutAnnotationMarginNotes(annotations: readonly T.ReaderAnnotation[], projection: B.ReaderPageProjection, card_height: number): B.MarginSlot[];

/**
 * [`layout_for_command`](pane::layout_for_command). `command` is a chord name such as
 * `"split-right"`; `new_pane_id` defaults to a fresh [`next_pane_id`]. Returns `layout` itself
 * when the command changes nothing, so `next === layout` means "no change".
 *
 * # Errors
 *
 * Fails if an argument has the wrong shape.
 */
export function layoutForCommand(layout: B.PaneLayout, command: B.PaneCommand, new_pane_id?: string | null): B.PaneLayout;

/**
 * [`layout_for_tab_menu`](pane::layout_for_tab_menu). `new_pane_id` defaults to a fresh
 * [`next_pane_id`]. Returns `layout` itself when the command changes nothing.
 *
 * # Errors
 *
 * Fails if an argument has the wrong shape.
 */
export function layoutForTabMenu(layout: B.PaneLayout, pane_id: string, index: number, command: B.TabMenuCommand, new_pane_id?: string | null): B.PaneLayout;

/**
 * [`layout_from_record`](layout_record::layout_from_record). A missing or
 * unusable record is one empty pane, so this never fails on content.
 *
 * # Errors
 *
 * Never fails in practice; returns the serializer's result type.
 */
export function layoutFromRecord(raw?: string | null): B.PaneLayout;

/**
 * [`layout_margin_notes`]: `marks` is one `{ hasComment, hasPicture, geometry }` per
 * annotation and `projection` a page projection. Returns `{ index, top, anchorTop }[]` in
 * ascending `anchorTop` order, where `index` is the mark's position in `marks`.
 *
 * # Errors
 *
 * Fails if `marks` or `projection` do not have the expected shape.
 */
export function layoutMarginNotes(marks: readonly B.MarginMark[], projection: B.ReaderPageProjection, card_height: number): B.MarginSlot[];

/**
 * [`layout_storage_key`](layout_record::layout_storage_key): the key a project's layout is kept
 * under.
 */
export function layoutStorageKey(project_id?: string | null): string;

/**
 * [`leaves`](pane::leaves). Returns owned copies of the leaves.
 *
 * # Errors
 *
 * Fails if `node` has the wrong shape.
 */
export function leaves(node: B.PaneNode): B.PaneLeaf[];

/**
 * [`levenshtein`](analysis_outline::levenshtein) (TS `levenshtein`).
 */
export function levenshtein(a: string, b: string, limit?: number | null): number;

/**
 * [`library_bibtex`](bibtex::library_bibtex): the whole library as one `.bib`.
 *
 * # Errors
 *
 * Fails if `papers` is not an array of paper objects.
 */
export function libraryBibtex(papers_value: readonly BibPaperInput[]): string;

/**
 * [`link_citation_mentions`](link_citations::link_citation_mentions) (TS
 * `linkCitationMentions`).
 *
 * # Errors
 *
 * Fails if `page`, `links` or `refs` do not have the expected shape.
 */
export function linkCitationMentions(page: B.LinkCitationPage, links: readonly B.AnalysisPdfLink[], refs: readonly B.AnalysisParsedReference[]): B.AnalysisCitationMention[];

/**
 * [`rules::link_group_of`].
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 */
export function linkGroupOf(kind: string): B.LinkGroup | null;

/**
 * [`link_label`] for JS: the label, or `null` for an empty or multi-line selection.
 */
export function linkLabel(selected: string): string | null;

/**
 * [`link_node_id`] (TS `linkNodeId`). `source` is a string endpoint or an endpoint object; the
 * result is the id, or `null` when there is none.
 *
 * # Errors
 *
 * Fails if `source` cannot be read as a JSON value.
 */
export function linkNodeId(source: string | { id: string }): string;

/**
 * [`link_sentence`]: "‹from› cites ‹to›", or `null` until both papers are picked.
 */
export function linkSentence(from: string | null | undefined, relation: string, to?: string | null): string | null;

/**
 * [`link_targets_error`](link_resolve::link_targets_error). Returns the message, or `undefined`
 * when no target failed.
 */
export function linkTargetsError(failed: readonly string[]): string | undefined;

/**
 * [`lint_wiki`](wiki_lint::lint_wiki). A missing `otherTitles` means none, as in the TS default.
 *
 * # Errors
 *
 * Fails if `pages` is not a list of `{ id, title, body, aliases? }` objects, or `otherTitles`
 * is not a list of strings.
 */
export function lintWiki(pages: readonly unknown[], other_titles?: readonly string[]): B.LintReport;

/**
 * [`list_display_colour`](reading_list::list_display_colour).
 *
 * # Errors
 *
 * Fails if `list` has the wrong shape.
 */
export function listDisplayColor(list: B.ReadingList): string;

/**
 * [`list_membership`](tree::list_membership). `titles` maps list id to title; returns a JS
 * `Map` of `kind:id` to list titles, in key order.
 *
 * # Errors
 *
 * Fails if either argument has the wrong shape.
 */
export function listMembership(items: readonly B.ListItemEntry[], titles: ReadonlyMap<string, string>): Map<string, string[]>;

/**
 * [`list_membership`](reading_list::list_membership) (TS `buildListMembership`): which list
 * holds which resource, `listId -> the ids in it`, in list order. Every list gets an entry,
 * including the empty ones. `key` is `"paper"`, `"vaultPage"` or `"either"`.
 *
 * # Errors
 *
 * Fails if `lists`, `items` or `key` has the wrong shape.
 */
export function listMembershipByKey(lists: readonly { id: string }[], items: readonly { listId: string; paperId?: string | null; vaultPageId?: string | null }[], key: B.ListMembershipKey): Map<string, Set<string>>;

/**
 * [`listed_annotations`]: the marks the Annotations list shows (ink left out).
 *
 * # Errors
 *
 * Fails if `annotations` is not a list of annotations.
 */
export function listedAnnotations(annotations: readonly T.ReaderAnnotation[]): T.ReaderAnnotation[];

/**
 * The stored PDF texts whose paper still exists, as the caller's own objects, with the page
 * counts and the orphan paper ids (the ones to delete from storage).
 *
 * Returns `{ texts, pageCounts, orphanPaperIds }`; `texts` holds the elements of `stored` that
 * survive, in their stored order.
 *
 * # Errors
 *
 * Fails if `stored` is not an array of PDF sources or `paper_ids` is not an array of strings.
 */
export function livePdfTexts(stored: readonly (Omit<B.PdfIndexSource, "pages"> & { pages?: readonly B.PdfPageText[] })[], paper_ids: readonly string[]): { readonly texts: readonly T.PdfIndexSource[]; readonly pageCounts: Map<string, number>; readonly orphanPaperIds: readonly string[] };

/**
 * [`nav_open_groups::load_open_groups`]: the open groups from stored JSON, with `active` forced open.
 *
 * # Errors
 *
 * Fails if the result cannot be converted to JS.
 */
export function loadOpenGroups(raw?: string | null, active?: string | null): string[];

/**
 * [`merge_signed_urls`] for JS: this computer's links win, the server fills the gaps.
 *
 * # Errors
 *
 * Fails when an argument is not an array of strings or nulls.
 */
export function localBlobMergeSignedUrls(paths: readonly string[], here: readonly (string | null | undefined)[], there: readonly (string | null | undefined)[]): (string | null)[];

/**
 * [`missing_paths`] for JS: the paths not in `have`, in order.
 *
 * # Errors
 *
 * Fails when either argument is not an array of strings.
 */
export function localBlobMissingPaths(paths: readonly string[], have: readonly string[]): string[];

/**
 * [`blob_read_sql`] for JS: the read statement for `path_count` paths.
 */
export function localBlobReadSql(path_count: number): string;

/**
 * [`removal_forgets_unsent_upload`] for JS: whether a removal forgets a queued upload.
 */
export function localBlobRemovalForgetsUpload(pending_op?: string | null): boolean;

/**
 * [`blob_sql`] for JS: the statement with this name. Fails for an unknown name.
 *
 * # Errors
 *
 * Fails when `name` is not a statement of the local attachment store.
 */
export function localBlobSql(name: string): string;

/**
 * [`unsigned_indices`] for JS: the positions whose link this computer lacks (`null`), in order.
 *
 * # Errors
 *
 * Fails when `here` is not an array of strings or nulls.
 */
export function localBlobUnsignedIndices(here: readonly (string | null | undefined)[]): number[];

/**
 * [`local_db_engine_params::LOCAL_DB_SHARED_BUFFERS`]: the `shared_buffers` value the local engine runs with.
 */
export function localDbSharedBuffers(): string;

/**
 * [`device_user_id`] for JS: the reported id when non-empty, else `fallback`.
 */
export function localDeviceUserId(reported: string | null | undefined, fallback: string): string;

/**
 * [`DEVICE_USER_SQL`] for JS: the query that reads the signed-in user.
 */
export function localDeviceUserSql(): string;

/**
 * [`account_artifacts_pattern`] for JS: the LIKE pattern for rows already holding this account's paths.
 */
export function localExperimentAccountArtifactsPattern(account_id: string): string;

/**
 * [`ARTIFACT_BUCKET`] for JS: the storage bucket the pushed artifacts go to.
 */
export function localExperimentArtifactBucket(): string;

/**
 * [`artifact_rest`] for JS: the part after `app://artifacts/`, or `undefined` when the
 * entry is not a desktop-local artifact link.
 */
export function localExperimentArtifactRest(entry: string): string | undefined;

/**
 * [`artifact_storage_name`] for JS: the file name in storage.
 */
export function localExperimentArtifactStorageName(rest: string, recompressed: boolean): string;

/**
 * [`artifact_storage_path`] for JS: `{accountId}/{name}`.
 */
export function localExperimentArtifactStoragePath(account_id: string, name: string): string;

/**
 * [`BATCH`] for JS: the metric points one push batch sends. The loop ends on a short batch.
 */
export function localExperimentBatch(): number;

/**
 * [`prefer_webp`] for JS: whether the webp copy is kept (webp and smaller).
 */
export function localExperimentPreferWebp(webp_mime: string, webp_size: number, original_size: number): boolean;

/**
 * [`push_sql`] for JS: the statement with this name. Fails for an unknown name.
 *
 * # Errors
 *
 * Fails when `name` is not a statement of the experiment push.
 */
export function localExperimentPushSql(name: string): string;

/**
 * [`pushed_cursor`] for JS: the step to read from (`pushed ?? -2147483648`).
 */
export function localExperimentPushedCursor(pushed?: number | null): number;

/**
 * [`should_recompress`] for JS: whether a blob of this media type goes to webp first.
 */
export function localExperimentShouldRecompress(mime: string): boolean;

/**
 * [`LOCAL_FIRST_KEY`] for JS: the localStorage key of the local-first marker.
 */
export function localFirstKey(): string;

/**
 * [`local_first_account_from_marker`] for JS: `{ id, email }`, or `null` when unreadable.
 *
 * # Errors
 *
 * Fails when the result cannot be serialised.
 */
export function localFirstMarkerAccount(raw?: string | null): { id: string; email: string | null } | null;

/**
 * [`local_first_wanted`] for JS: whether the local-first wiring applies to this window.
 */
export function localFirstWanted(local_mode: boolean, desktop: boolean): boolean;

/**
 * [`is_local_mode`] for JS: whether the stored local-mode value turns local mode on.
 */
export function localIsLocalMode(stored?: string | null): boolean;

/**
 * [`local_iso_date`](calendar_date::local_iso_date): `YYYY-MM-DD` from local fields (month 1-based).
 */
export function localIsoDate(year: number, month: number, day: number): string;

/**
 * [`local_keys`](related_paper_hit::local_keys): the dedupe keys of a library.
 *
 * # Errors
 *
 * Fails if `papers` cannot be read as a list of library papers.
 */
export function localKeys(papers: unknown): B.RelatedPaperKeys;

/**
 * [`LOCAL_MODE_KEY`] for JS: the localStorage key of the local-mode choice.
 */
export function localModeKey(): string;

/**
 * [`secrets_json_text`] for JS: the secrets JSON to parse, `{}` when there is no row.
 */
export function localSecretsJsonText(stored?: string | null): string;

/**
 * [`load_secrets_sql`] for JS: the statement that reads this device's secrets row.
 */
export function localSecretsLoadSql(): string;

/**
 * [`save_secrets_sql`] for JS: the statement that writes this device's secrets row.
 */
export function localSecretsSaveSql(): string;

/**
 * [`local_subgraph`] (TS `localSubgraph`): the nodes within `depth` hops of `seed`, the seed
 * included, as a `Set`, or `null` when there is no seed or `depth` is below 1.
 *
 * # Errors
 *
 * Fails if `neighbors` is not a map of ids to iterables of ids.
 */
export function localSubgraph(seed: string | null, depth: number, neighbors: Map<string, Set<string>>): Set<string> | null;

/**
 * [`locate_anchor`](text_anchor::locate_anchor): `{ start, end }`, or `null`.
 *
 * # Errors
 *
 * Fails when `anchor` is not a comment anchor.
 */
export function locateAnchor(text: string, anchor: B.CommentAnchor): { start: number; end: number } | null;

/**
 * [`locate_mention`]: the rects and bounds a mention covers on its page.
 *
 * # Errors
 *
 * Fails if `items` is not an array of page text items.
 */
export function locateMention(items: readonly B.SelectionPageTextItem[], start: number, end: number): B.MentionGeometry;

/**
 * [`validate_new_log_entry`](log_entry::validate_new_log_entry): the error message, or `None`.
 *
 * # Errors
 *
 * Fails if `input` has the wrong shape.
 */
export function logEntryInputError(input: B.NewLogEntryInput): string | undefined;

/**
 * [`log_entry_message`] for JS (TS `logEntryMessage`).
 *
 * # Errors
 *
 * Fails when `input` is not a log entry message input with the expected fields.
 */
export function logEntryMessage(input: B.LogEntryMessageInput): string;

/**
 * [`log_eyebrow`] for JS (TS `logEyebrow`): the line, or `undefined` with no entries.
 *
 * # Errors
 *
 * Fails when `entryDates` is not an array of strings.
 */
export function logEyebrow(entry_dates: readonly string[], today: string): string | undefined;

/**
 * [`log_path`](folder_layout::log_path).
 */
export function logPath(id: string, entry_date: string, project_root?: string | null): string;

/**
 * [`looks_like_image_url`](wf_core::net::image_url::looks_like_image_url): the URL's own
 * path names a picture, so a pasted link is worth downloading.
 */
export function looksLikeImageUrl(url: string): boolean;

/**
 * [`looks_like_pdf_url`]: `true` for a direct PDF path, `false` for an HTML landing page.
 */
export function looksLikePdfUrl(url: string): boolean;

/**
 * [`cache_invalidation::lww_clear_target`]: the resource type a realtime `lww` broadcast
 * clears, or `undefined` (clear everything).
 *
 * # Errors
 *
 * Fails if `resource_type` exceeds `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function lwwClearTarget(resource_type?: string | null): string | undefined;

/**
 * [`cache_invalidation::lww_notify_resource`]: the `resourceType` of a write's `lww` payload,
 * or `undefined` for an empty or missing one.
 *
 * # Errors
 *
 * Fails if `resource_type` exceeds `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function lwwNotifyResource(resource_type?: string | null): string | undefined;

/**
 * [`make_ink_stroke`](ink_page::make_ink_stroke) with the defaults filled in.
 *
 * # Errors
 *
 * Fails if `input` has the wrong shape.
 */
export function makeInkStroke(input: { readonly points: readonly number[]; readonly pressures?: readonly number[]; readonly width?: number; readonly tool?: B.InkTool; readonly colour?: B.InkColour; readonly t0?: number; readonly shape?: B.InkShape; readonly lineIndex?: number }): B.InkStroke;

/**
 * [`manual_input_from_reference`]: the fields a manual add can fill from an entry.
 */
export function manualInputFromReference(entry: unknown): { title: string; status: "to_read"; authors?: string[]; year?: number; doi?: string; arxivId?: string; url?: string };

/**
 * [`map_ink_confidence`]; `scale` defaults to 1.
 */
export function mapInkConfidence(raw: number, scale?: number | null): number;

/**
 * [`mark_actions`]: what the popover on a tapped mark offers, or `null` when it offers nothing.
 *
 * # Errors
 *
 * Fails if `target` is not a mark's `{ type, origin, comment }` object.
 */
export function markActions(target: B.MarkTarget): B.MarkActions | null;

/**
 * [`mark_colour_tool`]: returns `"pen"`, `"highlight"`, `"underline"` or `"text"`.
 */
export function markColourTool(mark_type: string): string;

/**
 * [`mark_popover_shown`]: whether a mark's popover shows under the current tool.
 *
 * # Errors
 *
 * Fails if `annotation` has no string `type`.
 */
export function markPopoverShown(annotation: Pick<B.MarkTarget, "type">, tool: string): boolean;

/**
 * Applies the action `id` to `doc` with the selection `ranges` (UTF-16 offsets) and the main
 * selection's head. Returns the edits and the selection after them, or `null` when the action
 * does nothing here (`B.MarkdownOutcome | null`).
 *
 * # Errors
 *
 * Fails when `id` names no action, when `doc` is over the text cap, or when the arguments
 * cannot be read.
 */
export function markdownFormatAction(id: string, doc: string, ranges: B.MarkdownSpan[], main_head: number): B.MarkdownOutcome | null;

/**
 * Every formatting action, as `{ id, label, key, accelerator }` (`B.MarkdownActionInfo[]`).
 *
 * # Errors
 *
 * Fails when the list cannot be converted to a JS value.
 */
export function markdownFormatActions(): B.MarkdownActionInfo[];

/**
 * [`wf_core::sync::markdown_image::markdown_image`] for JS.
 *
 * # Errors
 *
 * Fails when an argument is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function markdownImage(target: string, alt: string): string;

/**
 * [`markdown_link`] for JS: `[label](url)`.
 */
export function markdownLink(label: string, url: string): string;

/**
 * [`markdown_to_latex`](markdown_to_latex::markdown_to_latex) (TS `markdownToLatex`): the
 * report Markdown as a LaTeX body, with warnings, figures and cited keys. `citeByTitle` maps
 * normalized paper titles to bib keys. A missing `md` reads as `""`, missing `opts` as `{}`.
 *
 * # Errors
 *
 * Fails if `opts` is not an options object.
 */
export function markdownToLatex(md: string | null | undefined, opts?: { citeByTitle?: ReadonlyMap<string, string> }): B.MarkdownToLatexResult;

/**
 * [`match_author_year_text`](analysis_citations::match_author_year_text) (TS `matchAuthorYearText`).
 *
 * # Errors
 *
 * Fails if `refs` is not an array of parsed references.
 */
export function matchAuthorYearText(text: string, refs: readonly B.AnalysisParsedReference[]): number[];

/**
 * [`match_references`]: for each paper's references (aligned to `library`), the index of the
 * library paper each one matches, or `null`.
 *
 * # Errors
 *
 * Fails if `library` or `references` has the wrong shape.
 */
export function matchCitationReferences(library: readonly CitationLibraryEntry[], references: readonly (readonly CitationPaperRef[] | null)[]): (number | null)[][];

/**
 * [`match_page_citations`] (TS `matchPageCitations`).
 *
 * # Errors
 *
 * Fails if any argument does not have the expected shape.
 */
export function matchPageCitations(page: B.PageCitationInput, references: readonly B.AnalysisParsedReference[], reference_ranges: readonly B.AnalysisPageTextRange[]): B.AnalysisCitationMention[];

/**
 * [`match_vocabulary`](vocab_match::match_vocabulary) as `{ text, matches }`.
 *
 * # Errors
 *
 * Fails if `vocabulary` is not an array of strings, or the result cannot be serialised.
 */
export function matchVocabulary(text: string, vocabulary: readonly string[]): B.VocabMatchResult;

/**
 * [`matching_page_indices`](palette_groups::matching_page_indices): the indices of the labels that
 * hold `query`, names that start with it first.
 *
 * # Errors
 *
 * Fails if `query` is too long or `labels` is not an array of strings.
 */
export function matchingPageIndices(labels: readonly string[], query: string): number[];

/**
 * [`mattermost_channel_for`](options::mattermost_channel_for); `null` when the event is off.
 *
 * # Errors
 *
 * Fails if `integration` or `event` has the wrong shape.
 */
export function mattermostChannelFor(integration: B.Integration, event: B.MattermostEvent): string | null;

/**
 * [`mattermost_connection`](fields::mattermost_connection).
 *
 * # Errors
 *
 * Fails if `integration` has the wrong shape.
 */
export function mattermostConnection(integration: B.Integration): B.MattermostConnection;

/**
 * [`mattermost_connection_ready`](fields::mattermost_connection_ready).
 *
 * # Errors
 *
 * Fails if `integration` has the wrong shape.
 */
export function mattermostConnectionReady(integration: B.Integration): boolean;

/**
 * [`mattermost_events`](options::mattermost_events): the settings rows, in panel order.
 *
 * # Errors
 *
 * Fails only if the result cannot be serialised.
 */
export function mattermostEvents(): B.MattermostEventInfo[];

/**
 * [`mattermost_options`](options::mattermost_options) with the defaults applied.
 *
 * # Errors
 *
 * Fails if `integration` has the wrong shape.
 */
export function mattermostOptions(integration: B.Integration): B.MattermostOptions;

/**
 * [`post_plan`] for JS (TS `mattermostPostPlan`).
 *
 * # Errors
 *
 * Fails when `input` is not a Mattermost post input with the expected fields.
 */
export function mattermostPostPlan(input: B.MattermostPostInput): B.MattermostPostPlan;

/**
 * [`post_response_plan`] for JS (TS `mattermostPostResponsePlan`).
 *
 * # Errors
 *
 * Fails when `input` is not a status and body with the expected fields.
 */
export function mattermostPostResponsePlan(input: B.MattermostPostResponse): B.MattermostPostResponsePlan;

/**
 * [`test_posts`] for JS (TS `mattermostTestPosts`).
 *
 * # Errors
 *
 * Fails when `integration` is not a sync integration with the expected fields.
 */
export function mattermostTestPosts(integration: B.Integration): B.MattermostTestPost[];

/**
 * [`MAX_FUSION_IDS`] for JS.
 */
export function maxFusionIds(): number;

/**
 * [`MAX_INDEX_TEXT_UTF16`] for JS, so the wrappers check the cap before the
 * text is copied into linear memory.
 */
export function maxIndexTextUtf16(): number;

/**
 * [`MAX_REPORT_CHARS`] for JS.
 */
export function maxReportChars(): number;

/**
 * [`blob_access::MAX_SIGNED_URL_PATHS`]: most paths one signed-url request may ask for.
 */
export function maxSignedUrlPaths(): number;

/**
 * [`may_drive_device`] for JS (TS `mayDriveDevice`).
 */
export function mayDriveDevice(signed_in_user_id?: string | null, adopted_account_id?: string | null): boolean;

/**
 * [`may_open_externally`](open_external::may_open_externally): a plain web address, with no
 * credentials, on an allowed port and not a private host. Scheme-less input is read as https.
 */
export function mayOpenExternally(url: string): boolean;

/**
 * [`mcp_client_configs`](mcp_config_rewrite::mcp_client_configs) as `[{ file, key }]`.
 *
 * # Errors
 *
 * Fails only when the result cannot be serialised to JavaScript.
 */
export function mcpClientConfigs(home: string, platform: string, app_data: string | null | undefined, sep: string): { file: string; key: "mcpServers" | "servers" }[];

/**
 * [`mcp_file_of`](mcp_config_rewrite::mcp_file_of): the MCP file name an env points at.
 */
export function mcpFileOf(env: unknown): string;

/**
 * [`MAX_ITEM_CHARS`](mcp_result::MAX_ITEM_CHARS): characters of any single item.
 */
export function mcpMaxItemChars(): number;

/**
 * [`MAX_RESULT_CHARS`](mcp_result::MAX_RESULT_CHARS): characters of a whole result.
 */
export function mcpMaxResultChars(): number;

/**
 * [`paper_evidence`]: the checked evidence for `request` against the resolved `doc` (or none).
 *
 * # Errors
 *
 * Fails with the refusal message when the excerpt is missing, the quote is not in it, or the source
 * is not this paper.
 */
export function mcpPaperEvidence(request: McpEvidenceRequest, doc: McpExcerptDoc | undefined): McpEvidence[];

/**
 * [`mcp_read_result`](mcp_result::mcp_read_result), as a plain JS `McpResult` object. A missing
 * `options.nonce` is drawn from `Math.random` (16 characters of `[a-z0-9]`).
 *
 * # Errors
 *
 * Fails if `items` is not an array of `{ label, text }` objects or `options` has the wrong shape.
 */
export function mcpReadResult(items: readonly B.UntrustedItem[], options?: { maxItemChars?: number; maxResultChars?: number; nonce?: string }): B.McpResult;

/**
 * [`MCP_RESULT_NOTICE`](mcp_result::MCP_RESULT_NOTICE): said to the calling agent, outside the fence.
 */
export function mcpResultNotice(): string;

/**
 * [`mcp_servers_json`](mcp_client_config::mcp_servers_json) for a `McpLaunchLine`.
 *
 * # Errors
 *
 * Fails if `launch` has the wrong shape.
 */
export function mcpServersJson(launch: B.McpLaunchLine): string;

/**
 * [`mean_pressure`]; `undefined` when no sample reports pressure.
 */
export function meanPressure(samples: readonly number[]): number | undefined;

/**
 * [`media_type_essence`]: the media type without parameters, lowercased.
 */
export function mediaTypeEssence(value: string): string;

/**
 * [`member_name_map`](wf_core::member::member_name_map) as a `Map` from member id to display
 * name: full name, else email, else `"Member"`.
 *
 * # Errors
 *
 * Fails when `members` is not a list of member sources.
 */
export function memberNameMap(members: readonly B.MemberNameSource[]): Map<string, string>;

/**
 * [`rules::member_rank`]: papers before notes inside a reading list. An unknown kind's
 * "no rank" (`i32::MAX`) reads as `Number.MAX_SAFE_INTEGER`, so it sorts last as before.
 */
export function memberRank(kind: string): number;

/**
 * [`member_role_label`](member::member_role_label): the label shown for a member's role, or
 * `""` when the role has none.
 *
 * # Errors
 *
 * Fails if `member` or `opts` has the wrong shape.
 */
export function memberRoleLabel(member: { role: string }, opts: { inLab: boolean; ownsOrg?: boolean }): string;

/**
 * [`member_role_label`](member::member_role_label): the label, or `undefined` when the role has none.
 *
 * # Errors
 *
 * Fails if `member` has the wrong shape.
 */
export function memberRoleLabelOf(member: { role: string }, in_lab: boolean, owns_org: boolean): string | undefined;

/**
 * [`mention_item_ranges`]: where a mention's offsets fall in each run it covers.
 *
 * # Errors
 *
 * Fails if `items` is not an array of page text items.
 */
export function mentionItemRanges(items: readonly { str: string; hasEOL?: boolean }[], start: number, end: number): B.CitationItemRange[];

/**
 * [`mention_rects`](analysis_text::mention_rects) as an array of rects (TS `mentionRects`).
 *
 * # Errors
 *
 * Fails if `items` is not an array of text items.
 */
export function mentionRects(items: readonly B.AnalysisPdfItem[], start: number, end: number): number[][];

/**
 * [`menu_palette_actions`](menu_palette::menu_palette_actions): the palette rows the menu backs.
 *
 * # Errors
 *
 * Fails if `groups` has the wrong shape.
 */
export function menuPaletteActions(groups: readonly { items: { id: string; label: string; enabled: boolean }[] }[]): { id: string; label: string }[];

/**
 * [`merge_both_changed`](folder_merge::merge_both_changed). `base` and `workspace_content`
 * may be absent, which keeps the entry as it was.
 *
 * # Errors
 *
 * Fails when `entry` or `base` is not the shape the folder import produces.
 */
export function mergeBothChanged(entry: B.ImportDiffEntry, base: B.VaultPageBase | undefined, workspaceContent?: string | null): B.ImportDiffEntry;

/**
 * [`merge_extractions`](extraction::merge_extractions).
 *
 * # Errors
 *
 * Fails when `results` is not a list of extraction results.
 */
export function mergeExtractions(results: readonly B.ExtractionResult[]): B.ExtractionResult;

/**
 * [`merge_graph_persisted_state`](graph_settings::merge_graph_persisted_state): `stored` is the
 * parsed state, or `null` for the defaults.
 *
 * # Errors
 *
 * Fails if `stored` has the wrong shape.
 */
export function mergeGraphPersistedState(stored: B.GraphPersistedState | null): B.GraphPersistedState;

/**
 * [`wf_core::sync::text_diff::merge_hunks`] for JS. Picks are keyed by hunk
 * index; only canonical decimal keys (`"0"`, not `"00"`) count, as in the TS.
 *
 * # Errors
 *
 * Fails when either text is over `MAX_INDEX_TEXT_UTF16` UTF-16 units, or when
 * `picks` is not an object of `HunkPick` values.
 */
export function mergeHunks(ours: string, theirs: string, picks: any): string;

/**
 * [`merge_order`] (TS `MergePapersUseCase.execute`): which copy a merge keeps, the order the
 * others fold into it, and the refusal message when the merge cannot run.
 *
 * # Errors
 *
 * Fails if `copies` is not a list of `{ id, linked }` objects.
 */
export function mergeOrder(keep_id: string, copies: readonly B.MergeCopy[], can_remove_zotero: boolean): B.MergeOrder;

/**
 * [`merge`](project_list::merge): account projects and linked reports as one list of rows.
 *
 * # Errors
 *
 * Returns the deserialization error when either argument is not an array of the expected shape.
 */
export function mergeOverleafProjects(account: any, linked: any): any;

/**
 * [`merge_paper_into`] (TS `mergePaperInto`). The kept paper with the duplicate's gaps filled.
 *
 * # Errors
 *
 * Fails if either argument is not a paper, or the result cannot be converted.
 */
export function mergePaperInto(keep: B.MergePaper, dup: B.MergePaper): B.MergePaper;

/**
 * [`wf_core::sync::merge::merge_rows`] for JS, as `{ merged, conflicts }`.
 *
 * # Errors
 *
 * Fails when a row is not a plain object of JSON values.
 */
export function mergeRows(base: any, local: any, remote: any): any;

/**
 * [`merge_seen_ids`](citation_alerts::merge_seen_ids): prior ids, then new ones, each once.
 */
export function mergeSeenIds(prior: readonly string[], current: readonly string[]): string[];

/**
 * [`merge_server_appearance`](user_appearance::merge_server_appearance) of `server` over
 * `local`, both read as plain JSON. Always an object.
 *
 * # Errors
 *
 * Fails if either side cannot be rebuilt as JSON or the result cannot be converted.
 */
export function mergeServerAppearance(local: B.UserAppearance, server: B.UserAppearance): B.UserAppearance;

/**
 * [`merge_template`](tpl::merge_template).
 */
export function mergeTemplate(existing: string, rendered: string): string;

/**
 * [`wf_core::sync::merge_vault_page::merge_vault_page`] for JS, as `VaultPageMerge`.
 *
 * # Errors
 *
 * Fails when a body or the base digest is over `MAX_INDEX_TEXT_UTF16` UTF-16
 * units, or when an argument is not a valid vault page shape.
 */
export function mergeVaultPage(base: any, folder: any, workspace: any): any;

/**
 * [`merge_wiki_pages`](wiki_merge::merge_wiki_pages).
 *
 * # Errors
 *
 * Fails if `primary` or `secondary` is not a `{ id, title, body, aliases?, sources? }` object.
 */
export function mergeWikiPages(primary: B.MergeInput, secondary: B.MergeInput): B.WikiMergeResult;

/**
 * [`diagram_id`](mermaid_source::diagram_id) (TS `diagramId`): the SVG id for a diagram source.
 */
export function mermaidDiagramId(source: string): string;

/**
 * [`render_source`](mermaid_source::render_source) (TS `renderMermaidBlock`'s trim and label
 * quoting): the source the renderer draws.
 */
export function mermaidRenderSource(code: string): string;

/**
 * [`metadata_title`](paper_drop::metadata_title) (TS `metadataTitle`).
 */
export function metadataTitle(raw?: string | null): string | undefined;

/**
 * [`metric_keys`](experiment_status::metric_keys): the metric names across runs, in UTF-16 order.
 *
 * # Errors
 *
 * Fails if `experiments` is not an array of run objects.
 */
export function metricKeys(experiments: readonly B.Experiment[]): string[];

/**
 * [`metric_keys`](experiment_status::metric_keys) under its `parts.ts` name: every metric name any
 * of the runs logged, sorted by UTF-16 code units.
 *
 * # Errors
 *
 * Fails if `experiments` is not an array of run objects.
 */
export function metricKeysOf(experiments: readonly B.Experiment[]): string[];

/**
 * [`migrated_expanded`](state::migrated_expanded): the saved keys plus any root the record never
 * mentioned. Saved keys win.
 *
 * # Errors
 *
 * Fails if an argument does not hold only strings.
 */
export function migratedExpanded(saved: ReadonlySet<string>, roots: readonly string[]): Set<string>;

/**
 * [`migrated_notice`](migrated_notice::migrated_notice): the warning for the marker's text, or
 * `null` when there is no marker.
 */
export function migratedNotice(raw?: string | null | undefined): string | null;

/**
 * [`to_milestone`]: a `milestones` row as the app's milestone.
 */
export function milestoneFromRow(row: B.MilestoneRowInput): B.Milestone;

/**
 * [`validate_new_milestone`](milestone::validate_new_milestone): the validation message, or
 * `undefined` when the input is valid.
 *
 * # Errors
 *
 * Fails if `input` has the wrong shape.
 */
export function milestoneInputError(input: B.NewMilestoneInput): string | undefined;

/**
 * [`milestone_message`] for JS (TS `milestoneMessage`).
 *
 * # Errors
 *
 * Fails when `input` is not a milestone message input with the expected fields.
 */
export function milestoneMessage(input: B.MilestoneMessageInput): string;

/**
 * [`to_row`]: a milestone as the `milestones` row it is written as.
 */
export function milestoneToRow(milestone: B.Milestone): B.MilestoneWriteRow;

/**
 * [`milestones_to_ics`](feed::milestones_to_ics): the `.ics` text for `items`.
 * `options.reminderDays` is floored; `includeDone` defaults to `false`.
 *
 * # Errors
 *
 * Fails if `items` or `options` has the wrong shape.
 */
export function milestonesToIcs(items: readonly B.FeedMilestone[], options: { includeDone?: boolean; reminderDays?: number; now: Date }): string;

/**
 * [`MIN_ARTICLE_TEXT_CHARS`]: the text a paper's own web page must carry.
 */
export function minArticleTextChars(): number;

/**
 * [`MIN_PAPER_TEXT_CHARS`]: how much text a page must carry to count as the paper.
 */
export function minPaperTextChars(): number;

/**
 * [`manifest_text`](mirror_manifest::manifest_text) on `paths`, `digests`, `bases` and the stamp.
 *
 * # Errors
 *
 * Fails if the inputs do not match the shape.
 */
export function mirrorManifestText(paths: readonly string[], digests: Readonly<Record<string, string>>, bases: Readonly<Record<string, unknown>>, written_at: string): string;

/**
 * [`missing_after_presence`] for JS: done for a chunk, failed, or the tombstone read it needs.
 *
 * # Errors
 *
 * Fails when `chunk` is not an array of strings or the result cannot be serialised.
 */
export function missingAfterPresence(table: string, chunk: string[], status: number, body: string): { next: "failed" } | { next: "done"; missing: string[] } | { next: "tombstones"; request: { method: string; path: string; body?: string; prefer?: string }; held: string[] };

/**
 * [`missing_after_tombstones`] for JS: the missing ids of a chunk, or `null` when the read is unusable.
 *
 * # Errors
 *
 * Fails when `chunk` or `held` is not an array of strings or the result cannot be serialised.
 */
export function missingAfterTombstones(chunk: string[], held: string[], status: number, body: string): string[] | null;

/**
 * [`missing_config_message`]: names the absent required env vars, never values.
 * `cfg` is the backend config object; `required` is an array of camelCase field names.
 *
 * # Errors
 *
 * Fails if `cfg` is not an object of optional strings, `required` is not an array of
 * known field names, or the result cannot be converted to JS.
 */
export function missingConfigMessage(cfg: B.BackendConfigFields, required: readonly B.BackendConfigField[]): string | null;

/**
 * [`missing_figure_warning`](export_path::missing_figure_warning): the warning for a figure whose
 * blob could not be loaded.
 *
 * # Errors
 *
 * Fails if `img` is not a `{ zipPath, storagePath }` object.
 */
export function missingFigureWarning(img: { zipPath: string; storagePath: string }): string;

/**
 * [`missing_id_chunks`] for JS: the ids split into the chunks `missingIds` reads, in order.
 *
 * # Errors
 *
 * Fails when `ids` is not an array of strings or the result cannot be serialised.
 */
export function missingIdChunks(ids: string[]): string[][];

/**
 * [`missing_page_plans`]: one placeholder plan per distinct, non-blank dead-link target.
 */
export function missingPagePlans(targets: readonly string[]): B.WikiPagePlanRecord[];

/**
 * [`missing_r2_config_message`]: names the unset R2 env vars, never values.
 *
 * # Errors
 *
 * Fails if `fields` is not an object of optional strings, or the result cannot be converted to JS.
 */
export function missingR2ConfigMessage(fields: B.R2Fields): string;

/**
 * [`build_batch_request`](model_extraction::build_batch_request): the chat request for one batch.
 *
 * `maxChars` is cast with `as usize`, which saturates: negative and NaN become 0.
 *
 * # Errors
 *
 * Fails if `batch` is not a list of documents.
 */
export function modelBuildBatchRequest(batch: readonly B.ModelDocument[], existing: readonly string[], model: string | null | undefined, max_chars: number, nonce: string): B.ModelRequest;

/**
 * [`try_model_cache_url`](model_cache::try_model_cache_url): the cache URL a request names, or
 * `null` when it is not a weights request.
 *
 * # Errors
 *
 * Throws on a URL that does not parse, as `new URL` did in the TS.
 */
export function modelCacheUrl(url: string, app_host: string): string | undefined;

/**
 * [`limits`](model_extraction::limits): the default batch size, document cap and known-concept cap.
 *
 * # Errors
 *
 * Fails only if the result cannot be converted to a JS value.
 */
export function modelExtractionLimits(): B.ModelExtractionLimits;

/**
 * [`finalize_extraction`](model_extraction::finalize_extraction): the merged, de-duplicated concepts.
 *
 * `maxConcepts` follows JS `slice(0, n)` semantics (see `js_slice_keep`); a falsy cap means no cap.
 *
 * # Errors
 *
 * Fails if `results` is not a list of extraction results.
 */
export function modelFinalizeExtraction(results: readonly B.ExtractionResult[], existing: readonly string[], max_concepts?: number | null | undefined): B.ExtractionResult;

/**
 * [`rules::modes_for`].
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 */
export function modesFor(kind: string): readonly B.DocumentMode[];

/**
 * [`motion_tier`] (TS `motionTier`): calm by default, bigger with Reactive motion, stepped on
 * CRT; off when reduced or unsupported.
 */
export function motionTier(input: { motion: string | undefined; theme: string | undefined; reducedMotion: boolean; supported: boolean }): "off" | "calm" | "reactive" | "crt";

/**
 * [`move_tab`](pane::move_tab). `to_index` is the slot on a tab drop, or omitted to append on
 * a pane drop.
 *
 * # Errors
 *
 * Fails if `layout` or `from` has the wrong shape.
 */
export function moveTab(layout: B.PaneLayout, from: { paneId: string; index: number }, to_pane_id: string, to_index?: number | null): B.PaneLayout;

/**
 * [`moved_ids`]: `ids` with `id` moved one step (`-1` or `1`), or `null` at either end.
 */
export function movedIds(ids: readonly string[], id: string, step: number): string[] | null;

/**
 * [`moved_path`](folder_mirror::moved_path): `path` after the project folder `old` moved to `root`.
 */
export function movedPath(old: string, root: string, path: string): string;

/**
 * [`name_of`](panel_labels::name_of): a conflict's title, or "Untitled".
 *
 * # Errors
 *
 * Fails if `local` or `remote` is not an object (or null for `remote`).
 */
export function nameOf(local: Record<string, unknown>, remote: Record<string, unknown> | null): string;

/**
 * [`native_citation_mentions`] (TS `nativeCitationMentions`).
 *
 * # Errors
 *
 * Fails if any argument does not have the expected shape.
 */
export function nativeCitationMentions(page: B.AnalysisPdfPage, refs: readonly B.AnalysisParsedReference[], excluded: readonly B.AnalysisPageTextRange[]): B.AnalysisCitationMention[];

/**
 * [`reveal_nav::scroll_top_to_reveal`] for JS: the `scrollTop` that shows the row whole.
 */
export function navRevealScrollTop(row_top: number, row_bottom: number, view_top: number, view_bottom: number, scroll_top: number): number;

/**
 * [`needs_disclaimer_acceptance`](user_settings::needs_disclaimer_acceptance): whether the user
 * must accept the disclaimer again (no acceptance, or an older version).
 *
 * # Errors
 *
 * Fails if `settings` cannot be read as JSON.
 */
export function needsDisclaimerAcceptance(settings: Pick<B.UserSettings, "disclaimerAcceptedAt" | "disclaimerVersion">): boolean;

/**
 * [`needs_migration_hint`](org::needs_migration_hint).
 */
export function needsMigrationHint(message: string): boolean;

/**
 * [`needs_org_setup`](org::needs_org_setup).
 *
 * # Errors
 *
 * Fails if `state` has the wrong shape.
 */
export function needsOrgSetup(state: B.OrgSetupState): boolean;

/**
 * [`needs_person`]: whether one open conflict still needs a person.
 */
export function needsPerson(kind: string, field_count: number): boolean;

/**
 * [`needs_standalone_role_sync`](member::needs_standalone_role_sync).
 *
 * # Errors
 *
 * Fails if `profile` or `memberships` has the wrong shape.
 */
export function needsStandaloneRoleSync(profile: B.ProfileState | null, memberships: readonly B.Membership[], in_lab: boolean): boolean;

/**
 * [`neutralise_context`](untrusted_context::neutralise_context).
 */
export function neutraliseContext(text: string, nonce: string): string;

/**
 * [`new_ink_chunk_id`](ink_paths::new_ink_chunk_id): a new chunk id from `options.now`
 * (`Date.now()` by default) and 10 random bytes, filled by `options.randomBytes` or by
 * `crypto.getRandomValues`.
 *
 * # Errors
 *
 * Fails when `now` is not finite, and rethrows whatever filling the bytes throws.
 */
export function newInkChunkId(options?: { now?: number; randomBytes?: (target: Uint8Array) => void }): string;

/**
 * [`wf_core::error_report::issue_url::new_issue_url`] for JS: the address for
 * `body`, cut to fit the length limit.
 *
 * # Errors
 *
 * Fails when `title`, `body` or `repo` is over the text cap.
 */
export function newIssueUrl(title: string, body: string, repo: string): string;

/**
 * [`newest_release`]: the newest stable desktop release in `releases`, or `null`.
 *
 * # Errors
 *
 * Fails if `releases` does not match the release list shape, or the result cannot be converted
 * to JS.
 */
export function newestDesktopRelease(releases: readonly B.ReleaseRow[]): B.NewestRelease | null;

/**
 * [`newest_first_order`] for JS (TS `newestFirstOrder`): indexes, latest stamp first.
 *
 * # Errors
 *
 * Fails when `publishedAt` is not an array of strings.
 */
export function newestFirstOrder(published_at: readonly string[]): number[];

/**
 * [`next_auth_step`] (TS `nextAuthStep`): the step as `{ kind, ... }`.
 *
 * # Errors
 *
 * Fails if `input` has the wrong shape or the result cannot be converted to a JS value.
 */
export function nextAuthStep(input: { userId: string | null; previousId: string | null; signingOut: boolean; wasExpired: boolean; desktop: boolean; localAccountId: string | null }): B.AuthStep;

/**
 * [`next_page_offset`](semantic_scholar_citation::next_page_offset): the next offset, or `-1`
 * to stop. A non-number `next` is read as missing, as the TS did.
 *
 * # Errors
 *
 * Fails if `next` cannot be read as JSON.
 */
export function nextCitationPageOffset(current_offset: number, next: unknown, pages_fetched: number): number;

/**
 * [`next_manifest`](folder_mirror::next_manifest): the previous manifest minus removed paths,
 * plus written paths, deduped in first-seen order.
 *
 * # Errors
 *
 * Fails when `run` is not `{ written, removed }` string arrays.
 */
export function nextManifest(previous: readonly string[], run: { written: readonly string[]; removed: readonly string[] }): string[];

/**
 * [`next_match_index`]: wraparound step; -1 when `total` is 0.
 */
export function nextMatchIndex(current: number, total: number, direction: number): number;

/**
 * [`next_redirect`](redirect::next_redirect): follow, stop with a message, or not a redirect.
 * `resolved` is the TS `new URL(location, base).href`, or `undefined` when that parse threw.
 *
 * # Errors
 *
 * Fails if the step cannot be converted to a JS value.
 */
export function nextRedirect(status: number, location: string | null | undefined, resolved: string | null | undefined, hop: number, max_redirects: number): { kind: 'not-redirect' } | { kind: 'follow'; url: string } | { kind: 'failed'; message: string };

/**
 * [`next_rotation`] (TS `nextRotation`); `delta` defaults to 90.
 */
export function nextRotation(current: number, delta?: number | null): 0 | 90 | 180 | 270;

/**
 * [`next_shortcuts_open`](shortcuts::next_shortcuts_open): whether the sheet is open after a request.
 */
export function nextShortcutsOpen(open: boolean, how?: string | null): boolean;

/**
 * [`next_sort_order`]: the sort order a new row gets after `siblings`.
 */
export function nextSortOrder(siblings: readonly B.ReadingListItem[]): number;

/**
 * [`nib_width`]; `velocity` defaults to 0, `options.fullTaper` to the core default.
 *
 * # Errors
 *
 * Throws as the JS read `options.fullTaper` would on a non-object.
 */
export function nibWidth(base: number, pressure?: number, velocity?: number, options?: { fullTaper?: number }): number;

/**
 * [`node_size`](graph_sizing::node_size) as `{ r, line, drop, hit }`.
 *
 * # Errors
 *
 * Fails only if the result cannot be serialised.
 */
export function nodeSize(base_r: number, zoom: number, bounded?: boolean | null): B.NodeSize;

/**
 * [`normalise_page_rotation`] (TS `normalisePageRotation`): 0, 90, 180 or 270.
 */
export function normalisePageRotation(rotation: number): number;

/**
 * [`normalise_whitespace`] as `{ normalised, map }`; `options` is `{ trim? }` or undefined.
 *
 * # Errors
 *
 * Fails if `options` is not an options object, or the result cannot be converted.
 */
export function normaliseWhitespace(text: string, options?: { trim?: boolean }): { normalised: string; map: number[] };

/**
 * [`normalize_ai_access_settings`](access_policy::normalize_ai_access_settings); `undefined` reads as none.
 *
 * # Errors
 *
 * Fails if a field has the wrong JS type (for example a non-boolean `enabled`).
 */
export function normalizeAiAccessSettings(input?: Partial<B.AiAccessSettings>): B.AiAccessSettings;

/**
 * [`normalize_appearance`](user_appearance::normalize_appearance) of `raw` read as plain JSON
 * (as the stored row is); `undefined` when nothing is valid.
 *
 * # Errors
 *
 * Fails if `raw` cannot be rebuilt as JSON.
 */
export function normalizeAppearance(raw: unknown): B.UserAppearance | undefined;

/**
 * [`wf_core::papers::paper_ref::normalize_arxiv_id`]: the bare arXiv id in
 * `value`, or `None`.
 *
 * # Errors
 *
 * Fails if `value` exceeds `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function normalizeArxivId(value: string): string | undefined;

/**
 * [`normalize_color_value`](theme_config::normalize_color_value); `null` for a
 * non-string or a rejected color.
 */
export function normalizeColorValue(raw: unknown): string | null;

/**
 * [`normalize_comment_input`](sharing::normalize_comment_input).
 *
 * # Errors
 *
 * Throws an `Error` named `CommentValidationError` if `input` has the wrong shape or does not
 * validate.
 */
export function normalizeCommentInput(input: B.NewCommentInput): B.NewCommentInput;

/**
 * [`normalize_doi`](paper::normalize_doi) (TS `normalizeDoi`). `None` becomes `undefined`.
 */
export function normalizeDoi(doi?: string | null | undefined): string | undefined;

/**
 * [`normalize_field_name`](paper_field::normalize_field_name) (TS `normalizeFieldName`).
 */
export function normalizeFieldName(raw: string): string;

/**
 * [`normalize_font_stack`](theme_config::normalize_font_stack); `null` for a
 * non-string or a rejected stack.
 */
export function normalizeFontStack(raw: unknown): string | null;

/**
 * [`normalize_graph_view_settings`](graph_settings::normalize_graph_view_settings).
 *
 * # Errors
 *
 * Fails if `raw` cannot be read as JSON.
 */
export function normalizeGraphViewSettings(raw: unknown): B.GraphViewSettings;

/**
 * [`normalize_highlight_rects`]: one clean band per line of a text highlight.
 *
 * # Errors
 *
 * Fails if `rects` is not an array of number arrays.
 */
export function normalizeHighlightRects(rects: readonly (readonly number[])[]): number[][];

/**
 * A length such as `12px`, `0.5rem` or a px number, limited to `max_px` (default 64); `null`
 * otherwise.
 */
export function normalizeLengthValue(raw: unknown, maxPx?: number | null): string | null;

/**
 * [`wf_core::sync::markdown_image::normalize_markdown_image_syntax`] for JS.
 *
 * # Errors
 *
 * Fails when `body` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function normalizeMarkdownImageSyntax(body: string): string;

/**
 * [`normalize_invite_code`](org::normalize_invite_code).
 */
export function normalizeOrgInviteCode(input: string): string;

/**
 * [`normalize_paste_settings`] for JS: settings the pipeline can trust from whatever was
 * stored. A value `JSON.stringify` drops (such as `undefined`) reads as `null`.
 *
 * # Errors
 *
 * Rethrows what `JSON.stringify` throws; fails when the JSON is over the text cap.
 */
export function normalizePasteSettings(raw: unknown): B.PasteSettings;

/**
 * [`normalize_project_path`](project_path::normalize_project_path) (TS `normalizeProjectPath`).
 * `None` becomes `null`.
 */
export function normalizeProjectPath(path: string): string | null;

/**
 * [`normalize_repo_path`](git_shim::normalize_repo_path): repo-relative path, `""` for the root.
 */
export function normalizeRepoPath(path: string): string;

/**
 * [`normalize_search_history`](search_history::normalize_search_history). Any
 * non-array input yields an empty list. `max` defaults to
 * [`MAX_SEARCH_HISTORY`](search_history::MAX_SEARCH_HISTORY).
 *
 * # Errors
 *
 * Fails only if `raw` cannot be read as JSON-like data.
 */
export function normalizeSearchHistory(raw: unknown, max?: number | null): string[];

/**
 * [`normalize_search_settings`](search_settings::normalize_search_settings); `undefined` when nothing valid remains.
 *
 * # Errors
 *
 * Fails if `raw` cannot be read as JSON.
 */
export function normalizeSearchSettings(raw: unknown): B.SearchSettings | undefined;

/**
 * [`normalize_select_options`](paper_field::normalize_select_options) (TS `normalizeSelectOptions`).
 */
export function normalizeSelectOptions(raw: readonly string[]): string[];

/**
 * [`normalize_share_input`](sharing::normalize_share_input). A grant to a recipient with an
 * unknown resource type is refused before parsing, as the TS rule did.
 *
 * # Errors
 *
 * Throws an `Error` named `ShareValidationError` if `input` has the wrong shape or does not
 * validate.
 */
export function normalizeShareInput(input: B.NewShareInput): Required<B.NewShareInput>;

/**
 * [`normalize_tags`](paper::normalize_tags) (TS `normalizeTags`).
 */
export function normalizeTags(tags: string[]): string[];

/**
 * [`normalize_theme_config`](theme_config::normalize_theme_config): a stored config
 * re-checked as if uploaded again (as plain JSON), `null` when it no longer passes.
 *
 * # Errors
 *
 * Fails if `raw` cannot be rebuilt as JSON.
 */
export function normalizeThemeConfig(raw: unknown): B.ThemeConfig | null;

/**
 * [`normalize_title_key`](page::normalize_title_key) (TS `normalizeTitleKey`).
 */
export function normalizeTitleKey(title: string): string;

/**
 * [`normalize_user_settings`](user_settings::normalize_user_settings): trim strings and drop
 * empties before persistence.
 *
 * # Errors
 *
 * Fails if `settings` cannot be read as JSON.
 */
export function normalizeUserSettings(settings: B.UserSettings): B.UserSettings;

/**
 * [`normalize_vector`](embedding::normalize_vector). Returns a new `Float32Array`.
 */
export function normalizeVector(vector: Float32Array): Float32Array;

/**
 * [`normalize_zotero_library`](zotero_library::normalize_zotero_library): the library path, or
 * `undefined` when the input is not a library.
 *
 * # Errors
 *
 * Fails if `library` is neither a string nor missing.
 */
export function normalizeZoteroLibrary(library: string | undefined): string | undefined;

/**
 * [`note_backlinks`](page::note_backlinks) (TS `noteBacklinks`), as `{ id, title }` objects.
 *
 * # Errors
 *
 * Fails if `notes` has the wrong shape.
 */
export function noteBacklinks(notes: readonly unknown[], selectedId?: string | null): { id: string; title: string }[];

/**
 * [`body_text`](page_text::body_text): the full body when non-empty, else the preview, else `""`.
 * Never fails: the caller checks [`text_within_cap_js`] first and falls back to TS above the cap.
 */
export function noteBodyText(body?: string | null, body_preview?: string | null): string;

/**
 * [`note_tags`](page::note_tags) (TS `noteTags`): the distinct hashtags, sorted by UTF-16 order.
 *
 * # Errors
 *
 * Fails if `notes` has the wrong shape.
 */
export function noteTags(notes: readonly unknown[]): string[];

/**
 * [`notes_tagged`](graph_tags::notes_tagged): indices of the notes matching `tags`.
 *
 * # Errors
 *
 * Fails if `notes` or `tags` has the wrong shape.
 */
export function notesTagged(notes: readonly B.TaggedNote[], tags: readonly string[]): number[];

/**
 * [`notice_for`]: the text under `entry_index`, or `null` when the notice is about another entry.
 *
 * # Errors
 *
 * Fails if `notice` is neither `null` nor a `{ index, text }` object.
 */
export function noticeFor(notice: B.ReferenceNotice | null, entry_index: number): string | null;

/**
 * [`object_key`]: the logical bucket and path joined as the S3 object key.
 */
export function objectKey(logical_bucket: string, path: string): string;

/**
 * [`one_euro_alpha`](one_euro::one_euro_alpha): the smoothing factor for a cutoff in
 * hertz and a timestep in milliseconds.
 */
export function oneEuroAlpha(cutoff: number, dt_ms: number): number;

/**
 * [`open_access_ids_of`]: `paper` carries `doi`, `arxivId`, `url` and `metadata`.
 *
 * # Errors
 *
 * Fails if `paper` does not have the expected shape.
 */
export function openAccessIdsOf(paper: { doi?: string | null; arxivId?: string | null; url?: string | null; metadata?: unknown }): { doi?: string | null; arxivId?: string | null; pmcid?: string | null; knownPdfUrl?: string | null; pageUrl?: string | null };

/**
 * [`open_access_supports`] (TS `OpenAccessPdfResolver.supports`).
 */
export function openAccessSupports(arxiv_id?: string | null | undefined, url?: string | null | undefined, doi?: string | null | undefined): boolean;

/**
 * [`wf_core::papers::openalex::first_match`]: the index of the first matching work, or `undefined`.
 *
 * # Errors
 *
 * Fails if `hints` or `works` is not of the expected shape.
 */
export function openAlexFirstMatch(hints: { title?: string | null; year?: number | null }, works: { title?: string | null; publication_year?: number | null }[]): number | undefined;

/**
 * [`wf_core::papers::openalex::search_query`]: the query string for a works search.
 */
export function openAlexSearchQuery(search: string, mailto?: string | null, api_key?: string | null): string;

/**
 * [`openalex_to_hit`](related_paper_hit::openalex_to_hit): the hit for an OpenAlex work, or
 * `null` when it has no title.
 *
 * # Errors
 *
 * Fails if `work` cannot be read as an OpenAlex work object.
 */
export function openAlexToHit(work: unknown): B.RelatedPaperHitRow | null;

/**
 * [`openalex_to_metadata`] (TS `openAlexToMetadata`). An OpenAlex work as a paper.
 *
 * # Errors
 *
 * Fails if `work` is not an OpenAlex work.
 */
export function openAlexToMetadata(work: B.OpenAlexWork): B.ZoteroPaperInput;

/**
 * [`rules::open_mode_for`].
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 */
export function openModeFor(kind: string, body: string): B.DocumentMode;

/**
 * [`open_tab`](pane::open_tab). `pane_id` defaults to the focused pane.
 *
 * # Errors
 *
 * Fails if `layout` or `tab` has the wrong shape.
 */
export function openTab(layout: B.PaneLayout, tab: B.TabRef, pane_id?: string | null): B.PaneLayout;

/**
 * [`open_tab_keys`](pane::open_tab_keys): the key of every tab open in any pane, as a `Set`.
 *
 * # Errors
 *
 * Fails if `layout` has the wrong shape.
 */
export function openTabKeys(layout: B.PaneLayout): Set<string>;

/**
 * [`rules::opening_tab`]. `body` absent reads as an empty body.
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 */
export function openingTab(kind: string, id: string, body?: string | null): B.TabRef;

/**
 * [`optimistic_annotation_from_draft`]: the annotation to paint before its write returns.
 *
 * # Errors
 *
 * Fails if `draft` is not a new-annotation draft.
 */
export function optimisticAnnotationFromDraft(draft: T.NewReaderAnnotation, id: string, now: string): T.ReaderAnnotation;

/**
 * [`pglite_sql::or_value`] (TS `orValue`): one `or()` clause value, unquoted and unescaped.
 */
export function orValue(joined: string): string;

/**
 * [`pglite_sql::order_clause`] (TS `orderClause`): one quoted `order()` term.
 *
 * # Errors
 *
 * Returns an error for a column name the local database will not accept.
 */
export function orderClause(column: string, ascending?: boolean | null, nulls_first?: boolean | null): string;

/**
 * [`origin_of`](ipc_origin::origin_of): the origin of `url`, or `null` when it does not parse.
 */
export function originOf(url: string): string | null;

/**
 * [`original_range`](analysis_text::original_range) as `[start, end]` (TS `originalRange`).
 *
 * # Errors
 *
 * Fails if `view` is not a search text with `text`, `starts` and `ends`.
 */
export function originalRange(view: B.AnalysisSearchText, start: number, end: number): [number, number];

/**
 * [`original_url_from_proxy`]: the PDF URL a same-origin proxy request carries, or `null`.
 * `path` is the relay path of `url`.
 */
export function originalUrlFromProxy(path: string, url: string): string | null;

/**
 * [`out_of_scope_strays`](git_shim::out_of_scope_strays): indexed paths to recheck when
 * unstaging out-of-scope entries.
 */
export function outOfScopeStrays(indexed: readonly string[], kept: readonly string[], skipped: readonly string[], max_file_bytes: number): string[];

/**
 * [`outbox_entries`] for JS (TS `toEntry`, applied to each row of a result set).
 *
 * # Errors
 *
 * Fails when `rows` is not an array of outbox rows, or the result cannot be serialised.
 */
export function outboxEntries(rows: readonly unknown[]): unknown[];

/**
 * [`outline_from_text`](analysis_outline::outline_from_text) (TS `outlineFromText`).
 *
 * # Errors
 *
 * Fails if `allPages` is not an array of arrays of text items.
 */
export function outlineFromText(all_pages: readonly (readonly B.OutlineTextItem[])[]): B.OutlineReaderItem[];

/**
 * [`outline_is_plausible`](analysis_outline::outline_is_plausible) (TS `outlineIsPlausible`).
 *
 * # Errors
 *
 * Fails if `headings` is not an array of `{ page }` objects.
 */
export function outlineIsPlausible(headings: readonly { page: number }[], page_count: number): boolean;

/**
 * [`outline_item_of`](document_analysis::outline_item_of) (TS `outlineItemOf`).
 *
 * # Errors
 *
 * Fails if `item` is not a pdf.js text item with a `transform` array.
 */
export function outlineItemOf(item: B.AnalysisPdfItem, page: number): B.OutlineTextItem;

/**
 * [`outline_items_for`]: the pages' runs as outline items, one array per page.
 *
 * # Errors
 *
 * Fails if `pages` does not have the expected shape.
 */
export function outlineItemsFor(pages: readonly ReferencePage[]): unknown[][];

/**
 * [`outline_of`](outline::outline_of) as an array of `{ level, text, slug }`.
 *
 * # Errors
 *
 * Fails only if the result cannot be converted to a JS value.
 */
export function outlineOf(body: string, max_level?: number | null): B.OutlineHeading[];

/**
 * [`outline_progress`](section_progress::outline_progress) (TS `outlineProgress`).
 *
 * # Errors
 *
 * Fails if `roots` is not a list of section tree nodes.
 */
export function outlineProgress(roots: readonly B.ReportSectionTreeNode[]): B.SectionProgress;

/**
 * [`outline_text_lines`](analysis_outline::outline_text_lines) (TS `outlineTextLines`).
 *
 * # Errors
 *
 * Fails if `pages` is not an array of arrays of text items.
 */
export function outlineTextLines(pages: readonly (readonly B.OutlineTextItem[])[]): B.OutlineTextItem[];

/**
 * [`external_url`](overleaf::external_url).
 */
export function overleafExternalUrl(id: string): string;

/**
 * [`overleaf_git_url`](overleaf::overleaf_git_url).
 */
export function overleafGitUrl(id: string): string;

/**
 * [`matches_query`](project_list::matches_query): whether a row matches the search text.
 */
export function overleafProjectMatches(name: string, linked_title: string | null | undefined, query: string): boolean;

/**
 * [`is_shown`](project_list::is_shown): whether a row is shown given the picked ids.
 *
 * # Errors
 *
 * Returns the deserialization error when `picked` is not an array of strings.
 */
export function overleafProjectShown(has_link: boolean, id: string, picked: readonly string[]): boolean;

/**
 * [`wf_core::sync::blob_links::owned_asset_folder_paths`] for JS. `bodies` is an array
 * of strings; the result is the sorted array of folder paths they point at.
 *
 * # Errors
 *
 * Fails when `bodies` is not an array of strings, or a body is over `MAX_INDEX_TEXT_UTF16`
 * UTF-16 units. Each body is checked before it is copied into WASM.
 */
export function ownedAssetFolderPaths(bodies: readonly string[]): string[];

/**
 * [`owned_storage`](stored_pages::owned_storage): each owned folder path mapped to its storage path.
 */
export function ownedStorage(folder_paths: readonly string[]): Record<string, string>;

/**
 * [`pack_ink_stroke`] as `{ points, pressures }`; `pressures` defaults to `[]`,
 * `options` is the TS `InkStrokePackerOptions` or undefined.
 *
 * # Errors
 *
 * Fails if `options` is not an options object.
 */
export function packInkStroke(points: readonly number[], pressures?: readonly number[], options?: B.InkStrokePackerOptions): B.PackedInkStroke;

/**
 * [`pack_stroke_instances`]: the instance floats for a stroke from span `from`
 * on (default 0), as a `Float64Array` the caller narrows into its buffer.
 */
export function packInkStrokeInstances(xs: ArrayLike<number>, ys: ArrayLike<number>, width: number, from?: number | null): Float64Array;

/**
 * [`pack_local_row`](paths::pack_local_row): a local-database row for a head JSON and blob.
 */
export function packLocalVectorRow(head_json: string, bytes: Uint8Array): string;

/**
 * [`VectorIndex::to_bytes`] with its model, dimensions and content hashes, as the semantic
 * index's `serialize()` stores it: `{ model, dimensions, bytes, hashes }`. `hashes` is the
 * `Map` of embedded text hashes, copied to a plain object.
 *
 * # Errors
 *
 * Fails if `embedded` is not an iterable of `[string, string]` pairs.
 */
export function packVectorIndex(model: string, index: VectorIndex, embedded: Iterable<readonly [string, string]>): { readonly model: string; readonly dimensions: number; readonly bytes: Uint8Array; readonly hashes: Readonly<Record<string, string>> };

/**
 * [`pack_vectors`](codec::pack_vectors).
 *
 * # Errors
 *
 * Fails if the head argument is not an object with `model`, `dimensions` and `revision`.
 */
export function packVectors(head: B.VectorFileHead, bytes: Uint8Array): Uint8Array;

/**
 * [`page_from_chunk_body`](chunk_read::page_from_chunk_body): a checked body as the page model.
 *
 * # Errors
 *
 * Fails on a body whose tables do not add up.
 */
export function pageFromChunkBody(body: Uint8Array): object;

/**
 * [`wf_core::papers::page_metadata::page_import_refusal`]: why `meta` cannot be
 * imported, or `None` when it can.
 *
 * # Errors
 *
 * Fails if `meta` is not a valid `PageMetadata` object.
 */
export function pageImportRefusal(meta: B.PageMetadata): string | null;

/**
 * [`page_list_problem`](pdf_pages::page_list_problem): the message, or `null`.
 *
 * # Errors
 *
 * Fails only if the result cannot be serialised.
 */
export function pageListProblem(answer: string, count: number): string | null;

/**
 * [`page_pictures`]: the placed pictures on a page, figure-ready and in paint order.
 *
 * # Errors
 *
 * Fails if `annotations` is not a list of annotations.
 */
export function pagePictures(annotations: readonly T.ReaderAnnotation[], page_height: number): B.PagePicture[];

/**
 * [`page_span_of`]: the `{ startPage, endPage }` span of two resolved ends, or `null` when
 * neither end resolved to a page.
 *
 * # Errors
 *
 * Fails if the result cannot be converted to a JS value.
 */
export function pageSpanOf(start_page?: number | null, end_page?: number | null): { startPage: number; endPage: number } | null;

/**
 * [`page_text_after_recognition`]: the page text once handwriting has been recognised.
 */
export function pageTextAfterRecognition(was: string, prior: string, recognised: string): string;

/**
 * [`page_text_from_items`] over `{ str, hasEOL? }[]`.
 *
 * # Errors
 *
 * Fails if `items` is not an array of run objects.
 */
export function pageTextFromItems(items: readonly { str: string; hasEOL?: boolean }[]): string;

/**
 * [`PAGE_TITLE_SCAN_CHARS`](page_title::PAGE_TITLE_SCAN_CHARS): how much of a page body the
 * title scan reads, read at call time.
 */
export function pageTitleScanChars(): number;

/**
 * [`pages_to_evict`]: `rendered` and `visible` are number arrays; returns a sorted number array.
 * `radius` defaults to [`PDF_KEEP_RADIUS`].
 *
 * # Errors
 *
 * Fails if `rendered` or `visible` is not an array of numbers.
 */
export function pagesToEvict(rendered: readonly number[], visible: readonly number[], radius?: number | null): number[];

/**
 * [`painted_order`](quick::painted_order): the results group by group.
 *
 * # Errors
 *
 * Fails if `results` is not an array of quick-open results.
 */
export function paintedOrder(results: readonly B.QuickOpenResult[]): B.QuickOpenResult[];

/**
 * [`palette_css`]: one palette entry as a CSS colour, `rgba` below an alpha of 1.
 *
 * # Errors
 *
 * Throws if `palette` is not a palette object.
 */
export function paletteCss(palette: Readonly<Record<string, readonly [number, number, number]>>, colour: string, alpha: number): string;

/**
 * [`palette_hex`]: one palette entry as `#rrggbb`.
 *
 * # Errors
 *
 * Throws if `palette` is not a palette object.
 */
export function paletteHex(palette: Readonly<Record<string, readonly [number, number, number]>>, colour: string): string;

/**
 * [`palette_mode_for`](palette_groups::palette_mode_for): the mode a key press opens, or `null`.
 *
 * # Errors
 *
 * Fails if `event` has the wrong shape.
 */
export function paletteModeFor(event: B.PaletteKey): B.PaletteMode | null;

/**
 * [`paper_cite_keys`](bibtex::paper_cite_keys) (TS `buildCiteByTitle`'s key list): one key per
 * paper, in order, unique across the list.
 *
 * # Errors
 *
 * Fails if `papers` is not an array of paper objects.
 */
export function paperCiteKeys(papers_value: readonly BibPaperInput[]): string[];

/**
 * Page-furniture selector list, joined for `querySelectorAll`.
 */
export function paperHtmlChromeSelector(): string;

/**
 * [`PAPER_HTML_CSP`]: the frame's own content security policy.
 */
export function paperHtmlCsp(): string;

/**
 * [`paper_html_dir`]: the folder kept paper pages are written to. Absent `projectRoot` reads as `""`.
 */
export function paperHtmlDir(project_root?: string | null): string;

/**
 * Tags the sanitizer forbids on top of its profile.
 */
export function paperHtmlForbidTags(): string[];

/**
 * [`paper_html_path`](folder_layout::paper_html_path).
 */
export function paperHtmlPath(paper_id: string, project_root?: string | null): string;

/**
 * [`paper_image_thumbnail_path`](paper_image::paper_image_thumbnail_path) (TS `paperImageThumbnailPath`).
 */
export function paperImageThumbnailPath(path: string): string;

/**
 * [`paper_image_upload_paths`](paper_image::paper_image_upload_paths) (TS `PaperImageStore.upload`). Returns `[full, thumb]`.
 */
export function paperImageUploadPaths(user_id: string, paper_id: string, unique: string, ext: string): [string, string];

/**
 * [`paper_pdf_path`](folder_layout::paper_pdf_path).
 */
export function paperPdfPath(paper_id: string, project_root?: string | null): string;

/**
 * [`validate_new_paper_relation`](paper_relation::validate_new_paper_relation): the
 * validation message, or `undefined` when the input is valid. An unknown `relation` gets
 * `Unknown relation "<relation>".`, checked first as the TS rule did.
 *
 * # Errors
 *
 * Fails if `input` is not an object or has the wrong shape.
 */
export function paperRelationInputError(input: B.NewPaperRelationInput): string | undefined;

/**
 * [`paper_to_bibtex`](bibtex::paper_to_bibtex): one `.bib` entry under `key`.
 *
 * # Errors
 *
 * Fails if `paper` is not a paper object.
 */
export function paperToBibtex(paper: BibPaperInput, key: string): string;

/**
 * [`parse_version`]: `0.5.2` to `[0, 5, 2]`, or `null`.
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 */
export function parseAppVersion(version: string): [number, number, number] | null;

/**
 * [`parse_artifact_refs`](artifact_refs::parse_artifact_refs) (TS `parseArtifactRefs`). Offsets
 * are UTF-16 code units.
 *
 * # Errors
 *
 * Fails if the result cannot be serialised.
 */
export function parseArtifactRefs(markdown: string): B.ParsedArtifactRef[];

/**
 * [`parse_bib_entries`](bib_entries::parse_bib_entries) (TS `parseBibEntries`): every `.bib`
 * among `files` (others are ignored); bad entries become warnings. Each entry's `fields` is a
 * record in source order.
 *
 * # Errors
 *
 * Fails if `files` is not an array of `{ path, content }`.
 */
export function parseBibEntries(files: readonly B.LatexSourceFile[]): { entries: (Omit<B.BibEntry, "fields"> & { fields: Record<string, string> })[]; warnings: B.BibWarning[] };

/**
 * [`parseBibliography`](bibliography::parse_bibliography): every entry, or none when fewer than three.
 *
 * # Errors
 *
 * Returns an error when `lines` does not deserialize as text lines, or the result fails to convert.
 */
export function parseBibliography(lines: readonly B.AnalysisTextLine[], with_offsets?: boolean | null): B.AnalysisParsedReference[];

/**
 * [`parseBibliographyEntry`](bibliography::parse_bibliography_entry): fields of one entry.
 *
 * # Errors
 *
 * Returns an error when `lines` is empty or does not deserialize as text lines, or the result fails to convert.
 */
export function parseBibliographyEntry(lines: readonly B.AnalysisTextLine[], index: number, with_offsets?: boolean | null): B.AnalysisParsedReference;

/**
 * [`wf_core::papers::open_access::parse_biorxiv`]: a bioRxiv or medRxiv answer as candidates.
 *
 * # Errors
 *
 * Fails if `body` is not valid JSON, or the result cannot be converted.
 */
export function parseBiorxiv(body: unknown, server: string): B.OpenAccessCandidate[];

/**
 * [`parse_reply`]: the reply text of a provider's JSON `payload`, or `null` when it is blank.
 *
 * # Errors
 *
 * Fails when `api` is not a known wire API or the payload cannot be read.
 */
export function parseByokReply(api: "openai-chat" | "anthropic-messages" | "ollama", payload: unknown): string | null;

/**
 * [`parse_css_colour`] as `[r, g, b]` in 0..1, or `null` for a colour it does not read.
 */
export function parseCssColour(value: string): [number, number, number] | null;

/**
 * [`parse_dashboard_layout`](layout::parse_dashboard_layout); `null` when `lg` or `sm`
 * is not an array.
 *
 * # Errors
 *
 * Fails if `raw` cannot be read as JSON.
 */
export function parseDashboardLayout(raw: unknown): { lg: { id: string; type: string; x: number; y: number; w: number; h: number; config?: Record<string, unknown> }[]; sm: { id: string; type: string; x: number; y: number; w: number; h: number; config?: Record<string, unknown> }[] } | null;

/**
 * Fails if `body` is not valid JSON, or the result cannot be converted.
 */
export function parseDoaj(body: unknown): B.OpenAccessCandidate[];

/**
 * [`parse_editor_citation_format`](prefs::parse_editor_citation_format): the saved format or `wikilink`.
 */
export function parseEditorCitationFormat(raw?: string | null): string;

/**
 * [`wf_core::papers::open_access::parse_europe_pmc`]: Europe PMC's answer as `{ candidates, pmcid }`.
 *
 * # Errors
 *
 * Fails if `body` is not valid JSON, or the result cannot be converted.
 */
export function parseEuropePmc(body: unknown): B.EuropePmcAnswer;

/**
 * [`parse_explorer_keys`](state::parse_explorer_keys). Takes the raw stored
 * string (or `null` when absent) and returns the keys, or `null` when the
 * record is unusable.
 *
 * # Errors
 *
 * Fails only if the result cannot be serialised.
 */
export function parseExplorerKeys(raw?: string | null): string[] | null;

/**
 * [`parse_extraction_json`](model_concepts::parse_extraction_json): the reply's `concepts` list, or `[]`.
 *
 * # Errors
 *
 * Fails only if the result cannot be converted to a JS value.
 */
export function parseExtractionJson(text: string): { name?: unknown; aliases?: unknown; kind?: unknown; documentIds?: unknown; evidence?: unknown; [key: string]: unknown }[];

/**
 * [`parse_figure_clip`]: the figure a clipboard text names, or `null`.
 *
 * # Errors
 *
 * Fails only if the result cannot be converted to a JS value.
 */
export function parseFigureClip(text?: string | null): B.FigureClip | null;

/**
 * [`parse_figure_crop`](figure::parse_figure_crop): a `c=l,t,r,b` value as crop insets clamped
 * to 0..99, or `undefined` when it is not four numbers.
 *
 * # Errors
 *
 * Fails if `raw` is longer than the index text limit.
 */
export function parseFigureCrop(raw: string): B.FigureBox["crop"] | undefined;

/**
 * [`parse_figure_tokens`](figure::parse_figure_tokens): an alt's box and crop, or `null` when the
 * box is not complete. A missing crop has no `crop` key.
 *
 * # Errors
 *
 * Fails if `alt` is longer than the index text limit.
 */
export function parseFigureTokens(alt: string): B.FigureBox | null;

/**
 * [`parse_folder_draft`](folder_draft::parse_folder_draft): the draft, or `null`.
 *
 * # Errors
 *
 * Fails only if the result cannot be converted to a JS value.
 */
export function parseFolderDraft(raw: string): { kind: string; tool: string; resourceId: string; resourceType?: string; content: string; payload?: Record<string, unknown>; sourceLinks?: string[]; expectedRevision?: string; createdAt?: string; projectId?: string } | null;

/**
 * [`parse_graph_persisted_state`](graph_settings::parse_graph_persisted_state); `null` when absent.
 *
 * # Errors
 *
 * Fails if `raw` cannot be read as JSON.
 */
export function parseGraphPersistedState(raw: unknown): B.GraphPersistedState | null;

/**
 * [`wf_core::papers::open_access::parse_hal`]: HAL's answer as candidates.
 *
 * # Errors
 *
 * Fails if `body` is not valid JSON, or the result cannot be converted.
 */
export function parseHal(body: unknown): B.OpenAccessCandidate[];

/**
 * [`parse_ink_chunk_path`](ink_paths::parse_ink_chunk_path): `{ noteId, chunkId }`, or `null`.
 */
export function parseInkChunkPath(path: string): { noteId: string; chunkId: string } | null;

/**
 * Parses a response body: empty is `{}`, a non-object is `{ data }`, invalid JSON is `{ error }` (`parseJsonBody`).
 */
export function parseJsonBody(text: string, context: string): Record<string, unknown>;

/**
 * [`wf_core::sync::json_entities::parse_json_data`] for JS, as `null` when it is not a JSON array.
 *
 * # Errors
 *
 * Fails when `path` or `content` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units, or `kind` is
 * not a known kind.
 */
export function parseJsonData(path: string, content: string, kind: B.WorkspaceJsonKind): B.ParsedJsonData | null;

/**
 * [`parse_kind_suffix`](folder_layout::parse_kind_suffix): the entity type, or `null`.
 */
export function parseKindSuffix(path: string): B.WorkspaceEntityType | null;

/**
 * [`parse_latex_section_tree`](wf_core::latex_section_tree::parse_latex_section_tree)
 * (TS `parseLatexSectionTree`). `entry_file` defaults to `main.tex`.
 *
 * # Errors
 *
 * Fails if `files` is not an array of `{ path, content }`.
 */
export function parseLatexSectionTree(files: readonly B.LatexSourceFile[], entry_file?: string | null): B.LatexSectionTree;

/**
 * [`parse_link_removal_text`] for JS: the textarea's rules, one per line.
 *
 * # Errors
 *
 * Fails when `text` is over the text cap.
 */
export function parseLinkRemovalText(text: string): string[];

/**
 * [`parse_md_image_alt`](markdown_figure_alt::parse_md_image_alt): an alt split into text, crop,
 * side and width.
 *
 * # Errors
 *
 * Fails if `raw` is longer than the index text limit.
 */
export function parseMdImageAlt(raw: string): B.MdImageAlt;

/**
 * [`wf_core::papers::open_access::parse_openalex`]: OpenAlex's answer as candidates.
 *
 * # Errors
 *
 * Fails if `body` is not valid JSON, or the result cannot be converted.
 */
export function parseOpenalex(body: unknown): B.OpenAccessCandidate[];

/**
 * [`parse_links`]: the well-formed links in the stored JSON. A non-string gives no links.
 *
 * # Errors
 *
 * Fails only if the result cannot be converted to JS.
 */
export function parseOverleafLinks(stored: unknown): { projectId: string; folder: string }[];

/**
 * [`parse_overleaf_project_id`](overleaf::parse_overleaf_project_id): the project id from a
 * pasted id, project page or git URL; `null` otherwise.
 */
export function parseOverleafProjectId(raw: string): string | null;

/**
 * [`parse_page_list`](pdf_pages::parse_page_list) as `{ pages, outOfRange? }`.
 *
 * # Errors
 *
 * Fails only if the result cannot be serialised.
 */
export function parsePageList(answer: string, count: number): B.PageSelection;

/**
 * [`parse_paper_field_value`] (TS `parsePaperFieldValue`). A refusal throws an `Error`
 * with the caller's `name` in the message.
 */
export function parsePaperFieldValue(value: unknown, name: string): B.PaperFieldValueData;

/**
 * [`parse_paper_html_document`]: the paper a kept file holds, or `null` for a file this app did not write.
 *
 * # Errors
 *
 * Fails only if the result cannot be converted to a JS value.
 */
export function parsePaperHtmlDocument(paper_id: string, text: string): B.PaperHtmlPage | null;

/**
 * [`wf_core::papers::paper_ref::parse_paper_ref`]: `value` as a `PaperRef`
 * (`PaperRef` in `bindings.ts`) of the given `kind`.
 *
 * # Errors
 *
 * Fails if `value` exceeds `MAX_INDEX_TEXT_UTF16` UTF-16 units, or if `kind`
 * is not a valid `PaperRefKind`.
 */
export function parsePaperRef(kind: B.PaperRefKind, value: string): B.PaperRef;

/**
 * [`parse_bounds`]: the saved position from the preference JSON, or `null`. A non-string reads
 * as `null`.
 *
 * # Errors
 *
 * Fails only if the result cannot be converted to JS.
 */
export function parsePlanWidgetBounds(stored: unknown): B.PlanWidgetBounds | null;

/**
 * [`wf_core::search::query::parse_query`]: the query split into terms, phrases,
 * exclusions and filters.
 *
 * # Errors
 *
 * Fails if `query` exceeds `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function parseQuery(query: string): B.ParsedQuery;

/**
 * [`parse_reader_split_pane`](split::parse_reader_split_pane); `null` for any value
 * other than `report` or `vault`.
 *
 * # Errors
 *
 * Fails only if the result cannot be converted to JS.
 */
export function parseReaderSplitPane(raw?: string | null): B.ReaderSplitPane | null;

/**
 * [`parse_regions`](tpl::parse_regions) as `{ ok, segments }` or `{ ok: false, reason }`.
 *
 * # Errors
 *
 * Fails only if the result cannot be serialised.
 */
export function parseRegions(document: string): { ok: true; segments: B.Segment[] } | { ok: false; reason: "malformed_markers" };

/**
 * [`parse_tag`]: `v0.5.2` to `[0, 5, 2]`, or `null` for any other tag.
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 */
export function parseReleaseTag(tag: string): [number, number, number] | null;

/**
 * [`parse_results_table_refs`](results_table_refs::parse_results_table_refs) (TS
 * `parseResultsTableRefs`). Offsets are UTF-16 code units.
 *
 * # Errors
 *
 * Fails if the result cannot be serialised.
 */
export function parseResultsTableRefs(markdown: string): { experimentIds: string[]; caption: string; start: number; end: number; raw: string }[];

/**
 * [`parse_rollup_options`](paper_field::parse_rollup_options) (TS `parseRollupOptions`): the
 * rollup config stored in a field's options, or `null` when they hold none.
 *
 * # Errors
 *
 * Fails only if the result cannot be converted to a JS value.
 */
export function parseRollupOptions(options: readonly string[]): B.PaperFieldRollupConfig | null;

/**
 * [`wf_core::papers::open_access::parse_semantic_scholar`]: Semantic Scholar's answer as candidates.
 *
 * # Errors
 *
 * Fails if `body` is not valid JSON, or the result cannot be converted.
 */
export function parseSemanticScholar(body: unknown): B.OpenAccessCandidate[];

/**
 * [`parse_sidecar_args`](wf_core::sidecar_args::parse_sidecar_args): `{ kind: "ok", ... }` or `{ kind: "error", message }`
 * for an array of argv strings (without the program name).
 *
 * # Errors
 *
 * Fails when `argv` is not an array of strings, or when the result cannot be converted to a JS value.
 */
export function parseSidecarArgs(argv: readonly string[]): { kind: "ok"; dataDir: string; migrations: string[]; backupsDir: string; migrateFrom: string | null; artifacts: string | null; bridge: string | null; appVersion: string | null; homeVariant: string | null; noLocalApi: boolean } | { kind: "error"; message: string };

/**
 * [`parse_stored_provider`](wf_core::ai::provider_descriptor::parse_stored_provider): the provider, or `null` when the blob does not match.
 *
 * # Errors
 *
 * Fails only when the parsed result cannot be converted to a JS value.
 */
export function parseStoredAiProvider(raw: string): B.StoredProvider | null;

/**
 * [`parse_stroke_clip`]: the strokes a clipboard text carries, or `null`.
 *
 * # Errors
 *
 * Fails only if the result cannot be converted to a JS value.
 */
export function parseStrokeClip(text?: string | null): B.InkStroke[] | null;

/**
 * [`parse_taskbar_created`]: the `TaskbarCreated` message id the helper printed, or `null`.
 *
 * # Errors
 *
 * Fails only if the result cannot be converted to JS.
 */
export function parseTaskbarCreatedId(stdout: string): number | null;

/**
 * [`parse_theme_config`](theme_config::parse_theme_config); a non-string reads as empty.
 *
 * # Errors
 *
 * Fails only if the result cannot be converted to JS.
 */
export function parseThemeConfig(text: string): B.ThemeConfigParseResult;

/**
 * [`wf_core::papers::open_access::parse_unpaywall`]: Unpaywall's answer as candidates.
 *
 * # Errors
 *
 * Fails if `body` is not valid JSON, or the result cannot be converted.
 */
export function parseUnpaywall(body: unknown): B.OpenAccessCandidate[];

/**
 * Parses a URL, accepting a scheme-less host the way a person would type it; `null` when the
 * trimmed input is empty or does not parse.
 */
export function parseUserUrl(input: string): URL | null;

/**
 * [`parse_wikilink_create_mode`](prefs::parse_wikilink_create_mode): `never` or `create`.
 */
export function parseWikilinkCreateMode(raw?: string | null): string;

/**
 * [`parse_wikilink_inner`](page::parse_wikilink_inner) (TS `parseWikilinkInner`).
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 */
export function parseWikilinkInner(inner: string, raw: string): B.WikilinkRef | null;

/**
 * [`wf_core::sync::deserialize::parse_workspace_folder`] for JS: every importable entity in a
 * folder's `{ [path]: content }` files.
 *
 * # Errors
 *
 * Fails when a path or content is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function parseWorkspaceFolder(files: Readonly<Record<string, string>>): B.ParsedEntity[];

/**
 * [`wf_core::papers::open_access::parse_zenodo`]: a Zenodo record's answer as candidates.
 *
 * # Errors
 *
 * Fails if `body` is not valid JSON, or the result cannot be converted.
 */
export function parseZenodo(body: unknown): B.OpenAccessCandidate[];

/**
 * [`partition_pdf_texts`](pdf_text_prune::partition_pdf_texts): which stored PDF texts survive and which to delete.
 *
 * Returns `{ kept, pageCounts, orphanPaperIds }`; `pageCounts` is a JS `Map` from paper id to
 * page count, in `Object.entries` order of the counts.
 *
 * # Errors
 *
 * Fails if `stored` is not an array of PDF sources or `paper_ids` is not an array of strings.
 */
export function partitionPdfTexts(stored: readonly (Omit<B.PdfIndexSource, "pages"> & { pages?: readonly B.PdfPageText[] })[], paper_ids: readonly string[]): { readonly kept: readonly number[]; readonly pageCounts: Map<string, number>; readonly orphanPaperIds: readonly string[] };

/**
 * [`passage_id`](semantic_hits::passage_id): the id of a document's `index`th passage.
 */
export function passageId(doc_id: string, index: number): string;

/**
 * [`paste_image_type`](paste_content::paste_image_type): the normalised image type, or `undefined`.
 */
export function pasteImageType(content_type: string): string | undefined;

/**
 * [`paste_lands_in_verbatim_context`] for JS. `offset` is in UTF-16 code units; it is
 * floored, and a negative offset reads as 0.
 *
 * # Errors
 *
 * Fails when `document` is over the text cap.
 */
export function pasteLandsInVerbatimContext(document: string, offset: number): boolean;

/**
 * [`pasted_figure_place`]: `figure` is a `FigurePlacement`, `on_page` the page's figures, `page` an `InkPageSize`.
 */
export function pastedFigurePlace(figure: B.FigurePlacement, on_page: readonly B.FigureBox[], page: B.InkPageSize): B.FigurePlacement;

/**
 * [`pasted_strokes_place`]: `strokes` are the pasted ones, `on_page` the page's, `page` an `InkPageSize`.
 */
export function pastedStrokesPlace(strokes: readonly T.ReadonlyInkStroke[], on_page: readonly T.ReadonlyInkStroke[], page: B.InkPageSize): B.InkStroke[];

/**
 * [`pdf_doc_id`](search_document::pdf_doc_id).
 */
export function pdfDocId(paper_id: string, page_index: number): string;

/**
 * [`pdf_doc_ids_for`](search_document::pdf_doc_ids_for).
 */
export function pdfDocIdsFor(paper_id: string, page_count: number): string[];

/**
 * [`pdf_id_prefix`](search_document::pdf_id_prefix).
 */
export function pdfIdPrefix(paper_id: string): string;

/**
 * [`pdf_page_href`](search_document::pdf_page_href).
 */
export function pdfPageHref(paper_id: string, page_index: number): string;

/**
 * A PDF page's text the way the reader builds it: a newline after each line-ending run.
 * Items whose `str` is not a string (marked content) carry no text and are skipped.
 */
export function pdfPageText(items: readonly unknown[]): string;

/**
 * [`pdf_point_to_screen`] as `{ x, y }` (TS `pdfPointToScreen`).
 *
 * # Errors
 *
 * Fails if `p` is not a page projection object.
 */
export function pdfPointToScreen(x: number, y: number, p: B.ReaderPageProjection): { x: number; y: number };

/**
 * [`pdf_proxy_path`]: the same-origin proxy route for an allowlisted PDF URL, or `null` when the
 * URL is not one the proxy fetches.
 */
export function pdfProxyPath(url: string): string | null;

/**
 * [`pdf_rect_to_screen_box`] as `{ left, top, width, height }` (TS `pdfRectToScreenBox`).
 * `rect` is flat `[x1, y1, x2, y2]`; a short array reads missing entries as NaN.
 *
 * # Errors
 *
 * Fails if `p` is not a page projection object.
 */
export function pdfRectToScreenBox(rect: readonly [number, number, number, number], p: B.ReaderPageProjection): { left: number; top: number; width: number; height: number };

/**
 * [`default_resolver_order`] (TS `defaultPdfSourceResolvers` order): the source kinds, in the
 * order they are tried. `hasCache` and `hasGithub` say which optional rungs exist.
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 */
export function pdfSourceResolverOrder(has_cache: boolean, has_github: boolean): B.PdfSourceKind[];

/**
 * The PDF text store's pure rules, one dispatcher keyed by `op`:
 *
 * - `{ op: "key", projectId, paperId }`: the key, a string.
 * - `{ op: "range", projectId }`: `{ lower, upper }`, the inclusive key bounds of the project.
 * - `{ op: "budget", pages: { text }[] }`: the number of leading pages to keep.
 *
 * # Errors
 *
 * Fails if `input` does not match one of the operations above.
 */
export function pdfTextStoreOp(input: { readonly op: "key"; readonly projectId: string | null; readonly paperId: string } | { readonly op: "range"; readonly projectId: string | null } | { readonly op: "budget"; readonly pages: readonly { readonly text: string }[] }): string | { readonly lower: string; readonly upper: string } | number;

/**
 * [`peers_from_states`](collab::peers_from_states) over awareness states: one entry per
 * other person (not you, not your other sessions, one per person). `me` is your
 * `{ clientId, authorId }`.
 *
 * # Errors
 *
 * Throws when `me` or a state cannot be read, or a user is not a JSON value.
 */
export function peersFromStates(states: ReadonlyMap<number, unknown>, me: { clientId: number; authorId: string }): B.Peer[];

/**
 * [`peers_from_states`](collab::peers_from_states); `users` is `[clientId, user][]`.
 *
 * # Errors
 *
 * Fails when `users` is not a list of pairs.
 */
export function peersFromUsers(users: readonly (readonly [number, unknown])[], self_client_id: number, self_author_id: string): B.Peer[];

/**
 * [`pending_field_fills`]: the pending `paper_field_value` proposals, optionally for one field.
 */
export function pendingFieldFills(proposals: readonly B.ExtractionProposal[], field_id?: string | null): B.ExtractionPendingFill[];

/**
 * [`pending_key`](extraction_keys::pending_key): the `paper::field` lookup key for one cell.
 */
export function pendingKey(paper_id: string, field_id: string): string;

/**
 * [`personalized_page_rank`](personalized_pagerank::personalized_page_rank): a `Map` from node
 * to visit probability, in first-visit order. `options.rng` defaults to `Math.random`.
 *
 * # Errors
 *
 * Fails if `graph` or `options` has the wrong shape.
 */
export function personalizedPageRank(graph: { nodes: string[]; edges: Map<string, string[]> }, seed: string, options?: { numWalks?: number; maxSteps?: number; damping?: number; rng?: () => number }): Map<string, number>;

/**
 * [`pglite_sql::pg_array`] (TS `pgArray`): the values as a Postgres array literal, each value
 * spelled as `String(value)` first.
 *
 * # Errors
 *
 * Rethrows what `String(value)` throws for a value that cannot be spelled.
 */
export function pgArray(values: readonly unknown[]): string;

/**
 * [`pick_free_copy_attempts`]: `{ pdf: number[], html: number[] }`, the indexes of the listed
 * candidates to try in each format.
 *
 * # Errors
 *
 * Fails if `formats` is not an array of strings.
 */
export function pickFreeCopyAttempts(formats: readonly string[]): { pdf: number[]; html: number[] };

/**
 * [`pick_keeper`] (TS `pickKeeper`), returning the kept paper's id.
 *
 * # Errors
 *
 * Fails if `group` is not a list of paper summaries, or it is empty.
 */
export function pickKeeper(group: readonly B.TidyPaper[]): string;

/**
 * [`pick_keys_to_evict`]: the keys to drop, oldest first. Throws an `Error` when
 * `maxEntries` is not a positive integer.
 *
 * # Errors
 *
 * Fails if `maxEntries` is not a positive integer, or `entries` has the wrong shape.
 */
export function pickKeysToEvict(entries: readonly B.CachedPdfAge[], max_entries: number): string[];

/**
 * [`pick_nearest_match`] as `{ start, end }`, or `undefined` when there is no match.
 *
 * # Errors
 *
 * Fails if `matches` or `position` has the wrong shape.
 */
export function pickNearestMatch(matches: readonly B.AnchorTextSpan[], position: B.AnchorPositionSelector | undefined): { start: number; end: number } | undefined;

/**
 * [`pick_project`](project_pick::pick_project): the index of the picked project.
 *
 * # Errors
 *
 * Throws an `Error` whose message names the miss or the ambiguity, or the shape error when
 * `projects` is not a list of projects.
 */
export function pickProject(projects: readonly B.PickableProject[], needle?: string | null): number;

/**
 * [`pick_project_folder`](folder_layout::pick_project_folder). `undefined` when no folder fits.
 */
export function pickProjectFolder(dirs: readonly string[], exact: string, tail: string): string | undefined;

/**
 * [`pick_renamed_folder`](project_rename::pick_renamed_folder): the one of `dirs` ending with
 * `tail`, or `undefined` when none or several match.
 */
export function pickRenamedFolder(dirs: readonly string[], tail: string): string | undefined;

/**
 * [`picture_comment`]: the comment text that stores a picture's crop and stacking order.
 *
 * # Errors
 *
 * Fails if `meta` is not a picture-metadata object.
 */
export function pictureComment(meta: B.PictureMeta): string;

/**
 * [`picture_meta`]: the picture's stored file, crop and stacking order, or `null` if not a picture.
 *
 * # Errors
 *
 * Fails if the result cannot be converted to a JS value.
 */
export function pictureMeta(kind: string, comment?: string | null | undefined): B.PictureMeta | null;

/**
 * [`picture_path`]: the stored file behind a placed picture, or `null`.
 *
 * # Errors
 *
 * Fails if `target` is not a mark's `{ type, origin, comment }` object.
 */
export function picturePath(target: B.MarkTarget): string | null;

/**
 * [`picture_rect`]: a figure's `[x1, y1, x2, y2]` rect in PDF user space.
 *
 * # Errors
 *
 * Fails if `figure` is not a figure-geometry object.
 */
export function pictureRect(figure: B.FigureGeometry, page_height: number): [number, number, number, number];

/**
 * [`pinned_screen_index`]: the pure half of merging pinned shared rows into a screen.
 *
 * # Errors
 *
 * Fails if `input` does not match the pinned-screen input shape, or the result cannot be
 * converted to JS.
 */
export function pinnedScreenIndex(input: B.PinnedScreenIndexInput): B.PinnedScreenIndex;

/**
 * [`pitch_share_card`]: the card metadata for `basePath` and `path`, without `metadataBase`.
 *
 * # Errors
 *
 * Fails if the result cannot be converted to JS.
 */
export function pitchShareCard(base_path: string, path: string): { title: string; description: string; ogType: string; siteName: string; locale: string; url: string; image: { url: string; width: number; height: number; alt: string }; twitterCard: string };

/**
 * [`pitch_share_constants`]: the shared title, description and default origin.
 *
 * # Errors
 *
 * Fails if the result cannot be converted to JS.
 */
export function pitchShareConstants(): { title: string; description: string; defaultAppOrigin: string };

/**
 * [`place_on_sheet`](page_background::place_on_sheet) as `{ x, y, width, height }`.
 *
 * # Errors
 *
 * Fails only if the result cannot be serialised.
 */
export function placeOnSheet(source_width: number, source_height: number, sheet_width: number, sheet_height: number): B.Placement;

/**
 * [`place_widget`]: the saved spot if it is on a screen, else the top-right of the first one.
 *
 * # Errors
 *
 * Fails if `saved` is not a position or `areas` is not a list of work areas, or the result
 * cannot be converted to JS.
 */
export function placePlanWidget(saved: B.PlanWidgetBounds | null, areas: readonly B.PlanWidgetWorkArea[]): B.PlanWidgetBounds;

/**
 * [`plan_entries`](archive::plan_entries). `entries` is `{ name, size }[]` in archive order;
 * the result is `{ name, action }[]` in the same order, where `action` is `keep`,
 * `empty`, `unsafe-name` or `too-big`.
 *
 * # Errors
 *
 * Fails if an argument has the wrong shape, or past the entry count or the total cap.
 */
export function planArchiveEntries(entries: readonly B.EntryInfo[], limits: B.ArchiveLimits): B.PlannedEntry[];

/**
 * [`plan_asset_copies`](asset_copy::plan_asset_copies): from each image's copy attempt
 * `{ oldPath, newPath | null }`, the `failedAssets` and the `rewrites` for the rest.
 *
 * # Errors
 *
 * Fails if `copies` is not a list of `{ oldPath, newPath }` objects with `newPath` a string or null.
 */
export function planAssetCopies(copies: readonly { oldPath: string; newPath: string | null }[]): { failedAssets: string[]; rewrites: { oldPath: string; newPath: string }[] };

/**
 * [`plan_asset_reads`](preview_read::plan_asset_reads): the selected assets in listing order,
 * each `read` or `too-big`. `only` is `undefined` for a full preview.
 *
 * # Errors
 *
 * Fails if an argument has the wrong shape.
 */
export function planAssetReads(assets: readonly { path: string; size: number }[], only: readonly string[] | undefined, note_texts: readonly string[], limits: { maxTotalBytes: number; maxFileBytes: number }): { path: string; action: 'read' | 'too-big' }[];

/**
 * [`wf_core::sync::blob_links::plan_asset_reanchor`] for JS. `owned` and `available` are
 * arrays of folder paths; the result is `{ keep, upload, unresolved }`.
 *
 * # Errors
 *
 * Fails when `body` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units, or `owned` or `available`
 * is not an array of strings.
 */
export function planAssetReanchor(body: string, owned: readonly string[], available: readonly string[]): B.ReanchorPlan;

/**
 * [`plan_bib_import`](bib_import::plan_bib_import) (TS `planBibImport`).
 *
 * # Errors
 *
 * Fails only if the result cannot be converted to a JS value.
 */
export function planBibImport(file_name: string, text: string, existing_dois: readonly string[], existing_keys: readonly string[]): B.BibImportPlan;

/**
 * [`plan_bibliography_annotations`]. `papers` is an array of paper snapshots,
 * `pull` the pulled annotations keyed by Zotero item key.
 *
 * # Errors
 *
 * Fails if an argument has the wrong shape, or the result cannot be converted to JS.
 */
export function planBibliographyAnnotations(papers: readonly B.BibliographyPaperInput[], pull: B.BibliographyPullInput): B.BibliographyPaperPlan[];

/**
 * [`chip_target`](chip::chip_target): where a dependency chip goes when tapped.
 *
 * # Errors
 *
 * Fails if `dep` or `milestones` has the wrong shape, or the result cannot be serialised.
 */
export function planChipTarget(dep: B.MilestoneDependency, known: readonly string[], milestones: readonly B.ChipMilestone[], is_offline_build: boolean): B.ChipTarget;

/**
 * [`plan_citation_segments`]: each run split at the mention boundaries inside it.
 *
 * # Errors
 *
 * Fails if `items` or `mentions` do not have the expected shape.
 */
export function planCitationSegments(items: readonly { str: string; hasEOL?: boolean }[], mentions: readonly { key: string; start: number; end: number; text?: string; label?: string; kind?: "citation" | "figure" | "url"; url?: string }[]): { from: number; to: number; text: string; mention?: { key: string; start: number; end: number; text?: string; label?: string; kind?: "citation" | "figure" | "url"; url?: string } }[][];

/**
 * [`plan_claim`](claim_import::plan_claim): `{ stamped, digests }`, or `null` when the file
 * already carries an id and nothing should be written.
 *
 * # Errors
 *
 * Fails when `base` is not an object of string digests.
 */
export function planClaimImport(content: string, id: string, path: string, base: Readonly<Record<string, string>>): { stamped: string; digests: Record<string, string> } | null;

/**
 * [`wf_core::sync::snapshot_delta::plan_delta`] for JS. `remote` is `{ id, updatedAt }[]`
 * and `held` is `[id, stamp][]`, as the TS shell passes them.
 *
 * # Errors
 *
 * Fails when either argument does not have the expected shape.
 */
export function planDelta(remote: any, held: any): any;

/**
 * [`plan_embedding_start`](embedding_models::plan_embedding_start) as `"reuse" | "swap" | "rebuild"`.
 *
 * # Errors
 *
 * Fails only if the result cannot be serialized.
 */
export function planEmbeddingStart(stored_model: string | null, target: string): "reuse" | "swap" | "rebuild";

/**
 * [`plan_eyebrow`](screen::plan_eyebrow): the line above the plan title, or `undefined` for none.
 *
 * # Errors
 *
 * Fails only if the result cannot be serialised.
 */
export function planEyebrow(total: number, done: number): string | undefined;

/**
 * [`plan_feed_origin`](feed_urls::plan_feed_origin): where the calendar feed is served.
 */
export function planFeedOrigin(server_routes: boolean, here?: string | null, configured?: string | null): string;

/**
 * [`plan_feed_urls`](feed_urls::plan_feed_urls): the calendar, https and widget links for `token`.
 * `includeDone` defaults to `false` and `reminderDays` to `0`.
 *
 * # Errors
 *
 * Fails if `options` has the wrong shape.
 */
export function planFeedUrls(origin: string, token: string, options?: { includeDone?: boolean; reminderDays?: number }): B.PlanFeedUrls;

/**
 * [`plan_fix_order`](wiki_lint::plan_fix_order).
 *
 * # Errors
 *
 * Fails if `report` is not a `LintReport` object.
 */
export function planFixOrder(report: B.LintReport): B.FixStep[];

/**
 * Whether, and how, to re-run a query that returned no results, as
 * `{ retry, fuzzinessFor(term) }`. The fuzziness for each term is absolute (max edit
 * distance), or 0 to leave it alone.
 *
 * # Errors
 *
 * Fails if `input` has the wrong shape.
 */
export function planFuzzyRetry(input: { resultCount: number; termCount: number }): { retry: boolean; fuzzinessFor(term: string): number };

/**
 * [`plan_import_titles`](import_links::plan_import_titles): the titles an import gives its
 * folders and notes against the existing titles, the renames it made, and `renameMap` (a `Map`
 * from normalised base name to new title, for [`rewriteWikilinks`](rewrite_wikilinks_js)).
 *
 * # Errors
 *
 * Fails only if the plan cannot be converted to a JS value.
 */
export function planImportTitles(folderKeys: readonly string[], noteNames: readonly string[], existingTitles: readonly string[]): { readonly folderTitles: readonly string[]; readonly noteTitles: readonly string[]; readonly renamed: readonly { readonly from: string; readonly to: string }[]; readonly renameMap: ReadonlyMap<string, string> };

/**
 * [`plan_item_order`]: the writes for a new item order, or the message that refuses it.
 */
export function planItemOrder(list_id: string, items: readonly B.ReadingListItem[], ordered_ids: readonly string[]): B.ItemOrderPlan;

/**
 * [`plan_json_apply`](json_apply::plan_json_apply): the ordered `{ index, target, remove, id }`
 * steps and the distinct `files` for a folder's JSON entries.
 *
 * # Errors
 *
 * Fails if `entries` does not match the shape, or the result cannot be serialized.
 */
export function planJsonApply(entries: readonly { action: 'created' | 'updated' | 'unchanged' | 'conflict' | 'removed'; kind: string; path: string; existingId: string }[]): { steps: { index: number; target: 'relations' | 'tags' | 'reading_list_items'; remove: boolean; id: string }[]; files: string[] };

/**
 * [`plan_tool_call`]: what the tool call `tool` with `args` asks for, given the `enabled` names.
 *
 * # Errors
 *
 * Fails with the refusal message when the tool is not enabled or an argument is refused.
 */
export function planMcpTool(tool: string, args: object, enabled: readonly string[]): McpPlan;

/**
 * [`wf_core::sync::folder_mirror::plan_mirror`] for JS: what mirroring `serialized` into the
 * folder would do, without touching it. `disk` holds the folder's text for every file path and
 * for every previous path that is not present but has a `base` entry; a missing key is a
 * missing file. Assets are not fetched: their folder paths only count as present, so they are
 * never removed. Returns the `MirrorResult` (`mirrored` and `bases` as `[path, value][]`).
 *
 * # Errors
 *
 * Fails when an argument has the wrong shape.
 */
export function planMirror(serialized: { files: Readonly<Record<string, string>>; assets: readonly B.SerializedAsset[] }, previous_paths: readonly string[], base: Readonly<Record<string, string>> | undefined, disk: Readonly<Record<string, string>>): B.MirrorResult;

/**
 * [`create_report_statement`](report_statements::create_report_statement): the insert for a new
 * link row, with its bound parameters.
 *
 * # Errors
 *
 * Fails if `input` is not a create object, or with the refusal message for an invalid project id
 * or entry file.
 */
export function planOverleafReportCreate(input: { projectId: string; connectionId: string; title: string; overleafProjectId: string; entryFile: string }): { sql: string; params: string[] };

/**
 * [`patch_report_statement`](report_statements::patch_report_statement): the update for one link
 * row, naming only the fields given.
 *
 * # Errors
 *
 * Fails if `input` is not a patch object, or with the refusal message for an invalid field or an
 * edit that names nothing.
 */
export function planOverleafReportPatch(input: { id: string; title?: string; overleafProjectId?: string; entryFile?: string; sectionTargets?: unknown }): { sql: string; params: string[] };

/**
 * [`plan_pace`](timeline::plan_pace): `"on track"` or the overdue and due-soon counts.
 */
export function planPace(milestones: readonly B.Milestone[], today: string): string;

/**
 * [`plan_pdf_add`](pdf_add_plan::plan_pdf_add) (TS `addPaperFromPdf`): the match, title source
 * and kept-PDF decisions for one dropped PDF, from the results of its I/O.
 *
 * # Errors
 *
 * Fails if `facts` cannot be read as the add facts, or the plan cannot be converted to a JS value.
 */
export function planPdfAdd(facts: B.PdfAddFacts): B.PdfAddPlan;

/**
 * [`pdf_lookup_steps`](pdf_add_plan::pdf_lookup_steps) (TS `addPaperFromPdf`): the lookups to
 * try for one dropped PDF, in order, stopping at the first hit.
 *
 * # Errors
 *
 * Fails if `facts` cannot be read as the lookup facts, or the steps cannot be converted to a JS value.
 */
export function planPdfLookups(facts: B.PdfLookupFacts): B.PdfLookupStep[];

/**
 * [`plan_preview_reads`](preview_read::plan_preview_reads): the notes and data files to read as
 * text, and the listed assets. `only` is `undefined` for a full preview.
 *
 * # Errors
 *
 * Fails if an argument has the wrong shape, or the result cannot be serialized.
 */
export function planPreviewReads(entries: readonly { path: string; size: number }[], project_root: string, has_project_dir: boolean, only: readonly string[] | undefined): { notes: string[]; json: string[]; assets: { path: string; size: number }[] };

/**
 * [`plan_renames`]: the renames adoption needs. `local` is the projects in name order.
 *
 * # Errors
 *
 * Fails if `local` is not an array of `{ id, name }`, `remote_names` is not an array of strings,
 * or the result cannot be serialised.
 */
export function planRenames(local: readonly B.LocalProject[], remote_names: readonly string[], device_label: string): B.Rename[];

/**
 * [`plan_series_ingest`](experiments::plan_series_ingest): `{ keep: indices, supersededTipStep }`.
 *
 * # Errors
 *
 * Fails only if the result cannot be converted to a JS value.
 */
export function planSeriesIngestIndices(steps: Float64Array, previous_max_step?: number | null): { keep: number[]; supersededTipStep: number | null };

/**
 * [`plan_timeline`](timeline::plan_timeline): the laid-out plan, or `null` when no milestone is
 * dated.
 *
 * # Errors
 *
 * Fails if `milestones` has the wrong shape.
 */
export function planTimeline(milestones: readonly B.Milestone[], today: string): B.PlanTimeline | null;

/**
 * [`plan_widget`](feed::plan_widget): the summary a widget draws.
 *
 * # Errors
 *
 * Fails if `items` or `options` has the wrong shape.
 */
export function planWidgetData(items: readonly B.FeedMilestone[], options: { includeDone?: boolean; limit?: number; now: Date }): B.PlanWidgetData;

/**
 * [`plan_wiki_pages`](wiki_plan::plan_wiki_pages) for a `PlanWikiPagesInput` object; returns the plans.
 *
 * # Errors
 *
 * Fails if `input` has the wrong shape, or the plans cannot be converted.
 */
export function planWikiPages(input: B.PlanWikiPagesInput): B.WikiPagePlan[];

/**
 * [`plot_height`](plot_size::plot_height).
 */
export function plotHeight(width: number, base: number): number;

/**
 * [`plot_tier`](plot_size::plot_tier): `"full"`, `"medium"` or `"compact"`.
 */
export function plotTier(width: number): string;

/**
 * [`plural`](panel_labels::plural): "n word" with the right plural.
 */
export function plural(n: number, word: string, many?: string | null): string;

/**
 * [`wf_core::papers::open_access::pmc_candidates`]: PubMed Central's PDF and HTML copies.
 *
 * # Errors
 *
 * Fails only if the result cannot be converted to a JS value.
 */
export function pmcCandidates(pmcid: string, license?: string | null): B.OpenAccessCandidate[];

/**
 * [`point_in_area`](clip::point_in_area).
 */
export function pointInArea(area: B.DrawArea, x: number, y: number): boolean;

/**
 * [`point_in_polygon`]: is `(x, y)` inside the flat `x, y` polygon.
 */
export function pointInPolygon(polygon: readonly number[], x: number, y: number): boolean;

/**
 * [`changes_request`] for JS: the `sync_changes` RPC read from `since`, `limit` rows at most.
 *
 * # Errors
 *
 * Fails when the result cannot be serialised.
 */
export function postgrestChangesRequest(since: number, limit: number): { method: string; path: string; body?: string; prefer?: string };

/**
 * [`conflict_request`] for JS: the read that fetches the server's copy of a row.
 *
 * # Errors
 *
 * Fails when the result cannot be serialised.
 */
export function postgrestConflictRequest(table: string, row_id: string): { method: string; path: string; body?: string; prefer?: string };

/**
 * [`error_info`] for JS (TS `postgrestErrorInfo`): `{ code, firstLine }` of an error body.
 *
 * # Errors
 *
 * Fails only if the result cannot be converted to a JS value.
 */
export function postgrestErrorInfo(body: string): B.ErrorInfo;

/**
 * [`gone_request`] for JS: the read that asks whether a row is still on the server.
 *
 * # Errors
 *
 * Fails when the result cannot be serialised.
 */
export function postgrestGoneRequest(table: string, row_id: string): { method: string; path: string; body?: string; prefer?: string };

/**
 * [`presence_request`] for JS: the read that asks which of these ids the server holds.
 *
 * # Errors
 *
 * Fails when `ids` is not an array of strings or the result cannot be serialised.
 */
export function postgrestPresenceRequest(table: string, ids: string[]): { method: string; path: string; body?: string; prefer?: string };

/**
 * [`request_init`] for JS: the headers and body to hand `fetch`, from a request built above.
 *
 * # Errors
 *
 * Fails when `spec` is not a request or the result cannot be serialised.
 */
export function postgrestRequestInit(spec: { method: string; path: string; body?: string; prefer?: string }, api_key: string, token?: string | null): { method: string; path: string; headers: Record<string, string>; body?: string };

/**
 * [`tombstone_request`] for JS: the read that asks whether one row is recorded as deleted.
 *
 * # Errors
 *
 * Fails when the result cannot be serialised.
 */
export function postgrestTombstoneRequest(table: string, row_id: string): { method: string; path: string; body?: string; prefer?: string };

/**
 * [`tombstones_for_request`] for JS: the read that asks which of these ids are recorded as deleted.
 *
 * # Errors
 *
 * Fails when `ids` is not an array of strings or the result cannot be serialised.
 */
export function postgrestTombstonesForRequest(table: string, ids: string[]): { method: string; path: string; body?: string; prefer?: string };

/**
 * [`writable`] for JS (TS `postgrestWritable`): the payload minus the table's generated columns.
 *
 * # Errors
 *
 * Fails when `payload` is not an object.
 */
export function postgrestWritable(table: string, payload: Record<string, unknown> | null): Record<string, unknown>;

/**
 * [`write_request`] for JS: the method, path, body and `prefer` of one queued write.
 *
 * # Errors
 *
 * Fails when the payload is not an object or the result cannot be serialised.
 */
export function postgrestWriteRequest(op: string, table: string, row_id: string, base_version: number | null | undefined, payload: Record<string, unknown> | undefined): { method: string; path: string; body?: string; prefer?: string };

/**
 * [`wf_core::papers::open_access::parse_doaj`]: DOAJ's answer as candidates.
 *
 * # Errors
 *
 * [`wf_core::papers::open_access::preprint_server_for`]: the preprint server for a DOI, or `None`.
 */
export function preprintServerFor(doi: string): string | undefined;

/**
 * [`wf_core::ink::pressure_byte`].
 */
export function pressureByte(pressure?: number | null): number;

/**
 * [`preview_open`](pane::preview_open).
 *
 * # Errors
 *
 * Fails if `layout` has the wrong shape.
 */
export function previewOpen(layout: B.PaneLayout): boolean;

/**
 * [`preview_reader_href`](paper_preview::preview_reader_href) (TS `previewReaderHref`).
 *
 * # Errors
 *
 * Fails if `preview` is not a preview object, or the result cannot be converted.
 */
export function previewReaderHref(remote_href: string | null | undefined, preview: B.PaperPreview, local_href: string): string | null;

/**
 * [`preview_source`](pane::preview_source): the document the preview shows, the focused tab or
 * `previous` when the focus is on the preview itself. `undefined` when there is none.
 *
 * # Errors
 *
 * Fails if an argument has the wrong shape.
 */
export function previewSource(layout: B.PaneLayout, previous: B.TabRef | undefined): B.TabRef | undefined;

/**
 * [`preview_tab`](pane::preview_tab).
 *
 * # Errors
 *
 * Never fails in practice; returns the serializer's result type.
 */
export function previewTab(): B.TabRef;

/**
 * [`primary_paper_ref`]: the arXiv id, else the DOI, else `null`. Blank strings count as unset.
 *
 * # Errors
 *
 * Fails only if the result cannot be converted to JS.
 */
export function primaryPaperRef(arxiv_id?: string | null | undefined, doi?: string | null | undefined): B.PaperRef | null;

/**
 * [`prisma_caveat`](prisma_figure::prisma_caveat) (TS `prismaCaveat`). `None` becomes `null`.
 *
 * # Errors
 *
 * Fails if `counts` has the wrong shape.
 */
export function prismaCaveat(counts: B.PrismaCounts): string | null;

/**
 * [`prisma_counts`](screening::prisma_counts) (TS `prismaCounts`).
 *
 * # Errors
 *
 * Fails if `items` or `decisions` has the wrong shape.
 */
export function prismaCounts(items: readonly B.ScreeningItem[], decisions: readonly B.ScreeningDecision[]): B.PrismaCounts;

/**
 * [`prisma_figure_tex`](prisma_figure::prisma_figure_tex) (TS `prismaFigureTex`): the PRISMA
 * flow diagram as a LaTeX figure. Missing `options` reads as `{}`.
 *
 * # Errors
 *
 * Fails if `counts` or `options` has the wrong shape.
 */
export function prismaFigureTex(counts: B.PrismaCounts, options: Omit<B.PrismaFigureOptions, "reasons"> & { reasons?: readonly B.ExclusionReasonCount[] | null }): string;

/**
 * [`wf_core::sync::folder_layout::project_dir`] for JS: the folder of a project, named from
 * its id and name.
 *
 * # Errors
 *
 * Fails when reading `project` throws, or `id` or `name` is over `MAX_INDEX_TEXT_UTF16` UTF-16
 * units.
 */
export function projectDir(project: { id: string; name: string }): string;

/**
 * [`project_folder_name`](project_folder::project_folder_name): the project a folder stands for, or `undefined`.
 */
export function projectFolderName(dir: string): string | undefined;

/**
 * [`to_project`]: a `projects` row as the app's project.
 */
export function projectFromRow(row: B.ProjectRow): B.Project;

/**
 * [`project_gate_open`].
 *
 * # Errors
 *
 * Fails if an argument has the wrong shape, or the result cannot be converted to JS.
 */
export function projectGateOpen(config: Omit<B.IntegrationConfig, "gitRead"> & { gitRead: readonly string[] }, gate: B.RuntimeGate): boolean;

/**
 * [`wf_core::sync::folder_layout::project_meta_dir`] for JS.
 *
 * # Errors
 *
 * Fails when `project_root` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function projectMetaDir(project_root?: string | null): string;

/**
 * [`project_name`](project_name): the trimmed name, or `undefined` when blank.
 */
export function projectName(name: string): string | undefined;

/**
 * [`project_page_annotation_geometry`]: `{ boxes, strokes }` in CSS pixels for one page.
 *
 * # Errors
 *
 * Fails if `input` does not match `ProjectGeometryInput`.
 */
export function projectPageAnnotationGeometry(input: B.ProjectGeometryInput): B.PageAnnotationGeometry;

/**
 * [`project_search_documents`](projection::project_search_documents). `graph` is the TS wiki
 * graph (edges as a `Map`), or `null` when degrees are not wanted; `pdfTexts` is the extracted
 * PDF text array.
 *
 * # Errors
 *
 * Fails if an argument or a reader annotation does not match the expected shape.
 */
export function projectSearchDocuments(snapshot: object, graph: { nodes: string[]; edges: Map<string, string[]> } | null, pdf_texts: readonly (Required<Omit<B.PdfIndexSource, "pages">> & { pages: readonly Required<B.PdfPageText>[] })[]): B.SearchDoc[];

/**
 * [`project_stored_pdf_texts`](projection::project_stored_pdf_texts): the worker's build.
 *
 * # Errors
 *
 * Fails if an argument or a reader annotation does not match the expected shape.
 */
export function projectStoredPdfTexts(snapshot: object, stored: readonly (Omit<B.PdfIndexSource, "pages"> & { pages?: readonly B.PdfPageText[] })[]): B.StoredPdfProjection;

/**
 * [`project_zotero_annotations`](zotero_projection::project_zotero_annotations): cached Zotero
 * annotations as reader annotations; notes are dropped, the rest sorted by position. A blank
 * `contentHash` counts as none.
 *
 * # Errors
 *
 * Fails when `annotations` is not a list of cached Zotero annotations, or `options` is not
 * `{ contentHash?, now? }`.
 */
export function projectZoteroAnnotations(annotations: readonly B.ZoteroAnnotationInput[], options?: { contentHash?: string; now?: string }): B.ZoteroReaderAnnotation[];

/**
 * [`projected_page_size`] as `{ width, height }` (TS `projectedPageSize`).
 *
 * # Errors
 *
 * Fails if `p` is not a page projection object.
 */
export function projectedPageSize(p: B.ReaderPageProjection): B.ReaderPageSize;

/**
 * [`pglite_sql::projection`] (TS `projection`): a `select` column list.
 *
 * # Errors
 *
 * Returns an error for a column name [`pglite_sql::ident`] refuses.
 */
export function projection(columns: string): string;

/**
 * [`append_vault_note_body`](proposal_inputs::append_vault_note_body): the note's new body.
 */
export function proposalAppendVaultNoteBody(existing: string, payload: unknown): string;

/**
 * [`proposal_applies`](proposal_apply::proposal_applies). `null` or `undefined` for the stored
 * revision means the row is missing.
 */
export function proposalApplies(stored_updated_at?: string | null, expected_revision?: string | null): boolean;

/**
 * [`edit_vault_note`](proposal_inputs::edit_vault_note): the title and/or body to set.
 */
export function proposalEditVaultNote(payload: unknown): B.VaultNoteEditInput;

/**
 * [`experiment_follow_up`](proposal_inputs::experiment_follow_up): `experiment` input.
 */
export function proposalExperimentFollowUp(payload: unknown): B.ExperimentFollowUpInput;

/**
 * [`experiment_update`](proposal_inputs::experiment_update): status, metrics and artifacts.
 */
export function proposalExperimentUpdate(payload: unknown): { status?: string; metrics?: Record<string, unknown>; artifacts?: string[] };

/**
 * [`log_entry`](proposal_inputs::log_entry): `create_log_entry` input.
 */
export function proposalLogEntry(payload: unknown): B.ProposalLogEntryInput;

/**
 * [`milestone_follow_up`](proposal_inputs::milestone_follow_up): `milestone` input.
 */
export function proposalMilestoneFollowUp(payload: unknown): B.ProposalMilestoneInput;

/**
 * [`milestone_status`](proposal_inputs::milestone_status): the status to set.
 */
export function proposalMilestoneStatus(payload: unknown): string;

/**
 * [`paper_annotation`](proposal_inputs::paper_annotation): the quote-anchored annotation input.
 */
export function proposalPaperAnnotation(payload: unknown): B.PaperAnnotationInput;

/**
 * [`paper_field_fill`](proposal_inputs::paper_field_fill): the checked field write.
 *
 * # Errors
 *
 * Throws for an unknown field, a non-fillable kind, a refused value, or an option not allowed.
 */
export function proposalPaperFieldFill(payload: unknown, defs: readonly B.PaperFieldDefInput[]): B.PaperFieldFillInput;

/**
 * [`paper_field_id`](proposal_inputs::paper_field_id): the `fieldId`, read before the field list.
 */
export function proposalPaperFieldId(payload: unknown): string;

/**
 * [`paper_note_addition`](proposal_inputs::paper_note_addition): the addition, else `content`.
 */
export function proposalPaperNoteAddition(payload: unknown, content: string): string;

/**
 * [`paper_update`](proposal_inputs::paper_update): `paper_update` input.
 */
export function proposalPaperUpdate(payload: unknown): B.PaperUpdateInput;

/**
 * [`reading_list_change`](proposal_inputs::reading_list_change): exactly one target.
 */
export function proposalReadingListChange(payload: unknown): B.ReadingListChangeInput;

/**
 * [`relation_change`](proposal_inputs::relation_change): `relation` input.
 */
export function proposalRelation(payload: unknown): B.RelationInput;

/**
 * [`report_notes`](proposal_inputs::report_notes): the notes to set on a report section.
 */
export function proposalReportNotes(payload: unknown): string;

/**
 * [`vault_note`](proposal_inputs::vault_note): `create_vault_note` input.
 */
export function proposalVaultNote(payload: unknown): B.VaultNoteInput;

/**
 * [`zotero_import`](proposal_inputs::zotero_import): the paper fields a Zotero draft may set.
 */
export function proposalZoteroImport(payload: unknown): B.ProposalZoteroPaperInput;

/**
 * [`prune_layout`](pane::prune_layout): drop the tabs for which `exists` is false, then
 * collapse whatever that empties. Preview tabs are always kept.
 *
 * # Errors
 *
 * Fails if `layout` has the wrong shape, or rethrows what `exists` throws.
 */
export function pruneLayout(layout: B.PaneLayout, exists: (tab: B.TabRef) => boolean): B.PaneLayout;

/**
 * [`apply_step`] for JS (TS `pullApplyStep`).
 *
 * # Errors
 *
 * Fails when `facts` is not a pull fact set.
 */
export function pullApplyStep(facts: B.PullFacts): B.ApplyStep;

/**
 * [`summarize_pull`] for JS (TS `pullSummary`).
 *
 * # Errors
 *
 * Fails when `input` is not a pull summary input.
 */
export function pullSummary(input: B.PullSummaryInput): B.PullSummary;

/**
 * [`tombstone_step`] for JS (TS `pullTombstoneStep`).
 *
 * # Errors
 *
 * Fails when `facts` is not a pull fact set.
 */
export function pullTombstoneStep(facts: B.PullFacts): B.TombstoneStep;

/**
 * [`pump_route`] for JS (TS `pumpRoute`).
 *
 * # Errors
 *
 * Fails when `input` is not a pump input.
 */
export function pumpRoute(input: B.PumpRouteInput): B.PumpRoute;

/**
 * [`purge_failure_message`](account_purge::purge_failure_message): the error text when removals fail.
 */
export function purgeFailureMessage(failed: number, total: number): string;

/**
 * [`purges_objects`](account_purge::purges_objects): whether object removal runs.
 */
export function purgesObjects(provider: string, row_count: number): boolean;

/**
 * [`push_figure_step`]: `before` and `after` are the page's figure arrays;
 * `key` is the press number, or `null` when the edit is not from a press.
 */
export function pushFigureStep(history: B.PageHistory, before: readonly B.FigurePlacement[], after: readonly B.FigurePlacement[], key: number | null): B.PageHistory;

/**
 * [`push_ink_undo`](ink_undo::push_ink_undo).
 *
 * # Errors
 *
 * Fails if `state` or `entry` has the wrong shape.
 */
export function pushInkUndo(state: B.InkUndoState, entry: B.InkUndoEntry): B.InkUndoState;

/**
 * [`quantize_ink_path`]; `decimals` defaults to 2. Returns a plain JS number array.
 *
 * # Errors
 *
 * Fails only if the result cannot be converted to JS.
 */
export function quantizeInkPath(path: readonly number[], decimals?: number | null): number[];

/**
 * [`query_term_count`](hybrid_fusion::query_term_count).
 *
 * # Errors
 *
 * Fails if `terms` is not an array of strings.
 */
export function queryTermCount(terms: readonly string[]): number;

/**
 * [`quick_open_results`](quick::quick_open_results) as an array of `{ node, score, matched }`.
 *
 * # Errors
 *
 * Fails if `documents` is not an array of tree rows.
 */
export function quickOpenResults(documents: readonly B.WorkspaceTreeNode[], query: string): B.QuickOpenResult[];

/**
 * [`quote_awkward_labels`](markdown_mermaid_labels::quote_awkward_labels): quote labels Mermaid cannot parse.
 */
export function quoteAwkwardMermaidLabels(code: string): string;

/**
 * [`quote_ident`] (TS `quoteIdent`): the name in double quotes, embedded quotes doubled.
 */
export function quoteIdent(name: string): string;

/**
 * [`r2_blob_client_config`]. `null` when any R2 field is unset or empty.
 *
 * # Errors
 *
 * Fails if `fields` is not an object of optional strings, or the result cannot be converted to JS.
 */
export function r2BlobClientConfig(fields: B.R2Fields): B.BlobClientConfig | null;

/**
 * [`rail_group_text`](rail_group_text::rail_group_text). `group` is a `RailGroupWords`,
 * `visible` and `integrationTitles` are string arrays.
 *
 * # Errors
 *
 * Fails if an input cannot be read as the expected shape.
 */
export function railGroupText(group: B.RailGroupWords, visible: readonly string[], integration_titles: readonly string[]): B.RailGroupText;

/**
 * [`ramp_colour`](node_colouring::ramp_colour): a colour `t` of the way along the ramp.
 */
export function rampColour(t: number): string;

/**
 * [`pglite_sql::range_window`] (TS `rangeWindow`): `[limit, offset]` for an inclusive range.
 *
 * # Errors
 *
 * Returns an error if the result cannot be converted to JS.
 */
export function rangeWindow(from: number, to: number): number[];

/**
 * A copy of `candidates`, highest score first, then by title and id (`localeCompare` with
 * `"en"`). Returns the caller's own objects and does not mutate the input.
 *
 * # Errors
 *
 * Fails if `candidates` has the wrong shape.
 */
export function rankCitationAlerts(candidates: readonly (B.CitationSignals & { id: string; title: string })[]): (B.CitationSignals & { id: string; title: string })[];

/**
 * [`rank_filter_order`](rank_filter::rank_filter_order) as an array of indices
 * into `items`.
 *
 * # Errors
 *
 * Fails if `hit_entity_ids` is not an array of strings or `items` is not an
 * array of `{id, fallbackText}` records.
 */
export function rankFilterOrder(query: string, hit_entity_ids: readonly string[], items: readonly { id: string; fallbackText: string }[]): number[];

/**
 * [`wf_core::papers::open_access::rank_open_access_candidates`]: deduplicated, PDFs first.
 *
 * # Errors
 *
 * Fails if `candidates` is not a candidate list, or the result cannot be converted.
 */
export function rankOpenAccessCandidates(candidates: readonly B.OpenAccessCandidate[]): B.OpenAccessCandidate[];

/**
 * [`rating_in_range`](paper_update::rating_in_range) (TS `setRating`): whether the rating is 1 to 5.
 */
export function ratingInRange(rating: number): boolean;

/**
 * [`read_content_type`]: the stored type, or the fallback when none is stored.
 */
export function readContentType(stored?: string | null): string;

/**
 * [`read_failure_reason`]: why a read failed. `status` is the HTTP status when there was a response.
 */
export function readFailureReason(message: string, status?: number | null): string;

/**
 * [`wf_core::sync::frontmatter::read_frontmatter`] for JS, as `ParsedDocument`.
 *
 * # Errors
 *
 * Fails when `content` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function readFrontmatter(content: string): B.ParsedDocument;

/**
 * [`read_ink_chunk_header`](chunk::read_ink_chunk_header): the 16-byte header.
 *
 * # Errors
 *
 * Fails on a header the format refuses.
 */
export function readInkChunkHeader(bytes: Uint8Array): B.InkChunkHeader;

/**
 * [`wf_core::sync::ink_note::read_ink_note_body`] for JS, as `{ meta, text }`.
 *
 * # Errors
 *
 * Fails when `body` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function readInkNoteBody(body: string): { meta: B.InkNoteMeta; text: string };

/**
 * [`read_ink_note_meta`](wf_core::sync::ink_note::read_ink_note_meta) of a frontmatter
 * object (TS `readInkNoteMeta`).
 *
 * # Errors
 *
 * Fails if `frontmatter` is not a plain object.
 */
export function readInkNoteMeta(frontmatter: Readonly<Record<string, unknown>>): B.InkNoteMeta;

/**
 * [`read_ink_request`]: the page's request checked whole, or `null` when it is malformed.
 * Never throws, as the TS did not: input that is not convertible to JSON is `null` too.
 *
 * # Errors
 *
 * Fails only if the result cannot be converted to a JS value.
 */
export function readInkRequest(request: unknown): B.InkRecognitionRequest | null;

/**
 * [`read_mirror_base`](folder_mirror::read_mirror_base): the manifest's path-to-digest map.
 * `text` is the manifest text, or `undefined` when there is none.
 *
 * # Errors
 *
 * Fails only when the result cannot be turned into a JS object.
 */
export function readMirrorBase(text?: string | null): Record<string, string>;

/**
 * [`read_mirror_bases`](folder_mirror::read_mirror_bases): the manifest's note bases, by path.
 *
 * # Errors
 *
 * Fails only when the result cannot be turned into a JS object.
 */
export function readMirrorBases(text?: string | null): Record<string, B.VaultPageBase>;

/**
 * [`read_storage_config`]. `env` is a plain object of env name to string value; an
 * `undefined` value counts as unset.
 *
 * # Errors
 *
 * Fails if a set value in `env` is not a string, or the result cannot be converted to JS.
 */
export function readStorageConfig(env: Readonly<Record<string, string | undefined>>): B.StorageConfig;

/**
 * [`wf_core::sync::ink_note::readable_text`] for JS: a note's words, ink pages joined.
 *
 * # Errors
 *
 * Fails when `body` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function readableText(body: string): string;

/**
 * The reader's annotation constants: the `pending:` id prefix and the default highlight colour.
 *
 * # Errors
 *
 * Fails only if the result cannot be converted to a JS value.
 */
export function readerAnnotationConsts(): { pendingPrefix: string; defaultColor: string };

/**
 * [`reader_keyboard_command`]: the `ReaderKeyboardCommand` for `event`, or `null`
 * when the event passes through. Editable and Alt events always pass through. The modifier
 * fields read as `Boolean(field)`.
 *
 * # Errors
 *
 * Fails if `event` is not an object, or the result cannot be converted.
 */
export function readerKeyboardCommand(event: { key: string; code?: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; fromEditable?: boolean }): B.ReaderKeyboardCommand | null;

/**
 * [`reader_print_document`]: the paper as an HTML document for a print frame's `srcdoc`.
 */
export function readerPrintDocument(doc: B.ReaderPrintDocument): string;

/**
 * [`reader_print_orientation`]: `"portrait"` or `"landscape"` for the sheet.
 */
export function readerPrintOrientation(input: B.ReaderPrintLayoutInput): string;

/**
 * [`name_contains`](name_filter::name_contains): whether `name` contains `needle`, ignoring
 * case. An empty `needle` matches every name.
 */
export function readingListNameMatches(name: string, needle: string): boolean;

/**
 * [`reads_folder`](preview_folder::reads_folder).
 */
export function readsFolder(name: string, project_root: string, has_project_dir: boolean): boolean;

/**
 * [`recent_failure_ids`](library_index::recent_failure_ids): the paper ids still inside the
 * retry window, from a record of `{ paperId: failedAtMs }`. A value that is not a number is not
 * returned, the same as a `NaN` time.
 */
export function recentFailureIds(failures: Record<string, number>, now: number): string[];

/**
 * [`recently_approved_wiki_pages`]: the wiki's pages, newest first, capped at `limit`.
 */
export function recentlyApprovedWikiPages(pages: readonly B.WikiNote[], limit: number): B.RecentWikiPage[];

/**
 * [`recolour_nodes`](graph_colour::recolour_nodes): applies a graph-wide colour mode
 * (`year`, `degree`, `cluster`, `groups`) by writing each node's `color` in place. Other
 * modes leave the nodes as built.
 *
 * # Errors
 *
 * Fails if an argument has the wrong shape.
 */
export function recolourNodes(nodes: RecolourableNode[], links: readonly { source: string; target: string }[], color_by: string, groups: readonly { query: string; color: string }[], ctx: RecolourLookups): void;

/**
 * [`reconstruct_lines`] as an array of `TextLine`. A run is kept when its text is not JS-blank
 * and `keep(item)` (default: always) is truthy; `keep` runs only on non-blank runs.
 *
 * # Errors
 *
 * Fails if `items` is not an array of the expected shape, or rethrows what `keep` throws.
 */
export function reconstructLines(page: number, items: readonly { str: string; transform: number[]; width: number; height: number; hasEOL?: boolean; fontName?: string }[], keep?: (item: { str: string; transform: number[]; width: number; height: number; hasEOL?: boolean; fontName?: string }) => boolean): B.AnalysisTextLine[];

/**
 * [`rectangles_overlap`](analysis_text::rectangles_overlap) (TS `rectanglesOverlap`).
 */
export function rectanglesOverlap(a: readonly number[], b: readonly number[]): boolean;

/**
 * [`wf_core::error_report::redact::redact`] for JS, as `{ text, redactions }`.
 *
 * # Errors
 *
 * Fails when `input` is over the text cap.
 */
export function redact(input: string): B.Redacted;

/**
 * [`wf_core::error_report::redact::redact_and_cap`] for JS, as `{ text, redactions }`.
 * `limit` is in UTF-16 units, floored and clamped at 0 (JS `ToUint32` of it, as the old TS
 * wrapper passed it); absent, it is [`MAX_REPORT_CHARS`].
 *
 * # Errors
 *
 * Fails when `input` is over the text cap.
 */
export function redactAndCap(input: string, limit?: number | null): B.Redacted;

/**
 * [`redact_error_text`](error_redact::redact_error_text): the token and URL credentials removed,
 * capped at 500 UTF-16 units. An empty or missing token is ignored.
 */
export function redactOverleafErrorText(raw: string, token?: string): string;

/**
 * [`wf_core::sync::git_remote::redact_secret`] for JS.
 *
 * # Errors
 *
 * Fails when `text` or `secret` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function redactSecret(text: string, secret?: string | null): string;

/**
 * [`reference_cache_key`]: the store key of one bibliography entry within one document.
 */
export function referenceCacheKey(document_key: string, ref_index: number): string;

/**
 * [`reference_for_destination`](link_citations::reference_for_destination) (TS
 * `referenceForDestination`); `null` when no entry is found.
 *
 * # Errors
 *
 * Fails if `dest` or `refs` do not have the expected shape.
 */
export function referenceForDestination(dest: B.AnalysisLinkDest, refs: readonly B.AnalysisParsedReference[]): B.AnalysisParsedReference | null;

/**
 * [`lookup_attempts`]: the forms a bibliography entry is offered in, strongest first. Returns
 * `{ kind, value, hints? }[]`; an empty list means the entry is unresolved.
 *
 * # Errors
 *
 * Fails if `entry` is not a `{ doi, arxivId, title, year, firstAuthor }` object.
 */
export function referenceLookupAttempts(entry: { doi?: string; arxivId?: string; title?: string; year?: number; firstAuthor?: string }): { kind: "doi" | "arxiv" | "bibliographic"; value: string; hints?: B.ReferenceHints }[];

/**
 * [`reference_ref`]: the paper reference a bibliography entry resolves by.
 */
export function referenceRef(entry: unknown): { kind: "doi"; value: string } | { kind: "arxiv"; value: string } | { kind: "bibliographic"; value: string; hints: { title?: string; year?: number; firstAuthor?: string } };

/**
 * [`refresh_ink_undo_annotation`](ink_undo::refresh_ink_undo_annotation).
 *
 * # Errors
 *
 * Fails if `state` or `annotation` has the wrong shape.
 */
export function refreshInkUndoAnnotation(state: B.InkUndoState, annotation: T.ReaderAnnotation): B.InkUndoState;

/**
 * [`rekey_manifest_text`](folder_mirror::rekey_manifest_text). `undefined` when `text` is not a
 * JSON object.
 */
export function rekeyManifestText(text: string, old: string, root: string): string | undefined;

/**
 * [`related_by_ppr`](personalized_pagerank::related_by_ppr): the top `limit` neighbours
 * (default 10, with JS `slice` semantics), best first, excluding the seed.
 *
 * # Errors
 *
 * Fails if `graph` or `options` has the wrong shape.
 */
export function relatedByPpr(graph: { nodes: string[]; edges: Map<string, string[]> }, seed: string, limit: number | null | undefined, options?: { numWalks?: number; maxSteps?: number; damping?: number; rng?: () => number }): B.RelatedNode[];

/**
 * [`related_concepts`](graph_tags::related_concepts): the top `limit` tags seen beside `name`.
 *
 * # Errors
 *
 * Fails if `papers` or `notes` has the wrong shape.
 */
export function relatedConcepts(name: string, papers: readonly B.TaggedPaper[], notes: readonly B.TaggedNote[], limit: number): [string, number][];

/**
 * [`relation_titles`](extraction_keys::relation_titles): the related papers' titles joined by
 * `, `, with an unknown id shown as itself.
 *
 * # Errors
 *
 * Fails if `ids` is not an array of strings or `titles` is not a map (or object) of strings.
 */
export function relationTitles(ids: readonly string[], titles: ReadonlyMap<string, string>): string;

/**
 * [`wf_core::sync::blob_links::relative_asset_paths`] for JS, as `[{ scope, path }]`.
 *
 * # Errors
 *
 * Fails when `body` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function relativeAssetPaths(body: string): B.RelativeAsset[];

/**
 * [`relay_path`] (TS `relayPath`): the route path inside a relay URL, or `url` unchanged.
 */
export function relayPath(base: string | null | undefined, url: string): string;

/**
 * [`relay_url`] (TS `relayUrl`): the base joined to `path`, or `path` when `base` is absent.
 */
export function relayUrl(base: string | null | undefined, path: string): string;

/**
 * [`remember_search_query`](search_history::remember_search_query): prepend a query,
 * most-recent first. `max` defaults to [`MAX_SEARCH_HISTORY`](search_history::MAX_SEARCH_HISTORY).
 */
export function rememberSearchQuery(history: readonly string[], query: string, max?: number | null): string[];

/**
 * [`remove_hashtag_from_body`](note_tags::remove_hashtag_from_body).
 */
export function removeHashtagFromBody(body: string, tag: string): string;

/**
 * [`rename_ink_undo_id`](ink_undo::rename_ink_undo_id).
 *
 * # Errors
 *
 * Fails if `state` has the wrong shape.
 */
export function renameInkUndoId(state: B.InkUndoState, from: string, to: string): B.InkUndoState;

/**
 * [`rename_sources`](folder_diff::rename_sources) over the parsed entities and the
 * folder and current texts by path. Returns new path to old path.
 *
 * # Errors
 *
 * Fails if the inputs do not match the shape, or the result cannot be serialized.
 */
export function renameSources(parsed: readonly B.FolderParsedEntity[], folder: Readonly<Record<string, string>>, current: Readonly<Record<string, string>>): Record<string, string>;

/**
 * [`renamed_paths`](outside_edits::renamed_paths) over `seen` and the diff's `paths`.
 *
 * # Errors
 *
 * Fails if the inputs do not match the shape, or the result cannot be serialized.
 */
export function renamedOutsidePaths(seen: Readonly<Record<string, B.OutsideSeenFile>>, paths: readonly string[]): string[];

/**
 * [`render_template`](tpl::render_template).
 *
 * # Errors
 *
 * Fails if the context is not a plain object.
 */
export function renderTemplate(template: string, context_value: Record<string, unknown>): string;

/**
 * [`reorder_figure_indices`](figure::reorder_figure_indices): the new order of `len` figures as
 * old indices, with the one at `index` moved by `step`.
 *
 * # Errors
 *
 * Fails if `step` is not a known step.
 */
export function reorderFigureIndices(len: number, index: number, step: B.FigureOrderStep): number[];

/**
 * [`reordered_ids`]: `ids` with `dragId` moved into `targetId`'s place, or `null`.
 */
export function reorderedIds(ids: readonly string[], drag_id: string, target_id: string): string[] | null;

/**
 * [`replace_vault_asset_paths`](page::replace_vault_asset_paths): `body` with each
 * `vault:{oldPath}` rewritten to `vault:{newPath}`, in order.
 *
 * # Errors
 *
 * Fails if `rewrites` is not a list of `{ oldPath, newPath }` strings.
 */
export function replaceVaultAssetPaths(body: string, rewrites: readonly { oldPath: string; newPath: string }[]): string;

/**
 * [`replace_wiki_index`](wiki_index::replace_wiki_index).
 */
export function replaceWikiIndex(body: string, index: string): string;

/**
 * [`repo_query::repo_step`]: what `repo.method` does next, given its arguments and the
 * replies to the queries it already sent.
 *
 * # Errors
 *
 * Fails if `args` or `replies` is not an array, `ctx` is not a `RepoCtx`, or the step cannot
 * be converted to JS.
 */
export function repoStep(repo: string, method: string, args: unknown[], ctx: B.RepoCtx, replies: unknown[]): B.RepoStep;

/**
 * [`repo_web_url`](repo_web_url::repo_web_url): the trimmed repo URL when it is
 * http(s), otherwise `undefined`.
 */
export function repoWebUrl(repo_url?: string | null): string | undefined;

/**
 * [`wf_core::error_report::issue_url::report_markdown`] for JS.
 *
 * # Errors
 *
 * Fails when `input` is not a valid `ReportMarkdown` object, or its text is over the cap.
 */
export function reportMarkdown(input: B.ReportMarkdown): string;

/**
 * [`wf_core::error_report::report_repo::report_repo`] for JS: the configured
 * `owner/repo`, or the default when it is missing or malformed.
 */
export function reportRepo(configured?: string | null): string;

/**
 * [`validate_report_section_input`](report_section::validate_report_section_input): the
 * validation message, or `null` when the input is valid.
 *
 * # Errors
 *
 * Fails if `input` has the wrong shape.
 */
export function reportSectionInputError(input: B.NewReportSectionInput): string | null;

/**
 * [`resample_ink_stroke`] as `{ points, pressures }`.
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 */
export function resampleInkStroke(points: readonly number[], pressures: readonly number[], spacing?: number | null): B.PackedInkStroke;

/**
 * [`resize_figure_box`](figure::resize_figure_box): a box resized by dragging `handle`; a corner
 * keeps the aspect unless `options.free`; no side under `options.min` (30).
 *
 * # Errors
 *
 * Fails if `rect`, `handle` or `options` has the wrong shape.
 */
export function resizeFigureBox(rect: B.FigureRect, handle: B.FigureHandle, dx: number, dy: number, options?: { free?: boolean; min?: number }): B.FigureRect;

/**
 * `new URL(href, base).toString()`; `null` where the constructor would throw.
 */
export function resolveAbsoluteUrl(href: string, base: string): string | null;

/**
 * [`resolve_annotation_conflict`] for a row and a choice string (any other choice merges).
 *
 * # Errors
 *
 * Fails if `row` is not a `ZoteroAnnotationSyncRow` object.
 */
export function resolveAnnotationConflict(row: B.ZoteroAnnotationSyncRow, choice: string): B.ZoteroAnnotationLocal | null;

/**
 * [`resolve_artifact_refs_markdown`](artifact_markdown::resolve_artifact_refs_markdown)
 * (TS `resolveArtifactRefsMarkdown`). `now_ms` defaults to `Date.now()`.
 *
 * # Errors
 *
 * Fails if `experiments` is not a list of experiment objects.
 */
export function resolveArtifactRefsMarkdown(body: string, experiments: readonly B.ReportExperiment[], now_ms?: number | null): string;

/**
 * [`wf_core::papers::open_access::resolve_arxiv_id`]: the arXiv id to ask about.
 */
export function resolveArxivId(arxiv_id?: string | null, doi?: string | null): string | undefined;

/**
 * [`resolve_cite_key`](cite_key::resolve_cite_key) (TS `resolveCiteKey`): a paper's preferred
 * cite key, without uniqueness suffixing. Never empty.
 *
 * # Errors
 *
 * Fails if `paper.id` is not a string.
 */
export function resolveCiteKey(paper: { id: string; doi?: string; arxivId?: string; bibtex?: string; metadata?: Record<string, unknown> }): string;

/**
 * [`resolve_display_role`](member::resolve_display_role). `opts.ownsOrg` defaults to `false`.
 *
 * # Errors
 *
 * Fails if `opts` has the wrong shape.
 */
export function resolveDisplayRole(role: string, opts: { inLab: boolean; ownsOrg?: boolean }): string;

/**
 * [`resolve_ink_page_order`](ink_page::resolve_ink_page_order): the reconciled page order.
 *
 * # Errors
 *
 * Fails if either list is not an array of strings.
 */
export function resolveInkPageOrder(declared: readonly string[], present: readonly string[]): string[];

/**
 * [`resolve_integration_config`]. `env` is the five `NEXT_PUBLIC_*` provider values, `ids`
 * the registered ids per kind.
 *
 * # Errors
 *
 * Fails if an argument has the wrong shape, or the result cannot be converted to JS.
 */
export function resolveIntegrationConfig(env: B.IntegrationEnv, ids: B.ProviderIds): B.IntegrationConfig;

/**
 * [`resolve_join_assignment`](org::resolve_join_assignment). Returns `{ role, supervisorId }`.
 *
 * # Errors
 *
 * Fails with the message if the lab cannot take this invite type.
 */
export function resolveOrgJoinAssignment(target_role: string, professor_ids: readonly string[], phd_ids: readonly string[], professor_supervisor_id?: string | null, phd_supervisor_id?: string | null): B.JoinAssignment;

/**
 * [`resolve_paper_pdf_url`]: `source` is `{ url, arxivId, openAccessPdf }`, each optional.
 * Unknown fields such as `pdfPath` are ignored, as the TS version ignores them. Returns `null`
 * when no URL can be derived.
 *
 * # Errors
 *
 * Fails if `source` is not an object of strings or `null`.
 */
export function resolvePaperPdfUrl(source: { url?: string | null; arxivId?: string | null; openAccessPdf?: string | null }): string | null;

/**
 * [`resolve_position_selector`] as `{ start, end }`, or `null` when unusable.
 *
 * # Errors
 *
 * Fails if `position` is not a position selector object.
 */
export function resolvePositionSelector(text: string, position: B.AnchorPositionSelector): { start: number; end: number } | null;

/**
 * [`resolve_related_paper_url`](related_paper_url::resolve_related_paper_url) (TS
 * `resolveRelatedPaperUrl`): the hit's url, else its DOI link, else its arXiv page, else
 * `undefined`.
 *
 * # Errors
 *
 * Fails if `hit` is not an object of optional strings.
 */
export function resolveRelatedPaperUrl(hit: { url?: string; doi?: string; arxivId?: string }): string | undefined;

/**
 * [`resolve_results_tables`](results_table_refs::resolve_results_tables) (TS
 * `resolveResultsTables`). `format` is `"latex"` for the figure block, anything else for the
 * Markdown table.
 *
 * # Errors
 *
 * Fails if `experiments` is not a list of experiment objects.
 */
export function resolveResultsTables(body: string, experiments: readonly { id: string; name: string; metrics?: Record<string, unknown> | null }[], format: "latex" | "markdown"): string;

/**
 * [`resolve_supervisor_id`](member::resolve_supervisor_id).
 */
export function resolveSupervisorId(creator_id: string): string;

/**
 * [`resolve_text_anchor`] as `{ start, end, via, confidence }`, or `null`.
 *
 * # Errors
 *
 * Fails if `locus` is not a locus object.
 */
export function resolveTextAnchor(text: string, locus: B.AnchorPdfLocus): { start: number; end: number; via: B.AnchorVia; confidence: B.AnchorConfidence } | null;

/**
 * [`resolve_viewport_scale`] (TS `resolveViewportScale`); `state` is `{ scale, fit, rotation }`.
 *
 * # Errors
 *
 * Fails if an argument is not an object of the expected shape.
 */
export function resolveViewportScale(state: Pick<B.ReaderViewportState, "scale" | "fit" | "rotation">, page: B.ReaderPageSize, container: B.ReaderContainerSize): number;

/**
 * [`resolve_with_row`] for JS (TS `resolveWithRow`). `picks` maps a field to `"local"` or
 * `"remote"`; `overrides` is a row, or absent (`null`/`undefined`) for none.
 *
 * # Errors
 *
 * Fails when a row or `picks` is not a plain object, or a pick is not `"local"`/`"remote"`.
 */
export function resolveWithRow(base: Record<string, unknown>, local: Record<string, unknown>, remote: Record<string, unknown>, picks: Record<string, "local" | "remote">, overrides?: Record<string, unknown> | null): Record<string, unknown>;

/**
 * Every mapped resource type, in table order.
 *
 * # Errors
 *
 * Fails only if the result cannot be serialized.
 */
export function resourceTypes(): string[];

/**
 * The message of a non-ok response: the server's words or `fallback`, then the context (`responseErrorText`).
 */
export function responseErrorText(server_message: unknown, fallback: string, context: string, origin: string | null, session_lost: boolean): string;

/**
 * [`results_table`](experiment_status::results_table): the header and rows of the runs table.
 *
 * # Errors
 *
 * Fails if `experiments` is not an array of run objects, or the result cannot be serialised.
 */
export function resultsTable(experiments: readonly B.Experiment[]): B.ResultsTable;

/**
 * [`retrieve_ai_excerpts`](retrieval::retrieve_ai_excerpts). `options` is an object; a missing
 * `options` or `{}` takes the defaults.
 *
 * # Errors
 *
 * Fails if `documents` or `options` has the wrong shape.
 */
export function retrieveAiExcerpts(documents: readonly B.AiRetrievalDocument[], query: string, options?: { limit?: number; maxChars?: number }): B.AiRetrievedExcerpt[];

/**
 * [`retry_fuzziness_for_term`](search_retry::retry_fuzziness_for_term).
 */
export function retryFuzzinessForTerm(term: string, retry: boolean): number;

/**
 * [`reviewers`](screening::reviewers) (TS `reviewers`): everyone who recorded a decision,
 * distinct reviewer ids sorted in UTF-16 order.
 *
 * # Errors
 *
 * Fails if `decisions` has the wrong shape.
 */
export function reviewers(decisions: readonly B.ScreeningDecision[]): string[];

/**
 * [`rewrite_mcp_config`](mcp_config_rewrite::rewrite_mcp_config) as `{ changed, config }`.
 *
 * # Errors
 *
 * Fails when `launch` is not an object with `command`, `args` and `env`.
 */
export function rewriteMcpConfig(config: unknown, key: "mcpServers" | "servers", launch: { command: string; args: string[]; env: Record<string, string> }): { changed: boolean; config: unknown };

/**
 * [`rewrite_wikilinks`](import_links::rewrite_wikilinks): rewrite `[[Old]]`, `[[Old|alias]]` and
 * `[[Old#heading]]` when import renamed `Old`. `renames` maps a normalised old title to its new
 * title.
 *
 * # Errors
 *
 * Fails if `renames` is not a map of strings to strings.
 */
export function rewriteWikilinks(body: string, renames: ReadonlyMap<string, string>): string;

/**
 * [`role_rank`](member::role_rank). `undefined` for a role the rank table does not know.
 */
export function roleRank(role: string): number | undefined;

/**
 * [`root_folder_id_of`](upload::root_folder_id_of): the writable project's root folder id, or
 * `null` when read-only or the answer has none.
 *
 * # Errors
 *
 * Fails if `join` is not an array of JSON values.
 */
export function rootFolderIdOf(join: readonly unknown[]): string | null;

/**
 * [`root_key`](edit::root_key).
 *
 * # Errors
 *
 * Fails if the argument is not an editable root, or the result cannot be serialised.
 */
export function rootKey(root: B.EditableRoot): string;

/**
 * [`root_of`](edit::root_of).
 *
 * # Errors
 *
 * Fails if the node does not have the expected shape, or the result cannot be serialised.
 */
export function rootOf(node: B.WorkspaceTreeNode): B.EditableRoot | null;

/**
 * [`root_of_kind`](edit::root_of_kind). `kind` is a snake_case tree kind name.
 *
 * # Errors
 *
 * Fails if the result cannot be serialised.
 */
export function rootOfKind(kind: string): B.EditableRoot | null;

/**
 * [`root_verdict`](vault_search::root_verdict) as `"notADirectory" | "existing" | "empty" | "notEmpty"`.
 */
export function rootVerdict(is_dir: boolean, entries: string[], meta_dir: string): string;

/**
 * [`row_slots`](window::row_slots). `viewport` is `null` before measuring,
 * `pinned` is an array of row indices, `metrics` the TS row constants.
 *
 * # Errors
 *
 * Fails if an argument does not have the expected shape, or the result cannot be serialised.
 */
export function rowSlots(count: number, viewport: B.ExplorerViewport | null, pinned: readonly number[], metrics: B.RowMetrics): B.RowSlot[];

/**
 * [`rows_for_height`](fit::rows_for_height): grid rows that show `px` of card.
 */
export function rowsForHeight(px: number, row_height: number, margin: number): number;

/**
 * [`s2_nested_fields`](related_paper_hit::s2_nested_fields): the S2 field list for a nested paper.
 */
export function s2NestedFields(key: string): string;

/**
 * [`s2_paper_id`](semantic_scholar_citation::s2_paper_id): the Semantic Scholar id for a reference.
 *
 * # Errors
 *
 * Fails if `reference` has the wrong shape.
 */
export function s2PaperId(reference: B.PaperRef): string;

/**
 * [`s2_to_hit`](related_paper_hit::s2_to_hit): the hit for a Semantic Scholar paper, or `null`
 * when it has no title.
 *
 * # Errors
 *
 * Fails if `paper` cannot be read as a Semantic Scholar paper object.
 */
export function s2ToHit(paper: unknown): B.RelatedPaperHitRow | null;

/**
 * [`safe_artifact_caption`](artifact_markdown::safe_artifact_caption) (TS `safeArtifactCaption`).
 * `undefined` or `null` counts as no caption.
 */
export function safeArtifactCaption(alt?: string | null | undefined): string;

/**
 * [`safe_image_destination`](artifact_markdown::safe_image_destination) (TS `safeImageDestination`).
 * `null` when the URL is not allowed.
 */
export function safeImageDestination(url: string): string | null;

/**
 * [`safe_label`](untrusted_context::safe_label).
 */
export function safeLabel(label: string, nonce: string): string;

/**
 * [`safe_name`](experiment_artifacts::safe_name).
 */
export function safeName(name: string): string;

/**
 * [`safe_relative`]: the normalised path inside the build directory.
 *
 * # Errors
 *
 * Throws an `Error` with the refusal message when the path leaves the build directory or names a
 * latexmk rc file.
 */
export function safeRelative(candidate: string): string;

/**
 * [`wf_core::workspace::safe_workspace_path`] for JS.
 *
 * # Errors
 *
 * Fails when `path` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units, or when the
 * path could leave the workspace root (`Unsafe workspace path: <path>`).
 */
export function safeWorkspacePath(path: string): string;

/**
 * [`same_manifest_ignoring_stamp`](mirror_manifest::same_manifest_ignoring_stamp).
 */
export function sameManifestIgnoringStamp(current: string, next: string): boolean;

/**
 * [`same_origin`](ipc_origin::same_origin): whether `url` is the same origin as `origin`.
 */
export function sameOrigin(url: string, origin: string): boolean;

/**
 * [`same_palette`]: whether two palettes draw the same.
 *
 * # Errors
 *
 * Throws if `a` or `b` is not a palette object.
 */
export function samePalette(a: Readonly<Record<string, readonly [number, number, number]>>, b: Readonly<Record<string, readonly [number, number, number]>>): boolean;

/**
 * [`same_peers`](collab::same_peers).
 *
 * # Errors
 *
 * Fails when either list is not a list of peers.
 */
export function samePeers(a: readonly B.Peer[], b: readonly B.Peer[]): boolean;

/**
 * [`same_row`] for JS (TS `sameRow`).
 *
 * # Errors
 *
 * Fails when a row is not a plain object.
 */
export function sameRow(a: Record<string, unknown>, b: Record<string, unknown>): boolean;

/**
 * [`wf_core::sync::merge::same_value`] for JS.
 *
 * # Errors
 *
 * Fails when a value is not JSON.
 */
export function sameValue(a: any, b: any): boolean;

/**
 * [`sanitize_app_href`]: a same-origin app path on a known root, or `None`.
 */
export function sanitizeAppHref(raw?: string | null | undefined): string | null;

/**
 * [`sanitize_pdf_url`]: `null` when the URL is refused.
 */
export function sanitizePdfUrl(raw?: string | null | undefined): string | null;

/**
 * [`sanitize_reader_href`]: a same-origin `/reader` path, or `None`.
 */
export function sanitizeReaderHref(raw?: string | null | undefined): string | null;

/**
 * [`sanitize_section_targets`](overleaf::sanitize_section_targets); `null` when malformed.
 *
 * # Errors
 *
 * Fails if `input` cannot be read as JSON.
 */
export function sanitizeSectionTargets(input: unknown): Record<string, number> | null;

/**
 * [`scope_notes`](page::scope_notes) (TS `scopeNotes`): the indices of the notes that pass the
 * list and tag filters. `membership` is an object of list id to an array of note ids.
 *
 * # Errors
 *
 * Fails if an argument has the wrong shape.
 */
export function scopeNoteIndices(notes: readonly unknown[], listFilter: readonly string[], tagFilter: readonly string[], membership: Readonly<Record<string, readonly string[]>>): number[];

/**
 * [`screen_cache_policy`] as `{ revalidateAfterMs, showMaxAgeMs }`. The TS callers read it at call
 * time (after init), so the TS side has no constants of its own.
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 */
export function screenCachePolicy(): B.ScreenCachePolicy;

/**
 * [`screen_for_path::screen_for_path`]: the screen cache id for a pathname, or `null`.
 */
export function screenForPath(pathname: string): string | null;

/**
 * [`screen_point_to_pdf`] as `{ x, y }` (TS `screenPointToPdf`).
 *
 * # Errors
 *
 * Fails if `p` is not a page projection object.
 */
export function screenPointToPdf(sx: number, sy: number, p: B.ReaderPageProjection): { x: number; y: number };

/**
 * [`decision_error`](screening::decision_error) (TS `screeningDecisionError`): why `next` may
 * not be recorded after `existing`, or `null` when it may.
 *
 * # Errors
 *
 * Fails if `next` or `existing` has the wrong shape.
 */
export function screeningDecisionError(next: B.ScreeningDecisionDraft, existing: readonly B.ScreeningDecision[]): string | null;

/**
 * [`decision_from_row`](screening::decision_from_row) (TS `PostgrestScreeningRepository`
 * `toDomain`): a stored `screening_decisions` row as a decision.
 *
 * # Errors
 *
 * Fails if `row` has the wrong shape, or its stage or state is not one the enums know.
 */
export function screeningDecisionFromRow(row: B.ScreeningDecisionRow): B.ScreeningDecision;

/**
 * [`decision_to_row`](screening::decision_to_row) (TS `PostgrestScreeningRepository`
 * `record`): a decision as the `screening_decisions` row the table takes.
 *
 * # Errors
 *
 * Fails if `decision` has the wrong shape.
 */
export function screeningDecisionToRow(decision: B.ScreeningDecision): B.ScreeningDecisionRow;

/**
 * [`search_matches`](vault_search::search_matches): the matching lines of a file, cut for display.
 */
export function searchMatches(text: string, query: string): string[];

/**
 * [`search_revision`](search_document::search_revision).
 *
 * # Errors
 *
 * Fails if `docs` is not an array of search documents.
 */
export function searchRevision(docs: readonly { readonly id: string; readonly kind: B.SearchKind; readonly entityId: string; readonly title: string; readonly aliases: readonly string[]; readonly headings: readonly string[]; readonly tags: readonly string[]; readonly path: string; readonly body: string; readonly updatedAt: string; readonly href: string; readonly page?: number; readonly degree: number }[]): string;

/**
 * [`search_text_from_items`](analysis_text::search_text_from_items) (TS `searchTextFromItems`).
 *
 * # Errors
 *
 * Fails if `items` is not an array of text items.
 */
export function searchTextFromItems(items: readonly B.AnalysisPdfItem[]): B.AnalysisSearchText;

/**
 * [`section_progress`](section_progress::section_progress) (TS `sectionProgress`).
 *
 * # Errors
 *
 * Fails if `node` is not a section tree node.
 */
export function sectionProgress(node: B.ReportSectionTreeNode): B.SectionProgress;

/**
 * [`seed_doi`](related_paper_hit::seed_doi): the seed's DOI, or the arXiv DOI, or `undefined`.
 */
export function seedDoi(doi?: string | null, arxiv_id?: string | null): string | undefined;

/**
 * [`seen_files`](folder_diff::seen_files) over the folder and current texts, the
 * base digests by path, and the renames from [`renameSources`].
 *
 * # Errors
 *
 * Fails if the inputs do not match the shape, or the result cannot be serialized.
 */
export function seenFiles(folder: Readonly<Record<string, string>>, current: Readonly<Record<string, string>>, base: Readonly<Record<string, string>>, renamed: Readonly<Record<string, string>>): Record<string, B.FolderSeenFile>;

/**
 * [`segment_ink_lines`] over the caller's stroke objects: a page's pen strokes
 * grouped into lines, top to bottom (each line holding the caller's own stroke
 * objects), and the line each input stroke went into (`-1` for none). A stroke
 * whose `tool` is not `"pen"` is skipped; a missing `t0` reads as NaN.
 *
 * # Errors
 *
 * Throws if a stroke cannot be read or `options` is not an options object.
 */
export function segmentInkLines(strokes: readonly T.ReadonlyInkStroke[], options?: { windowMs?: number; bandRatio?: number }): { lines: { strokes: B.InkStroke[]; yBand: [number, number] }[]; lineOfStroke: number[] };

/**
 * [`rules::segments_for`].
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 */
export function segmentsFor(kind: string): readonly B.StatusSegment[];

/**
 * [`select_model_provider`](model_router::select_model_provider); a refusal throws its message as text.
 *
 * # Errors
 *
 * Fails if `providers` is not a list of `{ provider, available }`, or the selection is refused.
 */
export function selectModelProvider(providers: readonly B.ModelProviderAvailability[], selected: string): string;

/**
 * [`selected_pdf_pages`](pdf_pages::selected_pdf_pages) as an array of page numbers.
 *
 * # Errors
 *
 * Fails only if the result cannot be serialised.
 */
export function selectedPdfPages(answer: string, count: number): number[];

/**
 * [`selected_text`](page_math::selected_text): the text of the lines the chosen strokes
 * belong to, one per line.
 *
 * # Errors
 *
 * Fails if `lines` is not an array of lines or `indices` is not an array of numbers.
 */
export function selectedText(lines: readonly B.TextLine[], indices: readonly number[]): string;

/**
 * [`selection_to_anchor`] as a `CombinedPdfAnchor`, or `null` when the selection is empty or out of range.
 * The anchor always carries a `contentHash` key, `undefined` when the page has none (as the TS copy did).
 *
 * # Errors
 *
 * Fails if `selection` or `page` is not the expected object shape, or the result cannot be converted.
 */
export function selectionToAnchor(selection: B.SelectionTextRange, page: Omit<B.SelectionPageTextGeometry, "items"> & { items?: readonly B.SelectionPageTextItem[] }): T.CombinedPdfAnchor | null;

/**
 * [`semantic_scholar_identifier_url`](source_requests::semantic_scholar_identifier_url) (TS `SemanticScholarMetadataSource`, DOI and arXiv).
 */
export function semanticScholarIdentifierUrl(base: string, kind: string, value: string): string;

/**
 * [`semantic_scholar_match_url`](source_requests::semantic_scholar_match_url) (TS `SemanticScholarMetadataSource`, title match).
 */
export function semanticScholarMatchUrl(base: string, query: string): string;

/**
 * [`retry_wait_ms`](semantic_scholar_retry::retry_wait_ms): the wait before the next attempt.
 */
export function semanticScholarRetryWaitMs(attempt: number): number;

/**
 * [`should_retry`](semantic_scholar_retry::should_retry): `status` is `undefined` for a thrown network error.
 */
export function semanticScholarShouldRetry(status: number | null | undefined, attempt: number): boolean;

/**
 * [`semantic_scholar_target`](semantic_scholar_relay::semantic_scholar_target): the upstream
 * URL for a relay path, or `null` when the path is not one.
 */
export function semanticScholarTarget(pathname: string, search: string): string | null;

/**
 * [`semantic_scholar_to_metadata`] (TS `semanticScholarToMetadata`). A Semantic Scholar paper
 * as a paper.
 *
 * # Errors
 *
 * Fails if `paper` is not a Semantic Scholar paper.
 */
export function semanticScholarToMetadata(paper: B.SemanticScholarPaper): B.ZoteroPaperInput;

/**
 * [`semantic_status_text`](semantic_status_text::semantic_status_text). `status` is a
 * `SemanticStatus` (tagged by `phase`).
 *
 * # Errors
 *
 * Fails if `status` cannot be read as the expected shape.
 */
export function semanticStatusText(status: B.SemanticStatus): string;

/**
 * [`send_advance`] for JS: the next step after a read answered, from the `state` that `sendStart` gave.
 *
 * # Errors
 *
 * Fails when `state` is not a read state or the result cannot be serialised.
 */
export function sendAdvance(state: unknown, status: number, body: string): { next: "done"; outcome: unknown } | { next: "read"; request: { method: string; path: string; body?: string; prefer?: string }; state: unknown };

/**
 * [`send_start`] for JS: the outcome of one write, or the first read it needs.
 *
 * # Errors
 *
 * Fails when the result cannot be serialised.
 */
export function sendStart(status: number, body: string, op: string, table: string, row_id: string): { next: "done"; outcome: unknown } | { next: "read"; request: { method: string; path: string; body?: string; prefer?: string }; state: unknown };

/**
 * [`serialise_artifact_ref`](artifact_refs::serialise_artifact_ref) (TS `serialiseArtifactRef`).
 *
 * # Errors
 *
 * Fails if `artifact_ref` has the wrong shape.
 */
export function serialiseArtifactRef(artifact_ref: B.ArtifactRef): string;

/**
 * [`serialise_results_table_ref`](results_table_refs::serialise_results_table_ref) (TS
 * `serialiseResultsTableRef`).
 *
 * # Errors
 *
 * Fails if `experiment_ids` is not a list of strings.
 */
export function serialiseResultsTableRef(experiment_ids: readonly string[], caption?: string | null): string;

/**
 * [`wf_core::sync::serialize::serialize_workspace`] for JS: the project's folder-mirror files
 * for a snapshot, as `{ files: { [path]: content }, assets }`.
 *
 * # Errors
 *
 * Fails when the snapshot cannot be stringified or read, or the project id or name is over
 * `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function serializeWorkspace(snapshot: object, project: { id: string; name: string }): { files: Record<string, string>; assets: B.SerializedAsset[] };

/**
 * [`session_action`] for JS (TS `sessionAction`): `"idle"`, `"adopt"`, `"drive"` or `"foreign"`.
 */
export function sessionAction(signed_in_user_id?: string | null, adopted_account_id?: string | null): "idle" | "adopt" | "drive" | "foreign";

/**
 * [`db_claims::session_claims`]: the `request.jwt.claims` JSON; `null`/`undefined` or `""` gives `anon`.
 */
export function sessionClaims(user_id?: string | null): string;

/**
 * [`set_image_placement`](markdown_image_width::set_image_placement): rewrite the `ordinal`-th
 * image whose alt is `alt` to the patched placement.
 *
 * # Errors
 *
 * Fails if `body` or `alt` is too long, or `patch` has the wrong shape.
 */
export function setImagePlacement(body: string, alt: string, ordinal: number, patch: B.ImagePlacementPatch): string;

/**
 * [`set_ratio`](pane::set_ratio). `target` is the split being resized.
 *
 * # Errors
 *
 * Fails if `layout` or `target` has the wrong shape.
 */
export function setRatio(layout: B.PaneLayout, target: B.PaneSplit, ratio: number): B.PaneLayout;

/**
 * [`set_tab_mode`](pane::set_tab_mode). `mode` is `"edit"`, `"read"` or `"ink"`.
 *
 * # Errors
 *
 * Fails if an argument has the wrong shape.
 */
export function setTabMode(layout: B.PaneLayout, target: B.TabRef, mode: B.DocumentMode): B.PaneLayout;

/**
 * [`settings_palette_rows`](menu_palette::settings_palette_rows): the Settings rows the bridge backs.
 *
 * # Errors
 *
 * Fails if the result cannot be converted to JS.
 */
export function settingsPaletteRows(has_plan_widget: boolean, has_ink: boolean): { key: string; label: string; path: string }[];

/**
 * [`settle_conflict`](folder_merge::settle_conflict). `resolutions` maps each conflicted path to
 * its resolution. `undefined` when the entry settles to nothing (markers, or kept as it is).
 *
 * # Errors
 *
 * Fails when `entry` or `resolutions` is not the shape the folder import produces.
 */
export function settleConflict(entry: B.ImportDiffEntry, resolutions: Readonly<Record<string, B.ConflictResolution>>): B.ImportDiffEntry | undefined;

/**
 * [`settle_plan`] for JS (TS `settleConflictPlan`). `kind` is `"edit"`, `"deleted_remote"` or
 * `"deleted_local"`. Returns `{ action, ... }`.
 *
 * # Errors
 *
 * Fails when `kind` is not one of those strings or a row is not a plain object.
 */
export function settleConflictPlan(kind: "edit" | "deleted_remote" | "deleted_local", base: Record<string, unknown>, local: Record<string, unknown>, remote: Record<string, unknown>): B.ConflictSettlePlan;

/**
 * [`settle_external`](settle_external::settle_external) on
 * `{ entries, reasons, only, external, externalReasons }`, returning
 * `{ external, externalReasons }`.
 *
 * # Errors
 *
 * Fails if the input does not match the shape, or the result cannot be serialized.
 */
export function settleExternal(input: { entries: { action: B.ImportAction; path: string }[]; reasons: Readonly<Record<string, B.HeldReason>>; only?: readonly string[] | null; external: readonly string[]; externalReasons: Readonly<Record<string, B.HeldReason>> }): { external: string[]; externalReasons: Record<string, B.HeldReason> };

/**
 * [`shape_proposal_draft`](proposal_draft::shape_proposal_draft): the pending proposal to save.
 *
 * # Errors
 *
 * Fails with `A proposal needs a preview describing what it will do.` for blank content, or when the input is malformed.
 */
export function shapeAiProposalDraft(input: B.ProposalDraftInput): B.ProposalDraft;

/**
 * [`share_allows_comment`](sharing::share_allows_comment).
 *
 * # Errors
 *
 * Fails if `share` or `resource_type` has the wrong shape.
 */
export function shareAllowsComment(share: Pick<B.Share, "resourceType" | "resourceId" | "ownerId" | "access">, resource_type: B.ShareableType, resource_id: string, owner_id: string): boolean;

/**
 * [`share_allows_edit`](sharing::share_allows_edit).
 *
 * # Errors
 *
 * Fails if `share` or `resource_type` has the wrong shape.
 */
export function shareAllowsEdit(share: Pick<B.Share, "resourceType" | "resourceId" | "ownerId" | "access">, resource_type: B.ShareableType, resource_id: string, owner_id: string): boolean;

/**
 * [`share_covers_resource`](sharing::share_covers_resource).
 *
 * # Errors
 *
 * Fails if `share` or `resource_type` has the wrong shape.
 */
export function shareCoversResource(share: Pick<B.Share, "resourceType" | "resourceId" | "ownerId">, resource_type: B.ShareableType, resource_id: string, owner_id: string): boolean;

/**
 * [`SHARE_LINK_DEFAULT_TTL_DAYS`](sharing::SHARE_LINK_DEFAULT_TTL_DAYS) as a JS number.
 */
export function shareLinkDefaultTtlDays(): number;

/**
 * [`share_supports_edit_access`](sharing::share_supports_edit_access).
 *
 * # Errors
 *
 * Fails if `resource_type` is not a shareable type.
 */
export function shareSupportsEditAccess(resource_type: B.ShareableType, resource_id?: string | null | undefined): boolean;

/**
 * [`share_targets`](sharing::share_targets): the ids and blanket owners of one type in a grant list.
 *
 * # Errors
 *
 * Fails if `kind` is not a shareable type or `shares` is not a list of shares.
 */
export function shareTargets(shares: readonly B.Share[], kind: B.ShareableType): B.ShareTargets;

/**
 * [`SHAREABLE_TYPES`](sharing::SHAREABLE_TYPES): every type a share can cover.
 *
 * # Errors
 *
 * Fails if the list cannot be converted to a JS value.
 */
export function shareableTypes(): readonly B.ShareableType[];

/**
 * [`shared_item`](sharing::shared_item): one table row as a `SharedItem`.
 *
 * # Errors
 *
 * Fails if `kind` is not a shareable type or `source` lacks `title`.
 */
export function sharedItem(kind: B.ShareableType, row: Record<string, unknown>, source: B.SharedSource): B.SharedItem;

/**
 * [`shared_item_href`](sharing::shared_item_href).
 *
 * # Errors
 *
 * Fails when `item` is not a shared item.
 */
export function sharedItemHref(item: B.SharedItem): string;

/**
 * [`shared_item_type_label`](sharing::shared_item_type_label).
 *
 * # Errors
 *
 * Fails when `kind` is not a shareable type.
 */
export function sharedItemTypeLabel(kind: B.ShareableType): string;

/**
 * [`shared_paper_annotation_summary`](sharing::shared_paper_annotation_summary).
 *
 * # Errors
 *
 * Fails when `metadata` is not JSON, or the summary cannot be converted to a JS value.
 */
export function sharedPaperAnnotationSummary(metadata: Record<string, unknown> | undefined): B.SharedPaperAnnotationSummary;

/**
 * [`shared_provider_hint`]: the hint for `descriptor` given all descriptors, or `undefined`
 * when no sibling shares its provider. Only `id`, `provider` and `title` are read.
 *
 * # Errors
 *
 * Fails if an argument has the wrong shape.
 */
export function sharedProviderHint(descriptor: B.HintDescriptor, all: readonly B.HintDescriptor[]): string | undefined;

/**
 * [`shared_read_plan`](sharing::shared_read_plan): the PostgREST table, columns and filter for
 * one shared read, or `null` when there is no id and no owner.
 *
 * # Errors
 *
 * Fails if `kind` is not a shareable type or `ids`/`owners` are not string lists.
 */
export function sharedReadPlan(kind: B.ShareableType, ids: readonly string[], owners: readonly string[]): B.SharedReadPlan | null;

/**
 * [`shared_resource_href`](sharing::shared_resource_href).
 *
 * # Errors
 *
 * Fails when `kind` is not a shareable type.
 */
export function sharedResourceHref(kind: B.ShareableType, resource_id: string): string;

/**
 * [`short_sha`](experiment_status::short_sha); `undefined` when absent or empty.
 */
export function shortSha(sha?: string | null): string | undefined;

/**
 * [`shortcut_label::shortcut_label`]: a whole chord, `⌘⇧F` reads `Ctrl+Shift+F` off a Mac.
 */
export function shortcutLabel(chord: string, mac: boolean): string;

/**
 * [`SHORTCUT_TABLE`](keys::SHORTCUT_TABLE): each command's printed chord, as a JS object whose
 * keys are in table order.
 *
 * # Errors
 *
 * Fails only if the JS object cannot take a property.
 */
export function shortcutTable(): Record<string, string>;

/**
 * [`should_append_ink_point`]; `minDistance` defaults to 0.75.
 */
export function shouldAppendInkPoint(path: readonly number[], x: number, y: number, min_distance?: number | null): boolean;

/**
 * [`should_fetch_next_page`] for JS (TS `shouldFetchNextPage`): whether the cycle fetches
 * another page; `page` counts the pulls already made.
 *
 * # Errors
 *
 * Fails when `input` is not `{ more, page, maxPages }` with whole counts.
 */
export function shouldFetchNextPage(input: { more: boolean; page: number; maxPages: number }): boolean;

/**
 * [`should_mount_shell_children`](gate::should_mount_shell_children).
 */
export function shouldMountShellChildren(loading: boolean, needs_privacy_accept: boolean, container_ready: boolean): boolean;

/**
 * [`should_persist_body`](collab::should_persist_body).
 */
export function shouldPersistBody(ready: boolean, next: string, last_saved: string): boolean;

/**
 * [`should_persist_index`](index_cache_policy::should_persist_index).
 */
export function shouldPersistIndex(installed_app: boolean, document_count: number): boolean;

/**
 * [`should_pull_after_push`] for JS (TS `shouldPullAfterPush`): whether the pull runs after a
 * push (not when the network stopped the push).
 *
 * # Errors
 *
 * Fails when `input` is not `{ stoppedOffline }`.
 */
export function shouldPullAfterPush(input: { stoppedOffline: boolean }): boolean;

/**
 * [`should_recover_unsent`] for JS (TS `shouldRecoverUnsent`): whether unsent local rows are
 * checked against the server.
 *
 * # Errors
 *
 * Fails when `input` is not `{ hasAccount, resendChecked }`.
 */
export function shouldRecoverUnsent(input: { hasAccount: boolean; resendChecked: boolean }): boolean;

/**
 * [`should_retry`](search_retry::should_retry).
 */
export function shouldRetrySearch(result_count: number, term_count: number): boolean;

/**
 * [`should_show_workspace_loader`](gate::should_show_workspace_loader). `error` is the startup
 * error text, or nothing; an empty string counts as no error, as it does in JS.
 */
export function shouldShowWorkspaceLoader(loading: boolean, needs_privacy_accept: boolean, container_ready: boolean, error?: string | null): boolean;

/**
 * [`should_store_lookup`]: whether a lookup with this status is kept across sessions.
 */
export function shouldStoreReferenceLookup(status: string): boolean;

/**
 * [`should_sync_standalone`](org::should_sync_standalone). `labs` is `null` when the
 * memberships could not be read.
 *
 * # Errors
 *
 * Fails if `profile` or `labs` has the wrong shape.
 */
export function shouldSyncStandalone(profile: B.ProfileState | null, labs: readonly B.Membership[] | null): boolean;

/**
 * [`should_use_dark_pdf_rendering`] (TS `shouldUseDarkPdfRendering`). `null` and `undefined`
 * both count as absent.
 */
export function shouldUseDarkPdfRendering(theme_id?: string | null, mode?: string | null): boolean;

/**
 * [`show_concept_edges`](graph_settings::show_concept_edges).
 *
 * # Errors
 *
 * Fails if `settings` has the wrong shape.
 */
export function showConceptEdges(settings: B.GraphViewSettings): boolean;

/**
 * [`show_relation_edges`](graph_settings::show_relation_edges).
 *
 * # Errors
 *
 * Fails if `settings` has the wrong shape.
 */
export function showRelationEdges(settings: B.GraphViewSettings): boolean;

/**
 * [`simplify_ink_path`]; `tolerance` defaults to 0.35. Returns a plain JS number array.
 *
 * # Errors
 *
 * Fails only if the result cannot be converted to JS.
 */
export function simplifyInkPath(path: readonly number[], tolerance?: number | null): number[];

/**
 * [`simplify_path_indices`]; `tolerance` defaults to 0.35. Returns a JS array of indices.
 */
export function simplifyPathIndices(path: readonly number[], tolerance?: number | null): number[];

/**
 * [`site_of`](paper_preview::site_of) (TS `siteOf`).
 */
export function siteOf(url: string): string;

/**
 * [`slug_for`](wf_core::sync::folder_layout::slug_for); `fallback` defaults to
 * `"untitled"` (TS `slugFor`).
 */
export function slugFor(title: string, fallback?: string | null): string;

/**
 * [`slug_segment`](tree::slug_segment).
 */
export function slugSegment(title: string): string;

/**
 * [`smooth_ink_stroke`] as `{ points, pressures }`; `options` is
 * `{ spacing?, passes? }` or undefined.
 *
 * # Errors
 *
 * Fails if `options` is not an options object.
 */
export function smoothInkStroke(points: readonly number[], pressures: readonly number[], options?: { spacing?: number; passes?: number }): B.PackedInkStroke;

/**
 * Fit a line, rect, ellipse or arrow to a finished mark (Rust `snap_ink_shape`).
 * `null` when the recogniser abstains.
 */
export function snapInkShape(points: readonly number[]): { points: number[]; shape: Exclude<B.InkShape, "none"> } | null;

/**
 * [`snap_to_text`]: `runs` is `{ left, top, right, bottom }[]` (plain boxes, not DOMRects).
 * Returns `{ index, x, y }` or `null`.
 *
 * # Errors
 *
 * Fails if `runs` is not an array of `{ left, top, right, bottom }` objects.
 */
export function snapToText(runs: readonly B.TextRunBox[], x: number, y: number): B.SnapHit | null;

/**
 * [`sort_by_citations`](related_paper_hit::sort_by_citations): most cited first, stable.
 *
 * # Errors
 *
 * Fails if `hits` cannot be read as a list of hits.
 */
export function sortByCitations(hits: unknown): (B.RelatedPaperHitRow | null)[];

/**
 * [`sort_by_due`](screen::sort_by_due): dated milestones soonest first, undated after.
 *
 * # Errors
 *
 * Fails if `milestones` has the wrong shape, or the result cannot be serialised.
 */
export function sortByDue(milestones: readonly B.Milestone[]): B.Milestone[];

/**
 * [`sort_by_reading_order_indices`]: the caller's own `line` objects in reading order (page,
 * then column, then top to bottom).
 *
 * # Errors
 *
 * Fails if `tagged` is not an array of `{ line, column }` objects.
 */
export function sortByReadingOrder(tagged: readonly { line: B.AnalysisTextLine; column: number }[]): B.AnalysisTextLine[];

/**
 * [`sort_hit_order`](palette_sort::sort_hit_order): the indices of `rows` in the chosen order.
 *
 * # Errors
 *
 * Fails if `rows` or `order` has the wrong shape.
 */
export function sortHitOrder(rows: readonly B.HitKey[], order: B.HitSort): number[];

/**
 * [`source_note_template_context`]: the `{{...}}` values for a paper's source note.
 */
export function sourceNoteTemplateContext(input: B.SourceNoteInput): B.SourceNoteTemplateContext;

/**
 * [`span_distance`](vocab_match::span_distance); `Infinity` when refused.
 *
 * # Errors
 *
 * Fails if `words` or `entry_words` is not an array of strings.
 */
export function spanDistance(words: readonly string[], entry_words: readonly string[]): number;

/**
 * [`span_points`](text_anchor::span_points): `lengths` are the text node lengths, in order.
 *
 * # Errors
 *
 * Fails when `lengths` is not a list of counts or `span` is not a text span.
 */
export function spanPoints(lengths: readonly number[], span: B.TextSpan): B.SpanPoints | null;

/**
 * [`splitBibliographyEntries`](bibliography::split_bibliography_entries): first format with three or more entries.
 *
 * # Errors
 *
 * Returns an error when `lines` does not deserialize as text lines, or the result fails to convert.
 */
export function splitBibliographyEntries(lines: readonly B.AnalysisTextLine[]): B.AnalysisTextLine[][];

/**
 * [`splitByAuthorStart`](bibliography::split_by_author_start): entries by opening author name.
 *
 * # Errors
 *
 * Returns an error when `lines` does not deserialize as text lines, or the result fails to convert.
 */
export function splitByAuthorStart(lines: readonly B.AnalysisTextLine[]): B.AnalysisTextLine[][];

/**
 * [`splitByMargins`](bibliography::split_by_margins): unnumbered entries by left margin.
 *
 * # Errors
 *
 * Returns an error when `lines` does not deserialize as text lines, or the result fails to convert.
 */
export function splitByMargins(lines: readonly B.AnalysisTextLine[]): B.AnalysisTextLine[][];

/**
 * [`split_headline`] for JS (TS `splitHeadline`): `{ headline, rest }`.
 */
export function splitHeadline(body: string): B.LogHeadlineSplit;

/**
 * [`split_ink_text_layer`](wf_core::sync::ink_note::split_ink_text_layer): one string per
 * page (TS `splitInkTextLayer`).
 *
 * # Errors
 *
 * Fails if `body` exceeds `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function splitInkTextLayer(body: string): string[];

/**
 * [`split_leaf`](git_shim::split_leaf): `[parent, name]` for a repo-relative path.
 */
export function splitLeaf(path: string): [string, string];

/**
 * [`splitNumberedEntries`](bibliography::split_numbered_entries): entries by label.
 *
 * # Errors
 *
 * Returns an error when `lines` does not deserialize as text lines, or the result fails to convert.
 */
export function splitNumberedEntries(lines: readonly B.AnalysisTextLine[]): B.AnalysisTextLine[][];

/**
 * [`split_outside_edits`](outside_edits::split_outside_edits) on `{ notes, rows, seen }`,
 * returning `{ noteHeld, rowHeld, reasons }`.
 *
 * # Errors
 *
 * Fails if the input does not match the shape, or the result cannot be serialized.
 */
export function splitOutsideEdits(input: { notes: B.OutsideNoteEntry[]; rows: B.OutsideRowEntry[]; seen: Readonly<Record<string, B.OutsideSeenFile>> }): B.OutsideEditSplit;

/**
 * [`split_pane`](pane::split_pane). `direction` is `"row"` or `"column"`; `new_pane_id`
 * defaults to a fresh [`next_pane_id`].
 *
 * # Errors
 *
 * Fails if `layout` or `direction` has the wrong shape.
 */
export function splitPane(layout: B.PaneLayout, pane_id: string, direction: B.SplitDirection, new_pane_id?: string | null): B.PaneLayout;

/**
 * [`split_paper_drop`](paper_drop::split_paper_drop) (TS `splitPaperDrop`).
 *
 * # Errors
 *
 * Fails if `names` is not an array of strings, or the result cannot be converted.
 */
export function splitPaperDrop(names: readonly string[]): { pdfIndices: number[]; bibIndices: number[] };

/**
 * [`split_proposal_content`](preview::split_proposal_content).
 *
 * # Errors
 *
 * Fails only if the result cannot be serialised.
 */
export function splitProposalContent(content: string): B.ProposalPreview;

/**
 * [`split_storage_listing`](account_purge::split_storage_listing): file keys and folder keys.
 *
 * # Errors
 *
 * Fails if `entries` is not a list of `{ name, isFile }` or the result cannot become a JS value.
 */
export function splitStorageListing(current: string, entries: readonly { name: string; isFile: boolean }[]): { files: string[]; folders: string[] };

/**
 * [`pglite_sql::split_top_level`] (TS `splitTopLevel`): the top-level comma-separated pieces.
 *
 * # Errors
 *
 * Returns an error if the result cannot be converted to JS.
 */
export function splitTopLevel(expression: string): string[];

/**
 * [`stack_margin_notes`]: `anchorTops` is a number array; returns `{ index, top, anchorTop }[]`
 * in ascending `anchorTop` order.
 *
 * # Errors
 *
 * Fails if `anchorTops` is not an array of numbers.
 */
export function stackMarginNotes(anchor_tops: readonly number[], card_height: number): B.MarginSlot[];

/**
 * [`wf_core::sync::stamp_workspace_id::stamp_workspace_id`] for JS; `null` when already stamped.
 *
 * # Errors
 *
 * Fails when `content` or `id` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function stampWorkspaceId(content: string, id: string): string | null;

/**
 * [`start_session`](session_grant::start_session): the session, or the message for the first failed check.
 *
 * # Errors
 *
 * Fails with the user-facing message when a check fails, or when the input is malformed.
 */
export function startAiSession(input: B.SessionGrantInput): B.ActiveSession;

/**
 * [`status_patch_for_experiment`](experiment_status::status_patch_for_experiment). Every key is
 * present (a missing stamp is `undefined`), so spreading the patch clears a stamp.
 *
 * # Errors
 *
 * Fails if `experiment` or `status` has the wrong shape.
 */
export function statusPatchForExperiment(experiment: B.Experiment, status: B.ExperimentStatus, now: string): B.ExperimentStatusPatch;

/**
 * [`step_cursor`](quick::step_cursor): the row an arrow key lands on.
 */
export function stepCursor(cursor: number, delta: number, length: number): number;

/**
 * [`steps_to_prune`](experiments::steps_to_prune): steps to delete from a stored series,
 * off-grid steps except the newest.
 *
 * # Errors
 *
 * Fails only if the result cannot be converted to a JS value.
 */
export function stepsToPrune(stored_steps: readonly number[]): number[];

/**
 * [`STORAGE_LIST_PAGE`](account_purge::STORAGE_LIST_PAGE): entries per storage listing call.
 */
export function storageListPage(): number;

/**
 * [`storage_listing_has_more`](account_purge::storage_listing_has_more): a full page, so page on.
 */
export function storageListingHasMore(count: number): boolean;

/**
 * [`stored_digest`](stored_pages::stored_digest): one note's digest from its title and body.
 */
export function storedDigest(title: string, body: string): string;

/**
 * [`stored_digests`](stored_pages::stored_digests): each note's digest by id, as `Record<string, string>`.
 *
 * # Errors
 *
 * Fails when `pages` is not an array of `{ id, title, body }` strings.
 */
export function storedDigests(pages: readonly { id: string; title: string; body: string }[]): Record<string, string>;

/**
 * [`streak_days`] for JS (TS `streakDays`).
 *
 * # Errors
 *
 * Fails when `entryDates` is not an array of strings.
 */
export function streakDays(entry_dates: readonly string[], today: string): number;

/**
 * [`stride_for_step`](experiments::stride_for_step).
 */
export function strideForStep(step: number): number;

/**
 * [`strip_archive_root`](archive::strip_archive_root). `paths` is a `string[]`.
 *
 * # Errors
 *
 * Fails if `paths` has the wrong shape.
 */
export function stripArchiveRoot(paths: readonly string[]): string[];

/**
 * [`strip_frontmatter`](page::strip_frontmatter) (TS `stripFrontmatter`).
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 */
export function stripFrontmatter(md: string): B.ParsedFrontmatter;

/**
 * [`strip_invisible`](analysis_text::strip_invisible) (TS `stripInvisible`).
 */
export function stripInvisible(text: string): string;

/**
 * [`wf_core::sync::folder_layout::strip_kind_suffix`] for JS.
 *
 * # Errors
 *
 * Fails when `name` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function stripKindSuffix(name: string): string;

/**
 * [`strip_region_markers`](tpl::strip_region_markers).
 */
export function stripRegionMarkers(document: string): string;

/**
 * [`strip_stopwords`](hybrid_fusion::strip_stopwords).
 */
export function stripStopwords(query: string): string;

/**
 * [`strip_unresolved_image_refs`](markdown_image_refs::strip_unresolved_image_refs).
 * `paths` and `resolved` are JS string arrays.
 */
export function stripUnresolvedImageRefs(body: string, prefix: string, paths: readonly string[], resolved: readonly string[]): string;

/**
 * [`stroke_base_width`].
 */
export function strokeBaseWidth(samples: readonly number[], base: number): number;

/**
 * [`stroke_clip_text`]: the clipboard text for a set of `InkStroke`s.
 */
export function strokeClipText(strokes: readonly T.ReadonlyInkStroke[]): string;

/**
 * [`stroke_path`] over a flat `[x0, y0, x1, y1, ...]` array; `null` for fewer than two numbers.
 */
export function strokePath(points: readonly number[]): string | null;

/**
 * [`stroke_point_triples`](chunk_read::stroke_point_triples): one stroke's `x, y, pressure` triples.
 *
 * # Errors
 *
 * Fails on a body whose tables do not add up.
 */
export function strokePointTriples(body: Uint8Array, stroke_index: number): Float64Array;

/**
 * [`substitute_variables`](tpl::substitute_variables).
 *
 * # Errors
 *
 * Fails if the context is not a plain object.
 */
export function substituteVariables(template: string, context_value: Record<string, unknown>): string;

/**
 * [`subtree_ids`]: the id of `node` and of every list below it.
 */
export function subtreeIds(node: B.ReadingListTreeNode): string[];

/**
 * [`summarize_pdf_drop`](paper_drop::summarize_pdf_drop) (TS `summarizePdfDrop`).
 *
 * # Errors
 *
 * Fails if `entries` is not an array of drop entries, or the result cannot be converted.
 */
export function summarizePdfDrop(entries: readonly B.DropEntry[]): B.PdfDropSummary;

/**
 * [`supports_local_embedding`](embedding_runtime::supports_local_embedding), from the browser's
 * `Worker` and `WebAssembly` presence.
 */
export function supportsLocalEmbedding(has_worker: boolean, has_web_assembly: boolean): boolean;

/**
 * [`surname_key`](analysis_text::surname_key) (TS `surnameKey`).
 */
export function surnameKey(name: string): string;

/**
 * [`sync_dot`] for JS (TS `syncDot`). `null` when the account does not sync and is online.
 *
 * # Errors
 *
 * Fails when `input` is not a sync state with the expected fields.
 */
export function syncDot(input: B.SyncDotInput): B.SyncDot | null;

/**
 * [`field_shown`]: whether the connection field with `key` is asked for in this sign-in mode.
 */
export function syncFieldShown(key: string, mattermost_sign_in: boolean): boolean;

/**
 * [`sync_state`] for JS (TS `SyncStateStore.read`). A null row reads as nothing read.
 *
 * # Errors
 *
 * Fails when `row` is neither null nor a `sync_state` row, or the result cannot be serialised.
 */
export function syncStateFromRow(row: unknown): unknown;

/**
 * [`sync_stroke_steps`]: `history` is the page log, `depth` the worker's stroke count.
 */
export function syncStrokeSteps(history: B.PageHistory, depth: number): B.PageHistory;

/**
 * [`local_first_route::synced_tables`] as an array of table names.
 *
 * # Errors
 *
 * Fails if the result cannot be converted to JS.
 */
export function syncedTables(): readonly string[];

/**
 * [`tab_at`](pane::tab_at); `undefined` when there is no tab there.
 *
 * # Errors
 *
 * Fails if `layout` has the wrong shape.
 */
export function tabAt(layout: B.PaneLayout, pane_id: string, index: number): B.TabRef | undefined;

/**
 * [`tab_key`](pane::tab_key).
 *
 * # Errors
 *
 * Fails if `tab` has the wrong shape.
 */
export function tabKey(tab: B.TabRef): string;

/**
 * [`tab_mode`](pane::tab_mode). Returns `"edit"`, `"read"` or `"ink"`.
 *
 * # Errors
 *
 * Fails if `tab` has the wrong shape.
 */
export function tabMode(tab: B.TabRef): B.DocumentMode;

/**
 * [`tab_separated_to_markdown_table`] for JS, as `{ text, changed }`.
 *
 * # Errors
 *
 * Fails when `input` is over the text cap.
 */
export function tabSeparatedToMarkdownTable(input: string): B.TextResult;

/**
 * [`table_groups`] for JS (TS `tableGroups`).
 *
 * # Errors
 *
 * Fails when `tables` is not an array of strings.
 */
export function tableGroups(tables: string[]): number[][];

/**
 * [`tag_colour`](graph_colour::tag_colour): the hue for a tag.
 */
export function tagColor(tag: string): string;

/**
 * [`tag_to_hashtag`](note_tags::tag_to_hashtag). Empty when the name has no usable characters.
 */
export function tagToHashtag(name: string): string;

/**
 * [`tag_tone`](tag_tone::tag_tone): colour slot `1..=6` for a tag.
 */
export function tagTone(tag: string): number;

/**
 * [`pglite_sql::tail_clause`] (TS `tailClause`): the order, limit and offset tail of a statement.
 */
export function tailClause(order_by: string | null | undefined, limit: number | null | undefined, offset: number): string;

/**
 * [`take_ink_redo`](ink_undo::take_ink_redo); `null` when there is no step.
 *
 * # Errors
 *
 * Fails if `state` has the wrong shape.
 */
export function takeInkRedo(state: B.InkUndoState): B.InkUndoStep | null;

/**
 * [`take_ink_undo`](ink_undo::take_ink_undo); `null` when there is no step.
 *
 * # Errors
 *
 * Fails if `state` has the wrong shape.
 */
export function takeInkUndo(state: B.InkUndoState): B.InkUndoStep | null;

/**
 * [`take_page_step`]: `direction` is `"undo"` or `"redo"`; gives
 * `{ history, step }`, or `null` when that stack is empty.
 */
export function takePageStep(history: B.PageHistory, direction: string): B.TakenPageStep | null;

/**
 * [`temporary_name`](vault_search::temporary_name): the staged name for a write to `target`.
 */
export function temporaryName(target: string, pid: number, seq: number): string;

/**
 * [`engine_args`]: the argument vector for `engine` (`"latexmk"`, `"tectonic"` or `"pdflatex"`)
 * compiling `entry`.
 *
 * # Errors
 *
 * Fails if `engine` is not one of the known engine names, or the result cannot be converted to
 * JS.
 */
export function texEngineArgs(engine: B.TexEngineKind, entry: string): string[];

/**
 * [`parse_tex_log`]: the errors in a TeX log, one per place.
 *
 * # Errors
 *
 * Fails only if the result cannot be converted to JS.
 */
export function texLogErrors(log: string, entry: string): B.TexErrorRow[];

/**
 * [`text_box_from_rect`]: a text box's rect as `{ left, top, width, height }` in page units.
 *
 * # Errors
 *
 * Fails if `rect` is not four numbers.
 */
export function textBoxFromRect(rect: readonly [number, number, number, number]): B.TextBoxRect;

/**
 * [`text_fingerprint`](analysis_text::text_fingerprint) (TS `textFingerprint`).
 *
 * # Errors
 *
 * Fails if `texts` is not an array of strings.
 */
export function textFingerprint(texts: readonly string[]): string;

/**
 * [`text_hash`](semantic_fingerprint::text_hash): the stored fingerprint of a document's embedded text.
 */
export function textHash(text: string): string;

/**
 * [`text_selection_from_offsets`]: a `TextSelectionRange` from two `{ itemIndex, offset }`
 * points, or `null` when the selection is empty or invalid.
 *
 * # Errors
 *
 * Fails if either point is not an `{ itemIndex, offset }` object.
 */
export function textSelectionFromOffsets(start: { itemIndex: number; offset: number }, end: { itemIndex: number; offset: number }): T.TextSelectionRange | null;

/**
 * [`textWithinCap`]: whether `text` is within the index cap (16Mi UTF-16 units). Callers use it to
 * pick the old TS fallback for longer text rather than sending it to the page-text rules.
 */
export function textWithinCap(text: string): boolean;

/**
 * [`theme_config_template`](theme_config::theme_config_template): the starter file.
 */
export function themeConfigTemplate(): string;

/**
 * [`fits_budget`](thumb::fits_budget): whether a data URL of `len` characters is kept. A length
 * that does not fit in `usize` is never kept.
 */
export function thumbFits(len: number): boolean;

/**
 * [`thumb_key`](thumb::thumb_key): the local storage key for a project's picture.
 */
export function thumbKey(project_id: string): string;

/**
 * [`tick_format`]: how the tick labels are rendered for these values.
 */
export function tickFormat(values: readonly number[]): B.TickFormat;

/**
 * [`timeline_lane_offset`](timeline::timeline_lane_offset).
 */
export function timelineLaneOffset(mid: number, year?: number | null): number | null;

/**
 * The timeline layout: each node's x is fixed to its publication year, centred on the mean year
 * of the collection; a node without a year gets `null` and is left to the forces. Returns `null`
 * when the layout is not `"timeline"` or no node has a year.
 *
 * # Errors
 *
 * Fails if a node's `year` is neither a number nor `null`.
 */
export function timelineLaneX(layout: string, nodes: readonly { year?: number | null }[]): ((node: { year?: number | null }) => number | null) | null;

/**
 * [`timeline_mid_year`](timeline::timeline_mid_year). `years` is an array of years, `null` where unknown.
 *
 * # Errors
 *
 * Fails if `years` is not an array of optional numbers.
 */
export function timelineMidYear(layout: string, years: (number | null)[]): number | null;

/**
 * [`title_fixes`] (TS `titleFixes`). Only papers whose title needs a fix are listed.
 *
 * # Errors
 *
 * Fails if `papers` is not a list of paper summaries, or the result cannot be converted.
 */
export function titleFixes(papers: readonly B.TidyPaper[]): B.TitleFix[];

/**
 * [`route_title::title_for_path`]. `navItems` is an array of `{ path, label }`.
 *
 * # Errors
 *
 * Fails if `nav_items` is not an array of `{ path, label }` objects.
 */
export function titleForPath(pathname: string, nav_items: readonly B.NavRouteInput[]): string;

/**
 * [`title_from_file_name`](paper_title::title_from_file_name) (TS `titleFromFileName`).
 */
export function titleFromFileName(title: string): string;

/**
 * [`title_key`](paper_title::title_key) (TS `titleKey`). `None` becomes `null` in JS.
 */
export function titleKey(title?: string | null | undefined): string | null;

/**
 * [`title_of`](quick::title_of): the title a row is shown under.
 *
 * # Errors
 *
 * Fails if `node` is not a tree row.
 */
export function titleOf(node: B.WorkspaceTreeNode): string;

/**
 * [`title_similarity`](analysis_text::title_similarity) (TS `titleSimilarity`).
 */
export function titleSimilarity(left: string, right: string): number;

/**
 * [`to_annotation_search_docs`](search_document::to_annotation_search_docs).
 * `paper_titles` maps a paper id to its title; `degrees` defaults to empty.
 *
 * # Errors
 *
 * Fails if an argument does not match the expected shape.
 */
export function toAnnotationSearchDocs(annotations: readonly B.AnnotationSource[], paper_titles: ReadonlyMap<string, string>, degrees?: ReadonlyMap<string, number>): B.SearchDoc[];

/**
 * [`to_extraction_result`](model_concepts::to_extraction_result), checking ids against `batchIds`.
 *
 * # Errors
 *
 * Fails if `raw` is not an array.
 */
export function toExtractionResult(raw: readonly unknown[], batch_ids: readonly string[]): B.ExtractionResult;

/**
 * [`to_pdf_search_docs`](search_document::to_pdf_search_docs). `degrees` defaults to empty.
 *
 * # Errors
 *
 * Fails if `sources` or `degrees` do not match the expected shape.
 */
export function toPdfSearchDocs(sources: readonly (Required<Omit<B.PdfIndexSource, "pages">> & { pages: readonly Required<B.PdfPageText>[] })[], degrees?: ReadonlyMap<string, number>): B.SearchDoc[];

/**
 * [`wf_core::sync::blob_links::to_relative_blob_links`] for JS, as
 * `{ body, assets: [{ scheme, storagePath, folderPath }] }`.
 *
 * # Errors
 *
 * Fails when `body` or `file_path` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function toRelativeBlobLinks(body: string, file_path: string): B.RelativeLinks;

/**
 * [`to_render_strokes`]: `strokes` is an `InkRenderSource[]`, `palette` an
 * `InkSvgPalette`, and `hidden` the positions to leave out.
 */
export function toRenderStrokes(strokes: any, palette: any, hidden: Uint32Array): any;

/**
 * [`to_search_docs`](search_document::to_search_docs). `degrees` maps `kind:id` to a link
 * count and defaults to empty.
 *
 * # Errors
 *
 * Fails if `snapshot` or `degrees` do not match the expected shape.
 */
export function toSearchDocs(snapshot: object, degrees?: ReadonlyMap<string, number>): B.SearchDoc[];

/**
 * [`to_zotero_item`] (TS `toZoteroItem`). The `journalArticle` written to Zotero for a paper.
 *
 * # Errors
 *
 * Fails if `paper` is not a paper.
 */
export function toZoteroItem(paper: B.MergePaper): B.ZoteroExportItem;

/**
 * [`to_zotero_write_payload`] for one annotation under a parent item key.
 *
 * # Errors
 *
 * Fails if `ann` is not a `ZoteroAnnotationLocal` object.
 */
export function toZoteroWritePayload(ann: B.ZoteroAnnotationLocal, parent_item_key: string): B.ZoteroAnnotationWritePayload;

/**
 * [`initial_state`](toast_store::initial_state): an empty toast store.
 *
 * # Errors
 *
 * Fails if the result cannot be converted to JS.
 */
export function toastInitialState(): unknown;

/**
 * [`reduce`](toast_store::reduce): the next toast state, view, hidden keys and effects for one action.
 *
 * # Errors
 *
 * Fails if `state` or `action` is not a `ToastState` or `Action`-shaped object, or the result
 * cannot be converted to JS.
 */
export function toastReduce(state: unknown, action: unknown): unknown;

/**
 * [`toggle_key`](state::toggle_key) for the expanded rows: a new set with `key` flipped; never
 * mutates.
 *
 * # Errors
 *
 * Fails if `expanded` does not hold only strings.
 */
export function toggleExpanded(expanded: ReadonlySet<string>, key: string): Set<string>;

/**
 * [`nav_open_groups::toggle_group`]: `groups` with `key` added when closed, removed when open.
 *
 * # Errors
 *
 * Fails if `groups` is not an array of strings, or the result cannot be converted to JS.
 */
export function toggleGroup(groups: readonly string[], key: string): string[];

/**
 * [`toggle_preview`](pane::toggle_preview). `new_pane_id` defaults to a fresh
 * [`next_pane_id`].
 *
 * # Errors
 *
 * Fails if `layout` has the wrong shape.
 */
export function togglePreview(layout: B.PaneLayout, new_pane_id?: string | null): B.PaneLayout;

/**
 * [`toggle_key`](state::toggle_key) for the open sections: opens or closes one section, touching
 * no other. Returns a new `{ open }` state.
 *
 * # Errors
 *
 * Fails if `sections.open` does not hold only strings.
 */
export function toggleSection(sections: { open: ReadonlySet<string> }, id: string): { open: ReadonlySet<string> };

/**
 * [`wf_core::search::tokenizer::tokenize`]: search terms of `text`, deduplicated.
 *
 * # Errors
 *
 * Fails if `text` exceeds `MAX_INDEX_TEXT_UTF16` UTF-16 units, or if
 * `options` is not a valid `TokenizerOptions` object.
 */
export function tokenize(text: string, options: B.TokenizerOptions): string[];

/**
 * [`tool_owns_the_page`]: every tool but `select` takes the page from the text selection.
 */
export function toolOwnsThePage(tool: string): boolean;

/**
 * [`trail_diameter_px`](trail::trail_diameter_px): the trail's diameter in CSS px for a
 * nib width in 0.1 mm on a page `page_width_px` wide.
 */
export function trailDiameterPx(width: number, page_width_px: number): number;

/**
 * [`transform_x`](text_ot::transform_x): `[ours, theirs]` rewritten to apply after each other.
 * `left` is ours, `right` the server's.
 *
 * # Errors
 *
 * Fails when the ops cannot be read or two overlapping deletes disagree.
 */
export function transformTextOps(left: B.TextComponent[], right: B.TextComponent[]): [B.TextComponent[], B.TextComponent[]];

/**
 * [`transitions_on`](wf_core::view_transition::transitions_on) (TS `transitionsOn`): true when
 * the tier for the same input as [`motion_tier_js`] animates at all.
 */
export function transitionsOn(input: { motion: string | undefined; theme: string | undefined; reducedMotion: boolean; supported: boolean }): boolean;

/**
 * [`translate_ink_paths`]; `decimals` defaults to 2. Returns an array of number arrays.
 */
export function translateInkPaths(paths: readonly (readonly number[])[], dx: number, dy: number, decimals?: number | null): number[][];

/**
 * [`tree_paths`](wf_core::sync::folder_layout::tree_paths) as `[id, path]` pairs in
 * first-seen order.
 *
 * # Errors
 *
 * Fails if `nodes` is not an array of `FolderNode`s or `entity` is not a known type.
 */
export function treePathPairs(nodes: readonly { id: string; title: string; parentId?: string | null }[], entity: B.WorkspaceEntityType, project_root?: string | null): [string, string][];

/**
 * [`tree_paths`](wf_core::sync::folder_layout::tree_paths): the folder path of each node in a
 * tree, keyed by id, as a `Map` in first-seen order.
 *
 * # Errors
 *
 * Fails if `nodes` is not an array of `FolderNode`s or `entity` is not a known type.
 */
export function treePaths(nodes: readonly { id: string; title: string; parentId?: string | null }[], entity: B.WorkspaceEntityType, project_root?: string | null): Map<string, string>;

/**
 * [`triage_reported_paths`](folder_report::triage_reported_paths) on `{ paths, projectId }`,
 * returning `{ drafts, candidates }`.
 *
 * # Errors
 *
 * Fails if the input does not match the shape, or the result cannot be serialized.
 */
export function triageReportedPaths(input: { paths: readonly string[]; projectId: string | null }): { drafts: boolean; candidates: string[] };

/**
 * [`trimmed_or_none`]: trim a resolver path or URL, null when blank.
 */
export function trimmedOrNone(value?: string | null | undefined): string | null;

/**
 * [`uncropped_figure_box`](figure::uncropped_figure_box): the box with the crop lifted.
 *
 * # Errors
 *
 * Fails if `value` has the wrong shape.
 */
export function uncroppedFigureBox(value: B.FigureBox): B.FigureRect;

/**
 * [`union_rect`]: the box around a set of rects, or `null` when there are none.
 *
 * # Errors
 *
 * Fails if `rects` is not an array of `[x1, y1, x2, y2]` arrays.
 */
export function unionRect(rects: readonly [number, number, number, number][]): [number, number, number, number] | null;

/**
 * [`unique_cite_key`](cite_key::unique_cite_key) (TS `uniqueCiteKey`): the resolved key, made
 * unique against `used`. `used` is mutated: the returned key is added to it.
 *
 * # Errors
 *
 * Fails if `paper.id` is not a string, or `used` holds a non-string.
 */
export function uniqueCiteKey(paper: { id: string; doi?: string; arxivId?: string; bibtex?: string; metadata?: Record<string, unknown> }, used: Set<string>): string;

/**
 * [`unique_constraint_name`] for JS (TS `uniqueConstraintName`). `undefined` when no name is quoted.
 */
export function uniqueConstraintName(message: string): string | undefined;

/**
 * [`unique_device_name`](panel_labels::unique_device_name): an adoption label no taken name matches.
 *
 * # Errors
 *
 * Fails if `taken` is not an array of strings.
 */
export function uniqueDeviceName(name: string, device_label: string, taken: readonly string[]): string;

/**
 * [`unique_figure_name`](markdown_to_latex::unique_figure_name) (TS `uniqueFigureName`): a
 * file-safe figure name not in `used`; the name is added to `used`.
 *
 * # Errors
 *
 * Fails if `used` holds a non-string.
 */
export function uniqueFigureName(raw: string, used: Set<string>): string;

/**
 * [`unique_title`](page::unique_title) (TS `uniqueTitle`): a title unique against `used`
 * (normalized keys). Records the chosen title's key in `used`.
 *
 * # Errors
 *
 * Fails if `used` holds a value that is not a string.
 */
export function uniqueTitle(base: string, used: Set<string>): string;

/**
 * [`unpack_local_row`](paths::unpack_local_row): `{ head, bytes }` from a local row, or `null`.
 *
 * # Errors
 *
 * Fails only if the result object cannot be built.
 */
export function unpackLocalVectorRow(packed: string): { readonly head: string; readonly bytes: Uint8Array } | null;

/**
 * The blob of [`unpack_vectors`](codec::unpack_vectors), or `undefined` for a torn file.
 */
export function unpackVectorBlob(file: Uint8Array): Uint8Array | undefined;

/**
 * [`unpack_head`](codec::unpack_head): the head, or `null` for a torn file.
 *
 * # Errors
 *
 * Fails only if the head cannot be serialised.
 */
export function unpackVectorHead(file: Uint8Array): B.VectorFileHead | null;

/**
 * [`unpack_vectors`](codec::unpack_vectors): a file's head with its blob as `bytes`, or `null`
 * if it is torn or its head is not valid.
 *
 * # Errors
 *
 * Fails only if the head cannot be serialised.
 */
export function unpackVectors(file: Uint8Array): (B.VectorFileHead & { bytes: Uint8Array }) | null;

/**
 * [`unstage_action`](git_shim::unstage_action): `"keep"`, `"remove"` or `"reset"`.
 */
export function unstageAction(head: number, stage: number): string;

/**
 * [`unstamp_for_compare`](folder_mirror::unstamp_for_compare): `text` with a README or manifest's
 * export time blanked, for comparing two copies of a mirrored file.
 */
export function unstampForCompare(path: string, text: string): string;

/**
 * [`UNTRUSTED_CONTEXT_RULE`](untrusted_context::UNTRUSTED_CONTEXT_RULE).
 */
export function untrustedContextRule(): string;

/**
 * [`upload_content_type`]: the explicit type, else the blob type, else the fallback.
 */
export function uploadContentType(explicit: string | null | undefined, blob_type: string): string;

/**
 * [`error_suffix`](upload_reason::error_suffix): `": <message>"` from an upload answer body, or `""`.
 */
export function uploadErrorSuffix(body: string): string;

/**
 * [`read_failure_message`](url_meta::read_failure_message).
 */
export function urlMetaReadFailureMessage(status: number, detail: string): string;

/**
 * [`shell_target`](url_meta::shell_target).
 */
export function urlMetaShellTarget(value: string): string;

/**
 * [`url_meta_to_metadata`] (TS `urlMetaToMetadata`). A page's own metadata as a paper.
 *
 * # Errors
 *
 * Fails when the page has no title, or its title names the page rather than a paper.
 */
export function urlMetaToMetadata(meta: B.UrlMetaResponse): B.ZoteroPaperInput;

/**
 * [`usable_status`](zotero_local_status::usable_status) (TS `usableStatus`).
 */
export function usableStatus(status: number): number;

/**
 * [`user_gate_open`]. `gate` is `null` or `undefined` for an ungated descriptor.
 *
 * # Errors
 *
 * Fails if an argument has the wrong shape, or the result cannot be converted to JS.
 */
export function userGateOpen(config: Omit<B.IntegrationConfig, "gitRead"> & { gitRead: readonly string[] }, gate?: B.RuntimeGate | undefined): boolean;

/**
 * [`uses_highlighter_pass`]: whether a tool is drawn translucent through the stencil.
 */
export function usesInkHighlighterPass(tool: string): boolean;

/**
 * [`validate_compute`](milestone::validate_compute), throwing on an invalid list.
 *
 * # Errors
 *
 * Throws a `MilestoneValidationError` with the validation message, or a shape error if
 * `compute` has the wrong shape.
 */
export function validateCompute(compute: B.ComputeNeed[]): void;

/**
 * [`validate_compute`](milestone::validate_compute): the validation message, or `undefined`
 * when the list is valid.
 *
 * # Errors
 *
 * Fails if `compute` has the wrong shape.
 */
export function validateComputeError(compute: B.ComputeNeed[]): string | undefined;

/**
 * [`validate_dependencies`](milestone::validate_dependencies), throwing on an invalid list.
 *
 * # Errors
 *
 * Throws a `MilestoneValidationError` with the validation message, or a shape error if
 * `deps` has the wrong shape.
 */
export function validateDependencies(deps: B.MilestoneDependency[]): void;

/**
 * [`validate_dependencies`](milestone::validate_dependencies): the validation message, or
 * `undefined` when the list is valid.
 *
 * # Errors
 *
 * Fails if `deps` has the wrong shape.
 */
export function validateDependenciesError(deps: B.MilestoneDependency[]): string | undefined;

/**
 * [`validate_new_member`](member::validate_new_member): the normalized member, with
 * absent `fullName` / `supervisorId` set to `undefined` rather than `null`.
 *
 * # Errors
 *
 * Throws an `Error` named `MemberValidationError` with the message if the request is
 * invalid, or a shape error if `input` has the wrong shape.
 */
export function validateNewMember(input: Pick<B.NewMember, 'email' | 'password' | 'role'> & Partial<Pick<B.NewMember, 'fullName' | 'supervisorId'>>): Omit<B.NewMember, 'fullName' | 'supervisorId'> & { fullName?: string; supervisorId?: string };

/**
 * [`validate_org_name`](org::validate_org_name). Throws the validation message.
 *
 * # Errors
 *
 * Fails with the message if the name is blank or too long.
 */
export function validateOrgName(name: string): string;

/**
 * [`vault_asset_paths_in_body`](page::vault_asset_paths_in_body) (TS `vaultAssetPathsInBody`).
 */
export function vaultAssetPathsInBody(body: string): string[];

/**
 * [`vault_body_preview`](page::vault_body_preview) (TS `vaultBodyPreview`). `max` counts UTF-16
 * units and defaults to [`VAULT_BODY_PREVIEW_CHARS`](page::VAULT_BODY_PREVIEW_CHARS); an empty
 * body previews as empty.
 */
export function vaultBodyPreview(body: string, max?: number | null): string;

/**
 * [`VAULT_BODY_PREVIEW_CHARS`](page::VAULT_BODY_PREVIEW_CHARS) (TS `vaultBodyPreviewChars()`).
 */
export function vaultBodyPreviewChars(): number;

/**
 * [`vault_image_markdown`](page::vault_image_markdown) (TS `vaultImageMarkdown`).
 */
export function vaultImageMarkdown(path: string, alt?: string | null): string;

/**
 * [`VAULT_IMAGE_PREFIX`](page::VAULT_IMAGE_PREFIX) (TS `vaultImagePrefix()`).
 */
export function vaultImagePrefix(): string;

/**
 * [`wf_core::sync::merge_vault_page::vault_page_base`] for JS; `null` when the file is not a note.
 *
 * # Errors
 *
 * Fails when `path` or `content` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function vaultPageBase(path: string, content: string): any;

/**
 * [`wf_core::sync::merge_vault_page::vault_page_side`] for JS; `null` when the file is not a note.
 *
 * # Errors
 *
 * Fails when `path` or `content` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function vaultPageSide(path: string, content: string): any;

/**
 * [`vault_root_from_text`](home_config::vault_root_from_text): the `vaultRoot` string, or `null`
 * when there is none.
 */
export function vaultRootFromText(text: string): string | null;

/**
 * [`too_large_message`](wf_core::sync::vault_limits::too_large_message): the "too large to open here" text for a byte cap.
 */
export function vaultTooLargeMessage(cap_bytes: number): string;

/**
 * [`folder_cache_dir`](paths::folder_cache_dir): the workspace folder's vector cache directory.
 */
export function vectorFolderCacheDir(): string;

/**
 * [`folder_path`](paths::folder_path): the workspace-folder file holding one corpus's vectors.
 */
export function vectorFolderPath(project_id?: string | null): string;

/**
 * Rebuild an index from `VectorIndex.toBytes()` output.
 *
 * # Errors
 *
 * Fails when the bytes are truncated, have trailing data, or repeat an id.
 */
export function vectorIndexFromBytes(bytes: Uint8Array): VectorIndex;

/**
 * [`store_key`](paths::store_key): the key a corpus's vectors are stored under.
 */
export function vectorStoreKey(project_id?: string | null): string;

/**
 * [`verdict_for`](screening::verdict_for) (TS `verdictFor`): where one item stands at one
 * stage.
 *
 * # Errors
 *
 * Fails if `decisions` or `stage` has the wrong shape.
 */
export function verdictFor(decisions: readonly B.ScreeningDecision[], item_id: string, stage: B.ScreeningStage): B.ItemVerdict;

/**
 * [`verdicts_for`](screening::verdicts_for): both stages' verdicts per item, in item order.
 * Both lists are read through one `JSON.stringify` copy.
 *
 * # Errors
 *
 * Fails if `items` or `decisions` cannot be stringified or have the wrong shape.
 */
export function verdictsFor(items: readonly { id: string }[], decisions: readonly unknown[]): B.ItemVerdict[];

/**
 * [`viewable_artifact_url`](experiment_artifacts::viewable_artifact_url); `null` when refused.
 */
export function viewableArtifactUrl(entry: string, in_shell: boolean): string | null;

/**
 * [`visible_rows`](tree::visible_rows). `expanded` is the set of expanded keys.
 *
 * # Errors
 *
 * Fails if either argument has the wrong shape.
 */
export function visibleRows(nodes: readonly B.WorkspaceTreeNode[], expanded: ReadonlySet<string>): B.VisibleRow[];

/**
 * [`visual_page_size`] as `{ width, height }` (TS `visualPageSize`).
 *
 * # Errors
 *
 * Fails if `page` is not an object with `width` and `height`.
 */
export function visualPageSize(page: B.ReaderPageSize, rotation: number): B.ReaderPageSize;

/**
 * [`vscode_json`](mcp_client_config::vscode_json) for a `McpLaunchLine`.
 *
 * # Errors
 *
 * Fails if `launch` has the wrong shape.
 */
export function vscodeJson(launch: B.McpLaunchLine): string;

/**
 * [`walk_sections`] over the report outline: body lines, warnings, figures and counts.
 *
 * # Errors
 *
 * Fails if `tree` or `opts` has the wrong shape.
 */
export function walkOverleafSections(tree: readonly B.ReportSectionTreeNode[], opts: OverleafWalkOptions): OverleafSectionWalk;

/**
 * [`WEB_CACHE_DOCUMENT_LIMIT`](index_cache_policy::WEB_CACHE_DOCUMENT_LIMIT), the single source
 * the web app reads instead of keeping its own copy.
 */
export function webCacheDocumentLimit(): number;

/**
 * [`webdav_supports`] (TS `WebDavPdfResolver.supports`).
 */
export function webdavSupports(webdav_path?: string | null): boolean;

/**
 * [`wiki_page_refs`]: the wiki's pages (children of the root) as `{ id, title, body, aliases? }`;
 * `aliases` is left out, never `null`.
 *
 * # Errors
 *
 * Fails if `pages` is not a list of wiki notes.
 */
export function wikiPageRefs(pages: readonly B.WikiNote[]): B.WikiLintPageRef[];

/**
 * [`wiki_proposal_content`](wiki_plan::wiki_proposal_content) for a `WikiPagePlan` object.
 *
 * # Errors
 *
 * Fails if `plan` is not a wiki page plan object.
 */
export function wikiProposalContent(plan: B.WikiPagePlan): string;

/**
 * [`wiki_source_documents`]: notes (not generated pages) and papers as extraction documents.
 * `sourceIds` is optional; omitted means every note and paper.
 *
 * # Errors
 *
 * Fails if `pages` or `papers` has the wrong shape.
 */
export function wikiSourceDocuments(pages: readonly B.WikiNote[], papers: readonly B.WikiPaper[], sourceIds?: readonly string[]): B.WikiSourceDocument[];

/**
 * [`error_reply`](wire::error_reply). `id` is a JS number or `null`.
 *
 * # Errors
 *
 * Fails if `id` is neither a non-negative integer nor `null`.
 */
export function wireErrorReply(id: number | null, error: string): Record<string, unknown>;

/**
 * [`ok_reply_head`](wire::ok_reply_head): `{id, ok: true}`, to which the shell adds `value`.
 *
 * # Errors
 *
 * Fails if `id` is not a non-negative integer.
 */
export function wireOkReplyHead(id: number): { id: number; ok: true };

/**
 * [`parse_request`](wire::parse_request) as `{ok: true, id, method, params?}`
 * or `{ok: false, error}`.
 *
 * # Errors
 *
 * Fails only if the result cannot be turned into a JS value.
 */
export function wireParseRequest(line: string): { ok: true; id: number; method: string; params?: unknown } | { ok: false; error: string };

/**
 * [`route_line`](wire::route_line) as `{kind, ...}`: `skip`, `reply`, `call`,
 * `settle`, or `badAnswer`.
 *
 * # Errors
 *
 * Fails only if the decision cannot be turned into a JS value.
 */
export function wireRoute(line: string, accept_answers: boolean): { kind: "skip" } | { kind: "reply"; reply: Record<string, unknown> } | { kind: "call"; id: number; method: string; params?: unknown } | { kind: "settle"; answer: number; ok: true; value: unknown } | { kind: "settle"; answer: number; ok: false; error: string } | { kind: "badAnswer" };

/**
 * [`wire_tag`](wire::wire_tag) as `{kind: "bigint", digits}` or
 * `{kind: "bytes", encoded}`, or `null` when the value is not a tag.
 *
 * # Errors
 *
 * Fails if `value` cannot be read as JSON (for example, a JS bigint).
 */
export function wireTag(value: unknown): { kind: "bigint"; digits: string } | { kind: "bytes"; encoded: string } | null;

/**
 * [`nav_open_groups::with_active`]: `groups` with `active` appended when it is not already listed.
 *
 * # Errors
 *
 * Fails if `groups` is not an array of strings, or the result cannot be converted to JS.
 */
export function withActive(groups: readonly string[], active?: string | null): string[];

/**
 * [`with_image_width`](markdown_image_width::with_image_width): the alt for a width, keeping any
 * crop or side. `null` clears the width.
 *
 * # Errors
 *
 * Fails if `alt` is longer than the index text limit.
 */
export function withImageWidth(alt: string, width?: string | null): string;

/**
 * [`with_ink_page_background`](ink_page::with_ink_page_background): the text with its
 * background line set to `path`, or removed for `null`.
 */
export function withInkPageBackground(text: string, path?: string | null | undefined): string;

/**
 * [`with_ink_page_figures`](figure::with_ink_page_figures): a page's text with its figure block
 * set, after the background line and before the text. Extra fields are ignored; a `null` crop is
 * none.
 *
 * # Errors
 *
 * Fails if `text` is too long or `figures` has the wrong shape.
 */
export function withInkPageFigures(text: string, figures: readonly B.FigurePlacement[]): string;

/**
 * [`with_md_image_alt`](markdown_figure_alt::with_md_image_alt): the alt text for a figure's own
 * text and placement.
 *
 * # Errors
 *
 * Fails if `alt` is too long or `placement` has the wrong shape.
 */
export function withMdImageAlt(alt: string, placement: B.MdPlacement): string;

/**
 * [`with_missing_figures`]: the package files with `manifest.json` rewritten for missing
 * figures. Returns a new array.
 *
 * # Errors
 *
 * Fails if an argument has the wrong shape or `manifest.json` cannot be rewritten.
 */
export function withMissingFigures(files: readonly OverleafExportFile[], missing: readonly OverleafExportImage[]): OverleafExportFile[];

/**
 * [`with_tag_line`](import_links::with_tag_line). `tags` is an array of tag names.
 *
 * # Errors
 *
 * Fails if `tags` is not an array of strings.
 */
export function withTagLine(body: string, tags: readonly string[]): string;

/**
 * [`without_existing`](extraction::without_existing).
 *
 * # Errors
 *
 * Fails when `result` is not an extraction result.
 */
export function withoutExisting(result: B.ExtractionResult, existing: readonly string[]): B.ExtractionResult;

/**
 * [`without_group`](groups::without_group).
 *
 * # Errors
 *
 * Fails if `tab` has the wrong shape.
 */
export function withoutGroup(tab: B.TabRef): B.TabRef;

/**
 * The `{id, name}` projects in a projects-route body, in the route's order. `null` when
 * `projects` is not an array.
 */
export function workshopProjectList(body: unknown): { id: string; name: string }[] | null;

/**
 * [`wf_core::sync::blob_links::workspace_bodies`] for JS. `vaultBodies` is an array of
 * strings and `paperSummaries` an array of strings or `null`; the result is the bodies,
 * vault pages first, a missing summary as an empty body.
 *
 * # Errors
 *
 * Fails when either argument is not an array of the expected element type.
 */
export function workspaceBodies(vault_bodies: readonly string[], paper_summaries: readonly (string | null | undefined)[]): string[];

/**
 * [`wf_core::sync::workspace_snapshot::workspace_snapshot_counts`] for JS.
 *
 * # Errors
 *
 * Fails when the snapshot cannot be stringified or read.
 */
export function workspaceSnapshotCounts(snapshot: object): B.WorkspaceSnapshotCounts;

/**
 * [`wrap_region`](tpl::wrap_region). Throws on an unknown kind.
 *
 * # Errors
 *
 * Fails if `kind` is neither `generated` nor `editable`.
 */
export function wrapRegion(kind: string, name: string, body: string): string;

/**
 * [`wf_core::sync::text_diff::write_conflict_markers`] for JS.
 *
 * # Errors
 *
 * Fails when either text is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function writeConflictMarkers(ours: string, theirs: string): string;

/**
 * [`wf_core::sync::frontmatter::write_frontmatter`] for JS. Fields are written
 * in object key order; a `null` (JS `undefined`) value is skipped, as in the TS.
 *
 * # Errors
 *
 * Fails when `body` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units, or when
 * `fields` is not an object.
 */
export function writeFrontmatter(fields: Readonly<Record<string, unknown>>, body: string): string;

/**
 * [`wf_core::sync::ink_note::write_ink_note_body`] for JS.
 *
 * # Errors
 *
 * Fails when `text` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units, or when
 * `meta` is not an `InkNoteMeta` (unknown paper or hand included).
 */
export function writeInkNoteBody(meta: Omit<B.InkNoteMeta, "pageOrder"> & { readonly pageOrder: readonly string[] }, text: string): string;

/**
 * [`write_ink_note_meta`](ink_note::write_ink_note_meta) as a plain object, keys in TS order.
 *
 * # Errors
 *
 * Fails if `meta` has the wrong shape.
 */
export function writeInkNoteMeta(meta: unknown): Record<string, unknown>;

/**
 * [`cache_invalidation::write_scope`] for the resource type named `resource_type`: the repo
 * caches and screen caches one write clears. `undefined` for an unknown name.
 *
 * # Errors
 *
 * Fails if `resource_type` exceeds `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function writeScope(resource_type: string): any;

/**
 * [`year_colours`](node_colouring::year_colours): `[id, colour]` pairs for `[id, year]` pairs.
 *
 * # Errors
 *
 * Fails if `years` is not an array of `[id, number]` pairs.
 */
export function yearColours(years: readonly (readonly [string, number])[]): [string, string][];

/**
 * [`YEAR_SPACING`](timeline::YEAR_SPACING): canvas units between one publication year and the next.
 */
export function yearSpacing(): number;

/**
 * [`wf_core::papers::open_access::zenodo_record_id`]: the Zenodo record id in a DOI, or `None`.
 */
export function zenodoRecordId(doi: string): string | undefined;

/**
 * [`zoom_in`] (TS `zoomIn`); `step` defaults to 1.25.
 */
export function zoomIn(scale: number, step?: number | null): number;

/**
 * [`zoom_out`] (TS `zoomOut`); `step` defaults to 1.25.
 */
export function zoomOut(scale: number, step?: number | null): number;

/**
 * [`annotation_from_item`] (TS `zoteroAnnotationFromItem`).
 *
 * # Errors
 *
 * Fails if `item` is not a Zotero item.
 */
export function zoteroAnnotationFromItem(item: B.ZoteroItemRow): B.ZoteroAnnotation;

/**
 * [`zotero_arxiv_id`] (TS `zoteroArxivId`). The arXiv id of a Zotero item, or null.
 *
 * # Errors
 *
 * Fails if `item` is not a Zotero item.
 */
export function zoteroArxivId(item: B.ZoteroItem): string | null;

/**
 * [`zotero_attempt_backoff_ms`](zotero_library::zotero_attempt_backoff_ms): the wait after a 429
 * with no usable header (TS `BackoffGate.noteAttempt`).
 */
export function zoteroAttemptBackoffMs(attempt: number): number;

/**
 * [`zotero_content_keys`] (TS `zoteroContentKeys`). The keys a paper matches on.
 */
export function zoteroContentKeys(doi?: string | null, arxiv_id?: string | null, title?: string | null): string[];

/**
 * [`zotero_headers`](zotero_library::zotero_headers): the API key and version headers for a
 * request, as a plain object.
 *
 * # Errors
 *
 * Fails only if the headers cannot be converted to a JS value.
 */
export function zoteroHeaders(api_key: string): Record<string, string>;

/**
 * [`is_pdf_attachment`] (TS `zoteroIsPdfAttachment`).
 *
 * # Errors
 *
 * Fails if `item` is not a Zotero item.
 */
export function zoteroIsPdfAttachment(item: B.ZoteroItemRow): boolean;

/**
 * [`item_key`] (TS `zoteroItemKey`). The key, or `undefined`.
 *
 * # Errors
 *
 * Fails if `item` is not a Zotero item.
 */
export function zoteroItemKey(item: B.ZoteroItemRow): string | undefined;

/**
 * [`zotero_key_of`] (TS `zoteroKeyOf`): the paper's Zotero item key, or `undefined`.
 *
 * # Errors
 *
 * Fails if `metadata` is not an object of JSON values.
 */
export function zoteroKeyOf(metadata: Record<string, unknown> | null | undefined): string | undefined;

/**
 * [`zotero_keys_url`](zotero_library::zotero_keys_url): a keys-only read (TS `fetchZoteroItemKeys`).
 *
 * # Errors
 *
 * Fails if `params` is not a list of `[key, value]` pairs.
 */
export function zoteroKeysUrl(base_url: string, path: string | null | undefined, params: readonly [string, string | null | undefined][]): string;

/**
 * [`zotero_library_url`](zotero_library::zotero_library_url): the API URL for a library path.
 */
export function zoteroLibraryUrl(library: string, api_origin: string): string;

/**
 * The message for the 403 the local API answers when its preference is off (TS
 * `ZOTERO_LOCAL_API_OFF`).
 */
export function zoteroLocalApiOff(): string;

/**
 * [`zotero_local_status_message`](zotero_local_status::zotero_local_status_message)
 * (TS `zoteroLocalStatusMessage`).
 *
 * # Errors
 *
 * Fails if the result cannot be converted.
 */
export function zoteroLocalStatusMessage(status: number): string | null;

/**
 * [`note_from_item`] (TS `zoteroNoteFromItem`). The note, or `undefined` when it has no text.
 *
 * # Errors
 *
 * Fails if `item` is not a Zotero item.
 */
export function zoteroNoteFromItem(item: B.ZoteroItemRow): B.ZoteroAnnotation | undefined;

/**
 * [`zotero_page_starts`](zotero_library::zotero_page_starts): the offsets after the first page
 * (TS `fetchAllZoteroItems`).
 *
 * # Errors
 *
 * Fails only if the offsets cannot be converted to a JS array.
 */
export function zoteroPageStarts(total: number, page: number): number[];

/**
 * [`zotero_page_url`](zotero_library::zotero_page_url): one page of a Zotero read (TS `buildUrl`).
 * `params` is the `Object.entries` list of the request params, so its order is kept.
 *
 * # Errors
 *
 * Fails if `params` is not a list of `[key, value]` pairs.
 */
export function zoteroPageUrl(base_url: string, path: string | null | undefined, params: readonly [string, string | null | undefined][], start: number, limit: number): string;

/**
 * [`pick_main_pdf`] (TS `zoteroPickMainPdf`). The main PDF's key, or `undefined`.
 *
 * # Errors
 *
 * Fails if `pdfs` is not an array of Zotero items.
 */
export function zoteroPickMainPdf(pdfs: readonly B.ZoteroItemRow[]): string | undefined;

/**
 * Joins a pull's attachments, annotations and notes to their papers (TS
 * `ZoteroAnnotations.pull`). `allowedPaperKeys` is `null` for the whole library.
 * Returns `{ byPaper: [key, annotations][], attachments: [paperKey, attKey][], choices: string[] }`.
 *
 * # Errors
 *
 * Fails if an item is not a Zotero item row or the key list is not strings.
 */
export function zoteroPullJoin(attachments: readonly B.ZoteroItemRow[], annotations: readonly B.ZoteroItemRow[], notes: readonly B.ZoteroItemRow[], allowed_paper_keys: readonly string[] | null): { byPaper: [string, B.ZoteroAnnotation[]][]; attachments: [string, string][]; choices: string[] };

/**
 * [`zotero_remote_to_input`] (TS `zoteroRemoteToInput`). A paper read from a Zotero item,
 * with its key kept under `metadata.zoteroKey`.
 *
 * # Errors
 *
 * Fails if `item` is not a Zotero item.
 */
export function zoteroRemoteToInput(item: B.ZoteroItem): B.ZoteroPaperInput;

/**
 * [`zotero_remote_to_metadata`] (TS `zoteroRemoteToMetadata`). The metadata a metadata
 * lookup returns for a Zotero item.
 *
 * # Errors
 *
 * Fails if `item` is not a Zotero item.
 */
export function zoteroRemoteToMetadata(item: B.ZoteroItem): B.ZoteroPaperInput;

/**
 * [`zotero_server_backoff_ms`](zotero_library::zotero_server_backoff_ms): the wait a response's
 * `Backoff` (or `Retry-After`) header asks for, or `undefined` (TS `BackoffGate.note`).
 */
export function zoteroServerBackoffMs(backoff?: string | null, retry_after?: string | null): number | undefined;

/**
 * [`sync_plan`](zotero_sync_plan::sync_plan) (TS `ZoteroSync`): which remote items to pull, and
 * which local papers to push or delete, from one snapshot.
 *
 * # Errors
 *
 * Fails if `remote` or `local` is not a list of the expected shape, or the plan cannot be converted.
 */
export function zoteroSyncPlan(remote: readonly B.ZoteroItem[], local: readonly { doi?: string | null; arxivId?: string | null; title?: string | null; zoteroKey?: string | null }[]): { pull: number[]; push: number[]; delete: number[] };

/**
 * [`zotero_top_level_path`](zotero_library::zotero_top_level_path): the top-level items path,
 * inside a collection when one is given.
 */
export function zoteroTopLevelPath(collection?: string | null): string;

/**
 * [`zotero_total_results`](zotero_library::zotero_total_results): the `Total-Results` count, or
 * `undefined` when absent or unusable (TS `getPage`).
 */
export function zoteroTotalResults(header?: string | null): number | undefined;

/**
 * [`create_outcomes`]: one `{ id, outcome, ... }` per annotation of a batch create. `body` is the
 * reply's JSON; a non-object or unreadable body counts as an empty reply.
 *
 * # Errors
 *
 * Fails if `ids` is not an array of strings or the result cannot be converted to a JS value.
 */
export function zoteroWriteBackCreateOutcomes(ids: readonly string[], status: number, detail: string, body: unknown, library_version?: number | null): { id: string; outcome: "created" | "updated" | "conflict" | "failed"; zoteroKey?: string; zoteroVersion?: number; reason?: string }[];

/**
 * [`library_version`]: the `Last-Modified-Version` header as a number, or `undefined`.
 */
export function zoteroWriteBackLibraryVersion(raw?: string | null): number | undefined;

/**
 * [`zotero_write_back_message`]: the sync line's Zotero part for a summary, or `""` for null.
 *
 * # Errors
 *
 * Fails if `summary` is neither null nor a write-back summary object.
 */
export function zoteroWriteBackMessage(summary: B.ZoteroWriteBackSummary | null): string;

/**
 * [`update_headers`]: the PATCH headers, with the version guard when `zoteroVersion` is known.
 *
 * # Errors
 *
 * Fails if the result cannot be converted to a JS value.
 */
export function zoteroWriteBackUpdateHeaders(api_key: string, zotero_version?: number | null): Record<string, string>;

/**
 * [`update_outcome`]: `{ id, outcome, zoteroKey, zoteroVersion?, reason? }` for one PATCH.
 *
 * # Errors
 *
 * Fails if the result cannot be converted to a JS value.
 */
export function zoteroWriteBackUpdateOutcome(id: string, zotero_key: string, status: number, detail: string, library_version?: number | null): { id: string; outcome: "created" | "updated" | "conflict" | "failed"; zoteroKey?: string; zoteroVersion?: number; reason?: string };

/**
 * [`update_url`]: `<base>/items/<key>` with the key percent-encoded.
 */
export function zoteroWriteBackUpdateUrl(base: string, zotero_key: string): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_aiaccesspolicy_free: (a: number, b: number) => void;
    readonly __wbg_archivebudget_free: (a: number, b: number) => void;
    readonly __wbg_erasersweepstate_free: (a: number, b: number) => void;
    readonly __wbg_inkcapturebatch_free: (a: number, b: number) => void;
    readonly __wbg_inkcapturestream_free: (a: number, b: number) => void;
    readonly __wbg_inkroutepicker_free: (a: number, b: number) => void;
    readonly __wbg_inkstrokepacker_free: (a: number, b: number) => void;
    readonly __wbg_minisearchdocs_free: (a: number, b: number) => void;
    readonly __wbg_nibfilter_free: (a: number, b: number) => void;
    readonly __wbg_oneeurofilter_free: (a: number, b: number) => void;
    readonly __wbg_searchindexstate_free: (a: number, b: number) => void;
    readonly __wbg_strokeedgesplit_free: (a: number, b: number) => void;
    readonly __wbg_vectorindex_free: (a: number, b: number) => void;
    readonly absolutePointTriples: (a: number, b: number) => [number, number, number, number];
    readonly accountAttention: (a: any) => [number, number, number];
    readonly accountLinks: (a: any) => [number, number, number];
    readonly acronymsForTitle: (a: number, b: number) => [number, number, number];
    readonly activateTab: (a: any, b: number, c: number, d: number) => [number, number, number];
    readonly activeTab: (a: any) => [number, number, number];
    readonly activeTabKey: (a: any) => [number, number, number, number];
    readonly activeTabRef: (a: any) => [number, number, number];
    readonly addCounts: (a: any, b: any) => [number, number, number];
    readonly addDays: (a: number, b: number, c: number) => [number, number, number, number];
    readonly addedNotice: (a: number) => [number, number];
    readonly admitAssetBytes: (a: number, b: number, c: any) => [number, number, number];
    readonly adoptedAccount: (a: number, b: number) => [number, number];
    readonly afterCycle: (a: number, b: number) => [number, number, number];
    readonly afterFailure: (a: number) => [number, number, number];
    readonly agreementBetween: (a: any, b: any, c: any) => [number, number, number];
    readonly aiCredentialProtectedProposalKinds: () => [number, number, number];
    readonly aiProposalKinds: () => [number, number, number];
    readonly aiReadCategories: () => [number, number, number];
    readonly aiReadCategoryForResource: (a: any) => [number, number, number];
    readonly aiaccesspolicy_evaluate: (a: number, b: any) => [number, number, number];
    readonly aiaccesspolicy_new: () => number;
    readonly alignSeries: (a: any) => [number, number, number];
    readonly analyzePdfDocument: (a: any, b: number) => [number, number, number];
    readonly anchorAt: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly annotationDocId: (a: number, b: number) => [number, number];
    readonly annotationIdentity: (a: any) => [number, number, number, number];
    readonly annotationPinKey: (a: number, b: number, c: number, d: number) => [number, number];
    readonly annotationPinToDomain: (a: any) => [number, number, number];
    readonly appCanonicalUrl: (a: number, b: number) => [number, number, number];
    readonly appContentTypeFor: (a: number, b: number) => [number, number];
    readonly appFileCandidates: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly appHeaders: (a: number, b: number) => [number, number, number];
    readonly appIsPageRequest: (a: number, b: number) => number;
    readonly appOriginFrom: (a: number, b: number) => [number, number];
    readonly appendInkStroke: (a: any, b: any) => [number, number, number];
    readonly appendPaperNote: (a: number, b: number, c: number, d: number) => [number, number];
    readonly appendTagHashtags: (a: number, b: number, c: any) => [number, number, number, number];
    readonly applyAnnotationPatch: (a: any, b: any) => [number, number, number];
    readonly applyCommaPlacement: (a: any, b: any) => [number, number, number];
    readonly applyDelta: (a: any, b: any, c: any) => [number, number, number];
    readonly applyGroupCommand: (a: any, b: number, c: any) => [number, number, number];
    readonly applyInkSegmentation: (a: any, b: any, c: number) => [number, number, number];
    readonly applyTemplate: (a: number, b: number, c: number, d: number, e: any) => [number, number, number, number];
    readonly applyTextOp: (a: number, b: number, c: any) => [number, number, number, number];
    readonly applyUserIntegrationFields: (a: any, b: number, c: number, d: any) => [number, number, number];
    readonly archivebudget_admit: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly archivebudget_new: (a: any) => [number, number, number];
    readonly archivebudget_oversize: (a: number) => [number, number];
    readonly artifactBasename: (a: number, b: number) => [number, number];
    readonly artifactKind: (a: number, b: number) => [number, number];
    readonly arxivCandidates: (a: number, b: number) => [number, number, number];
    readonly arxivEntryToMetadata: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly arxivQueryUrl: (a: number, b: number, c: number, d: number) => [number, number];
    readonly arxivStamp: (a: number, b: number) => [number, number];
    readonly askPrompt: (a: number, b: number, c: any, d: number, e: number) => [number, number, number];
    readonly assemblePageCitations: (a: any, b: any, c: any, d: any, e: number) => [number, number, number];
    readonly assembleWorkspace: (a: any) => [number, number, number];
    readonly assertOverleafFileCount: (a: number) => [number, number];
    readonly assertOverleafTextSize: (a: number, b: number) => [number, number];
    readonly assertSafeCheckoutPath: (a: number, b: number) => [number, number];
    readonly assertSafeExportPath: (a: number, b: number) => [number, number];
    readonly assetExtension: (a: number, b: number) => [number, number];
    readonly assetMimeType: (a: number, b: number) => [number, number];
    readonly assetPath: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly autoApplyTiming: (a: any) => [number, number, number];
    readonly axisSpec: (a: number, b: number) => [number, number, number];
    readonly backlinksForAnnotation: (a: any, b: number, c: number) => [number, number, number];
    readonly bandsCoincide: (a: number, b: number, c: number, d: number) => number;
    readonly batchReferenceLists: (a: any, b: number) => [number, number, number];
    readonly bearerToken: (a: number, b: number) => [number, number];
    readonly bibAddSkipReason: (a: number, b: number, c: number) => [number, number];
    readonly bibImportMessage: (a: number, b: number, c: number) => [number, number];
    readonly bibPaperInput: (a: any) => [number, number, number];
    readonly binomialSmooth: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly blankInkPage: (a: number) => [number, number, number];
    readonly blobProviderForRuntime: (a: number, b: number, c: any) => [number, number, number];
    readonly blobStorageBuckets: () => [number, number, number];
    readonly bodyFontSize: (a: any) => [number, number, number];
    readonly bodyLinksTo: (a: number, b: number, c: number, d: number) => number;
    readonly bodyStats: (a: number, b: number) => [number, number, number];
    readonly bothEndsMerge: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly boundedBody: (a: number, b: number) => [number, number];
    readonly branchRead: (a: any) => [number, number, number];
    readonly branchSave: (a: any) => [number, number, number];
    readonly breadcrumbs: (a: any, b: any, c: number) => [number, number, number];
    readonly bucketAnnotationsByPage: (a: any) => [number, number, number];
    readonly buildAnnotationSortIndex: (a: number, b: number, c: number) => [number, number];
    readonly buildAskRequest: (a: number, b: number, c: any, d: number, e: number) => [number, number, number];
    readonly buildByokRequest: (a: any, b: number, c: number, d: any) => [number, number, number];
    readonly buildExcerpt: (a: any, b: any, c: number, d: number) => [number, number, number];
    readonly buildGraphData: (a: any, b: any, c: any, d: number, e: number, f: number, g: number, h: number) => [number, number, number];
    readonly buildInkRequest: (a: any) => [number, number, number];
    readonly buildLabSnapshotContent: (a: any) => [number, number, number];
    readonly buildListTree: (a: any) => [number, number, number];
    readonly buildListsTree: (a: any) => [number, number, number];
    readonly buildLocusLink: (a: any) => [number, number, number, number];
    readonly buildOverleafExportFiles: (a: any, b: any) => [number, number, number];
    readonly buildPageTree: (a: any) => [number, number, number];
    readonly buildPaperHtmlDocument: (a: any, b: number) => [number, number, number, number];
    readonly buildProposeFillPrompt: (a: any) => [number, number, number, number];
    readonly buildReferenceIndex: (a: any, b: number) => [number, number, number];
    readonly buildSectionTree: (a: any) => [number, number, number];
    readonly buildWikiGraph: (a: any) => [number, number, number];
    readonly buildWikiIndex: (a: any, b: number) => [number, number, number, number];
    readonly buildWorkspaceTree: (a: any) => [number, number, number];
    readonly byokAvailable: (a: any, b: number, c: number) => [number, number, number];
    readonly byokHttpError: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly cachePathSegments: (a: number, b: number) => [number, number, number, number];
    readonly canCreateRole: (a: number, b: number, c: number, d: number) => number;
    readonly canDrop: (a: any, b: any) => [number, number, number];
    readonly canJoinInkGroup: (a: any, b: any, c: number, d: number) => [number, number, number];
    readonly canRename: (a: any) => [number, number, number];
    readonly canStoreUnchanged: (a: number, b: number, c: number) => number;
    readonly canonicalAiToolName: (a: number, b: number) => [number, number];
    readonly cappedEngineConfidence: (a: number) => number;
    readonly cardSnippet: (a: any, b: number) => [number, number, number, number];
    readonly changedSide: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly changesFromReply: (a: number, b: number, c: number) => [number, number, number];
    readonly checkBibliography: (a: any) => [number, number, number];
    readonly checkDecision: (a: any, b: any) => [number, number];
    readonly checkGitRemoteUrl: (a: any) => [number, number, number];
    readonly checkInkChunkBody: (a: number, b: number) => [number, number, number];
    readonly checkNewPaper: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly checkOverleafLinkFolder: (a: any) => [number, number, number];
    readonly checkUrlShape: (a: any) => [number, number, number];
    readonly chooseAnchorStrategy: (a: any, b: number, c: number) => [number, number, number];
    readonly chooseRoot: (a: number, b: number) => [number, number];
    readonly chunkForEmbedding: (a: number, b: number, c: number) => [number, number, number];
    readonly citationAlertFailureLog: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly citationAlertLogBody: (a: number, b: number, c: any) => [number, number, number, number];
    readonly citationAlertMessage: (a: any) => [number, number, number, number];
    readonly citationAlertScore: (a: any) => [number, number, number];
    readonly citationAlertScores: (a: any) => [number, number, number];
    readonly citationCandidates: (a: any) => [number, number, number];
    readonly citationContexts: (a: any) => [number, number, number];
    readonly citationExternalIdRef: (a: any) => [number, number, number];
    readonly citationFormatStorageKey: (a: number, b: number) => [number, number];
    readonly citationIntentLabel: (a: any) => [number, number, number];
    readonly citationIntents: (a: any) => [number, number, number];
    readonly citationItemToRect: (a: any, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly citeKeyOf: (a: any) => [number, number, number, number];
    readonly citedSourceNumbers: (a: number, b: number, c: number) => [number, number, number];
    readonly citedSources: (a: number, b: number, c: any) => [number, number, number];
    readonly claimDigest: (a: any, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly clampInkNoteWidth: (a: number, b: number, c: number) => number;
    readonly clampInkPageSize: (a: number, b: number) => [number, number, number];
    readonly clampInkWidth: (a: number) => number;
    readonly clampInkZoom: (a: number) => number;
    readonly clampPage: (a: number, b: number) => number;
    readonly clampScale: (a: number) => number;
    readonly clampZoomFactor: (a: number, b: number) => number;
    readonly claudeCodeCommands: () => [number, number];
    readonly cleanArxivId: (a: number, b: number) => [number, number];
    readonly cleanGroups: (a: any) => [number, number, number];
    readonly cleanImagePath: (a: number, b: number) => [number, number];
    readonly cleanPaperSummary: (a: number, b: number) => [number, number];
    readonly cleanPaperTitle: (a: number, b: number) => [number, number];
    readonly cleanPastedText: (a: any, b: any) => [number, number, number];
    readonly cleanPdfAddress: (a: number, b: number) => [number, number];
    readonly cleanPdfText: (a: any, b: any) => [number, number, number];
    readonly cleanPmcid: (a: number, b: number) => [number, number];
    readonly cleanUrlsWithRules: (a: any, b: any) => [number, number, number];
    readonly cleanWidgetPalette: (a: any) => [number, number, number];
    readonly cleanWrappedText: (a: any, b: any) => [number, number, number];
    readonly clipSegmentToArea: (a: any, b: any, c: any) => [number, number, number];
    readonly cloneLinks: (a: any) => [number, number, number];
    readonly closeTab: (a: any, b: number, c: number, d: number) => [number, number, number];
    readonly closedTabs: (a: any, b: any) => [number, number, number];
    readonly clusterMarks: (a: any, b: number) => [number, number, number];
    readonly coalesceMentions: (a: any, b: number, c: number, d: any) => [number, number, number];
    readonly coalescerStep: (a: any, b: any) => [number, number, number];
    readonly codexToml: (a: any) => [number, number, number, number];
    readonly coercePaperFieldValue: (a: any, b: any) => [number, number, number];
    readonly coldBlobClientConfig: (a: any) => [number, number, number];
    readonly collapseAlert: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly collapseToEntities: (a: any, b: any, c: number) => [number, number, number];
    readonly collectAnnotationImageRegions: (a: any) => [number, number, number];
    readonly collectCitedKeys: (a: number, b: number) => any;
    readonly collectListIds: (a: any) => [number, number, number];
    readonly collectNewHits: (a: any) => [number, number, number];
    readonly colourToolFor: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly commandForChord: (a: any, b: number, c: number) => [number, number, number];
    readonly commandMatchIndices: (a: any, b: any) => [number, number, number];
    readonly commentFromRow: (a: any) => [number, number, number];
    readonly commitUrl: (a: number, b: number, c: number, d: number) => [number, number];
    readonly communities: (a: any, b: any) => [number, number, number];
    readonly compactInkPath: (a: number, b: number, c: number) => [number, number, number];
    readonly composeInkPageOrder: (a: any, b: any) => [number, number, number];
    readonly composeSpacingAccents: (a: number, b: number) => [number, number];
    readonly computeFitPageScale: (a: any, b: any, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly computeFitWidthScale: (a: any, b: any, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly computeRollupsForPapers: (a: any, b: any, c: any, d: any) => [number, number, number];
    readonly conceptKey: (a: number, b: number) => [number, number];
    readonly conflictRoute: (a: any) => [number, number, number];
    readonly contactAreaMm2: (a: any) => [number, number, number];
    readonly containerResize: (a: any, b: any) => [number, number, number, number];
    readonly containsMath: (a: number, b: number) => number;
    readonly contextMenuPlace: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly contextMenuReduce: (a: any, b: any) => [number, number, number];
    readonly contextNonce: (a: number) => [number, number, number, number];
    readonly contextNonceFrom: (a: number, b: number) => [number, number];
    readonly continuePushRound: (a: any) => [number, number, number];
    readonly copyExtension: (a: number, b: number) => [number, number];
    readonly coreInfo: () => [number, number, number];
    readonly countActionList: (a: any) => [number, number, number];
    readonly countActions: (a: any) => [number, number, number];
    readonly countJsonActions: (a: any) => [number, number, number];
    readonly countOpen: (a: any) => [number, number, number];
    readonly countSectionSources: (a: number, b: number) => number;
    readonly countWords: (a: number, b: number) => number;
    readonly courtesyPauseDue: (a: number, b: number, c: number) => number;
    readonly coveredHitMask: (a: any, b: number, c: number) => [number, number, number];
    readonly coveredHits: (a: any, b: number, c: number, d: number) => [number, number, number];
    readonly coveredTextSpans: (a: any, b: any) => [number, number, number];
    readonly crdtEditableShareTypes: () => [number, number, number];
    readonly creatableRoles: (a: number, b: number) => [number, number, number];
    readonly creatableUnder: (a: any) => [number, number, number];
    readonly createExperiment: (a: any, b: any) => [number, number, number];
    readonly createExperimentWith: (a: any, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly createInkStrokePacker: (a: number) => [number, number, number];
    readonly createLogEntry: (a: any, b: any) => [number, number, number];
    readonly createMemberReply: (a: number, b: number) => [number, number, number];
    readonly createMilestone: (a: any, b: any) => [number, number, number];
    readonly createMilestoneWith: (a: any, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly createPaperRelation: (a: any, b: any) => [number, number, number];
    readonly createPaperRelationWith: (a: any, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly createReadingList: (a: any, b: any) => [number, number, number];
    readonly createReadingListWith: (a: any, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly createReportSection: (a: any, b: any) => [number, number, number];
    readonly createReportSectionWith: (a: any, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly createVaultPage: (a: any, b: any) => [number, number, number];
    readonly createVaultPageWith: (a: any, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly createVectorIndex: (a: number) => [number, number, number];
    readonly createdPageIndex: (a: any, b: any) => [number, number, number];
    readonly creationKindFor: (a: any) => [number, number, number];
    readonly creationTarget: (a: any, b: any, c: any) => [number, number, number];
    readonly cropFigureTo: (a: any, b: any) => [number, number, number];
    readonly crossrefToMetadata: (a: any, b: number, c: number) => [number, number, number];
    readonly crossrefWorkUrl: (a: number, b: number, c: number, d: number) => [number, number];
    readonly damerauLevenshtein: (a: number, b: number, c: number, d: number) => number;
    readonly dashboardAppendCardPair: (a: any, b: number, c: number, d: number, e: number, f: any) => [number, number, number];
    readonly dashboardBuildStats: (a: any, b: number, c: number) => [number, number, number];
    readonly dashboardCardDef: (a: number, b: number) => [number, number, number];
    readonly dashboardCardRegistry: () => [number, number, number];
    readonly dashboardCardsForRole: (a: number, b: number) => [number, number, number];
    readonly dashboardCloseGaps: (a: any, b: any, c: number) => [number, number, number];
    readonly dashboardCompactVertical: (a: any, b: number) => [number, number, number];
    readonly dashboardDataSourcesForCardTypes: (a: any) => [number, number, number];
    readonly dashboardDefaultLayout: (a: number) => [number, number, number];
    readonly dashboardFinalizeLayout: (a: any, b: any) => [number, number, number];
    readonly dashboardFitMaxHeights: () => [number, number, number];
    readonly dashboardIsStatCard: (a: number, b: number) => [number, number, number];
    readonly dashboardLayoutCacheKey: (a: number, b: number, c: number) => [number, number];
    readonly dashboardLayoutFloors: (a: any, b: number) => [number, number, number];
    readonly dashboardLayoutSignature: (a: any) => [number, number, number, number];
    readonly dashboardLgNeedsRepair: (a: any, b: any) => [number, number, number];
    readonly dashboardMergeRglPositions: (a: any, b: any, c: any, d: number) => [number, number, number];
    readonly dashboardMergeSupervisorCards: (a: any, b: any, c: any) => [number, number, number];
    readonly dashboardNeedsAttention: (a: any, b: any, c: any, d: number, e: number) => [number, number, number];
    readonly dashboardNormalizeItem: (a: any, b: any, c: number) => [number, number, number];
    readonly dashboardPackSm: (a: any, b: any) => [number, number, number];
    readonly dashboardResolveDeps: (a: any) => [number, number, number];
    readonly dashboardSmNeedsRepack: (a: any, b: any) => [number, number, number];
    readonly dashboardSuperviseeCounts: (a: any, b: any, c: number, d: number) => [number, number, number];
    readonly dashboardSyncLayouts: (a: any, b: any) => [number, number, number];
    readonly dashboardTeamAttention: (a: any, b: number, c: number) => [number, number, number];
    readonly dashboardTopTags: (a: any, b: number) => [number, number, number];
    readonly daysUntilDate: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly decideAnnotationSync: (a: any, b: number, c: number) => [number, number, number];
    readonly decideGitSyncPath: (a: any, b: number, c: number) => [number, number, number];
    readonly decideVaultCommit: (a: number, b: any) => [number, number, number];
    readonly declaredCharset: (a: number, b: number, c: number, d: number) => [number, number];
    readonly declaredLengthOverCap: (a: number, b: number) => number;
    readonly decodeBase64: (a: number, b: number) => [number, number, number, number];
    readonly decodeBytea: (a: any) => [number, number, number];
    readonly decodeHtmlEntities: (a: number, b: number) => [number, number, number, number];
    readonly decodeInkWords: (a: any, b: any, c: number, d: number) => [number, number, number];
    readonly decodeLocus: (a: number, b: number) => [number, number, number];
    readonly decodeShareLinkToken: (a: number, b: number) => [number, number, number, number];
    readonly deepestFirstListIds: (a: number, b: number, c: any) => [number, number, number, number];
    readonly defaultExpanded: (a: any) => [number, number, number];
    readonly defaultGraphSettings: () => [number, number, number];
    readonly defaultInkNoteMeta: () => [number, number, number];
    readonly defaultModeFor: (a: number, b: number) => [number, number, number];
    readonly defaultOpenSections: (a: any) => [number, number, number];
    readonly defaultPasteSettings: () => [number, number, number];
    readonly defaultShareLinkExpiresAt: (a: number) => [number, number];
    readonly defaultSourceNoteTemplate: () => [number, number];
    readonly degreeColours: (a: any) => [number, number, number];
    readonly deletedLocalBase: (a: any) => [number, number, number];
    readonly deletedRemoteSides: (a: any, b: any) => [number, number, number];
    readonly deletionAction: (a: any, b: any, c: any, d: number, e: number, f: any) => [number, number, number];
    readonly deletionFor: (a: any, b: any) => [number, number, number];
    readonly describeChanges: (a: any) => [number, number, number, number];
    readonly describeFreeCopyFailure: (a: any, b: number) => [number, number, number, number];
    readonly describeOverleafStatus: (a: any) => [number, number, number, number];
    readonly describePull: (a: any) => [number, number, number, number];
    readonly describePush: (a: any) => [number, number, number, number];
    readonly describeRejection: (a: any, b: number, c: number, d: number) => [number, number];
    readonly describeRemoteStatus: (a: any) => [number, number, number, number];
    readonly describeSync: (a: any) => [number, number, number, number];
    readonly describeUrlRejection: (a: any) => [number, number, number, number];
    readonly detectCitationStyle: (a: any) => [number, number, number];
    readonly detectColumns: (a: any) => [number, number, number];
    readonly deviceLabel: (a: number, b: number) => [number, number];
    readonly deviceMarkers: (a: number, b: number, c: number, d: number) => [number, number];
    readonly diffAnnotationFields: (a: any) => [number, number, number];
    readonly diffBody: (a: any, b: any) => [number, number, number];
    readonly diffJsonData: (a: any, b: any, c: number) => [number, number, number];
    readonly diffRefreshPlan: (a: any, b: any, c: any) => [number, number, number];
    readonly diffWorkspace: (a: any, b: any, c: number) => [number, number, number];
    readonly digestText: (a: number, b: number) => [number, number];
    readonly dirEntryNames: (a: number, b: number, c: number, d: number) => [number, number];
    readonly distanceToSegmentSquared: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly distinctRelated: (a: any, b: any, c: number, d: number, e: number, f: number, g: number) => [number, number, number];
    readonly documentBoost: (a: any, b: any) => [number, number, number];
    readonly documentIdOf: (a: number, b: number) => [number, number];
    readonly documentIdOfPath: (a: number, b: number) => [number, number];
    readonly documentKind: (a: number, b: number) => [number, number, number];
    readonly documentSuffix: (a: number, b: number) => [number, number, number];
    readonly doubleClickFigure: (a: any, b: any, c: number) => [number, number, number];
    readonly draftFromTextSelection: (a: any) => [number, number, number];
    readonly draftIcon: (a: any) => [number, number, number];
    readonly draftImageRegion: (a: any) => [number, number, number];
    readonly draftInkAnnotation: (a: any) => [number, number, number];
    readonly draftMakes: (a: any) => [number, number, number];
    readonly draftPicture: (a: any) => [number, number, number];
    readonly draftPlaceholder: (a: any) => [number, number, number];
    readonly draftReadingLog: (a: any, b: any, c: number, d: number) => [number, number, number, number];
    readonly draftTextBox: (a: any) => [number, number, number];
    readonly dropParentId: (a: any) => [number, number, number];
    readonly duplicatePlan: (a: any, b: any) => [number, number, number];
    readonly editSides: (a: any) => [number, number, number];
    readonly editedRelativeLabel: (a: number) => any;
    readonly effectiveFieldBoosts: (a: number) => [number, number, number];
    readonly effectiveRelationTypes: (a: any) => [number, number, number];
    readonly emaSmooth: (a: any, b: number) => [number, number, number];
    readonly embedIdleEvictMs: () => number;
    readonly embedTitles: (a: number, b: number) => [number, number];
    readonly embeddableText: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly emptyCellPaperIds: (a: any, b: number, c: number, d: any) => [number, number, number];
    readonly emptyIntegration: (a: any) => [number, number, number];
    readonly emptyLayout: (a: number, b: number) => [number, number, number];
    readonly emptyPageHistory: () => [number, number, number];
    readonly encodeBase64: (a: number, b: number) => [number, number];
    readonly encodeBytea: (a: number, b: number) => [number, number];
    readonly encodeInkChunkBody: (a: any) => [number, number, number, number];
    readonly encodeLocus: (a: any) => [number, number, number, number];
    readonly encodeOpenGroups: (a: any) => [number, number, number, number];
    readonly encodeRollupOptions: (a: any) => [number, number, number, number];
    readonly encodeShareLinkToken: (a: number, b: number) => [number, number];
    readonly engineStartParams: (a: any) => [number, number, number];
    readonly entityDir: (a: number, b: number, c: number) => [number, number, number, number];
    readonly entryFileError: (a: number, b: number) => any;
    readonly enumLabel: (a: number, b: number, c: number, d: number) => [number, number];
    readonly enumOptions: (a: number, b: number) => [number, number, number];
    readonly eraseInkPaths: (a: any, b: number, c: number, d: number) => [number, number, number];
    readonly erasersweepstate_begin: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly erasersweepstate_end: (a: number, b: number) => [number, number];
    readonly erasersweepstate_hover: (a: number, b: number) => [number, number];
    readonly erasersweepstate_leave: (a: number, b: number) => [number, number];
    readonly erasersweepstate_new: () => number;
    readonly erasersweepstate_owns: (a: number, b: number) => number;
    readonly erasersweepstate_release: (a: number, b: number) => [number, number];
    readonly errorDetail: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly errorLogConsoleLine: (a: number, b: number, c: number, d: number) => [number, number];
    readonly errorLogEntry: (a: number, b: number) => [number, number, number];
    readonly errorLogIsNoise: (a: number, b: number) => number;
    readonly errorLogPushLine: (a: any, b: number, c: number) => [number, number, number];
    readonly errorLogRecordUncaught: (a: any, b: number, c: number) => [number, number, number];
    readonly errorLogRemember: (a: any, b: number, c: number) => [number, number, number];
    readonly escapeHtml: (a: number, b: number) => [number, number];
    readonly escapeLatexText: (a: number, b: number) => [number, number];
    readonly escapeLinkLabel: (a: any) => [number, number, number, number];
    readonly evaluateAiAccess: (a: any, b: number, c: number) => [number, number, number];
    readonly excerptOf: (a: number, b: number, c: any) => [number, number, number];
    readonly excerptSegments: (a: any) => [number, number, number];
    readonly exclusionReasons: (a: any, b: number) => [number, number, number];
    readonly execCommandName: (a: number, b: number) => [number, number];
    readonly expandEmbeds: (a: number, b: number, c: any) => [number, number, number, number];
    readonly expandIpv6: (a: number, b: number) => [number, number, number];
    readonly experimentActivityAt: (a: any) => [number, number, number];
    readonly experimentHref: (a: number, b: number, c: number) => [number, number];
    readonly experimentsListHref: () => [number, number];
    readonly explainArm: (a: any) => [number, number, number, number];
    readonly exportAssetPath: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly exportManifestJson: (a: number, b: number, c: any) => [number, number, number, number];
    readonly exportReadme: (a: number, b: number) => [number, number];
    readonly extractDoi: (a: any) => [number, number, number, number];
    readonly extractHashtagRefs: (a: number, b: number) => [number, number, number];
    readonly extractHashtags: (a: number, b: number) => [number, number];
    readonly extractHeadings: (a: number, b: number) => [number, number];
    readonly extractLexical: (a: any) => [number, number, number];
    readonly extractPageMetadata: (a: any, b: any) => [number, number, number];
    readonly extractPageTitle: (a: number, b: number) => [number, number, number];
    readonly extractVenue: (a: number, b: number) => [number, number];
    readonly extractWikilinks: (a: number, b: number) => [number, number, number];
    readonly extractionCsv: (a: any, b: any, c: any) => [number, number, number, number];
    readonly extractionMarkdown: (a: any, b: any, c: any) => [number, number, number, number];
    readonly fenceUntrusted: (a: any, b: number, c: number) => [number, number, number, number];
    readonly fetchLimits: () => [number, number, number];
    readonly figureAltFor: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly figureClipText: (a: any) => [number, number, number, number];
    readonly figureCornerHit: (a: number) => number;
    readonly figureImageFrame: (a: any) => [number, number, number];
    readonly figureLabel: (a: number, b: number, c: number) => [number, number];
    readonly figureUnder: (a: any, b: any, c: number) => [number, number, number];
    readonly filterCiteCompletions: (a: any, b: number, c: number) => [number, number, number, number];
    readonly filterGraphByNodes: (a: any, b: any, c: any) => [number, number, number];
    readonly filterLabMembers: (a: number, b: number, c: any, d: any) => [number, number, number];
    readonly filterOperator: (a: number, b: number) => [number, number];
    readonly filterRows: (a: any, b: number, c: number) => [number, number, number];
    readonly filterTeamMembers: (a: number, b: number, c: any, d: any) => [number, number, number];
    readonly findAnnotationBacklinks: (a: any) => [number, number, number];
    readonly findCitationCandidates: (a: any) => [number, number, number];
    readonly findDocumentMatches: (a: any, b: number, c: number) => [number, number, number];
    readonly findDuplicateGroups: (a: any) => [number, number, number];
    readonly findFigureMentions: (a: any, b: number) => [number, number, number];
    readonly findHeadingLines: (a: any, b: number, c: any) => [number, number, number];
    readonly findImageRefs: (a: any, b: any, c: number) => [number, number, number];
    readonly findMarks: (a: any, b: number, c: any) => [number, number, number];
    readonly findPatternCitationMentions: (a: any, b: any, c: number, d: number) => [number, number, number];
    readonly findQuoteMatches: (a: number, b: number, c: any) => [number, number, number];
    readonly findReferenceSection: (a: any, b: number, c: number, d: number) => [number, number, number];
    readonly findRelated: (a: number, b: number, c: any, d: number, e: number) => [number, number, number];
    readonly findTitleMatch: (a: number, b: number, c: number, d: number) => number;
    readonly findWikiRoot: (a: any) => [number, number, number];
    readonly finishedLinks: (a: number, b: number, c: number) => [number, number];
    readonly fitCols: (a: number, b: number) => number;
    readonly fitLayoutToContent: (a: any, b: any, c: any) => [number, number, number];
    readonly fitScale: (a: number, b: number) => number;
    readonly fitsInkNoteBudget: (a: number, b: number) => number;
    readonly flatPath: (a: any, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number, number];
    readonly flattenOverleafDocs: (a: any) => [number, number, number];
    readonly flattenOverleafFiles: (a: any) => [number, number, number];
    readonly flattenPaperRows: (a: any, b: any, c: any, d: any) => [number, number, number];
    readonly flattenTree: (a: any) => [number, number, number];
    readonly focusPane: (a: any, b: number, c: number) => [number, number, number];
    readonly focusedTabCount: (a: any) => [number, number, number];
    readonly folderDraftForProject: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly folderIdsOf: (a: any) => [number, number, number];
    readonly folderKey: (a: number, b: number) => [number, number];
    readonly folderKeys: (a: number, b: number) => [number, number];
    readonly folderTitleFromPath: (a: number, b: number) => [number, number];
    readonly fontSizeOf: (a: any) => [number, number, number];
    readonly forgetSearchQuery: (a: number, b: number, c: number, d: number) => [number, number];
    readonly formatCitation: (a: number, b: number, c: number, d: number) => [number, number];
    readonly formatCount: (a: number) => [number, number];
    readonly formatCursor: (a: any) => [number, number, number, number];
    readonly formatDate: (a: number, b: number, c: number) => [number, number];
    readonly formatDateTime: (a: number, b: number, c: number) => [number, number];
    readonly formatError: (a: any, b: number, c: number, d: number) => [number, number];
    readonly formatErrorForResponse: (a: any, b: number, c: number, d: number, e: number, f: number) => any;
    readonly formatFigureTokens: (a: any) => [number, number, number, number];
    readonly formatInviteCode: (a: number, b: number) => [number, number];
    readonly formatLogLine: (a: any) => [number, number, number, number];
    readonly formatMetricCell: (a: number, b: number, c: any) => [number, number, number, number];
    readonly formatMetricValue: (a: number, b: number, c: number) => [number, number];
    readonly formatPaperCitation: (a: any, b: number, c: number) => [number, number, number, number];
    readonly formatQuoteBlock: (a: number, b: number) => [number, number, number, number];
    readonly formatQuoteCiteClipboard: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly formatReference: (a: any) => [number, number, number, number];
    readonly formatRelative: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly formatWords: (a: number) => [number, number];
    readonly freeCopyAttemptLimits: () => [number, number, number];
    readonly fromRelativeBlobLinks: (a: any, b: any) => [number, number, number, number];
    readonly frontmatterList: (a: any, b: number, c: number) => [number, number, number];
    readonly frontmatterString: (a: any, b: number, c: number) => [number, number, number, number];
    readonly fullImageThumbnailPath: (a: number, b: number) => [number, number];
    readonly furnitureKey: (a: number, b: number) => [number, number];
    readonly furnitureLines: (a: any) => [number, number, number];
    readonly fuseRankings: (a: any, b: number, c: number) => [number, number, number];
    readonly fuzzinessForTerm: (a: number, b: number) => number;
    readonly gateVectorHits: (a: any, b: number, c: number, d: number) => [number, number, number];
    readonly gateVectorMask: (a: any, b: number, c: number) => [number, number, number];
    readonly geminiInstall: () => [number, number];
    readonly getUserIntegrationField: (a: any, b: number, c: number, d: number, e: number) => [number, number, number, number];
    readonly gitBasicAuth: (a: number, b: number, c: number, d: number) => [number, number];
    readonly gitConnection: (a: any) => [number, number, number];
    readonly gitConnectionReady: (a: any) => [number, number, number];
    readonly gitNulList: (a: number, b: number) => [number, number, number];
    readonly gitOverwrittenFiles: (a: number, b: number) => [number, number, number];
    readonly gitParseLog: (a: number, b: number) => [number, number, number];
    readonly gitParseStatus: (a: number, b: number) => [number, number, number];
    readonly gitPathChunks: (a: any, b: number) => [number, number, number];
    readonly gitReadFailureMessage: (a: number, b: number, c: number) => [number, number];
    readonly gitReadPlan: (a: any) => [number, number, number];
    readonly gitReason: (a: number, b: number) => [number, number];
    readonly gitRemoteAuth: (a: any) => [number, number, number];
    readonly gitStatusState: (a: number, b: number) => [number, number];
    readonly githubCommits: (a: any) => [number, number, number];
    readonly githubRepoPdfPath: (a: number, b: number, c: number, d: number) => any;
    readonly gitlabCombinedActive: (a: any) => [number, number, number];
    readonly gitlabCommits: (a: any) => [number, number, number];
    readonly gitlabLogFilePlan: (a: any) => [number, number, number];
    readonly graphDegrees: (a: any) => [number, number, number];
    readonly graphDensity: (a: any) => [number, number, number];
    readonly graphFilterCount: (a: any, b: any, c: any) => [number, number, number];
    readonly graphFilterCountFor: (a: number, b: number, c: any) => [number, number, number];
    readonly graphPalette: () => [number, number, number];
    readonly graphTagNames: (a: any, b: any, c: any, d: number) => [number, number, number];
    readonly graphTopologyKey: (a: any, b: number, c: number, d: number) => [number, number, number, number];
    readonly groupByDay: (a: any) => [number, number, number];
    readonly groupEligible: (a: any) => [number, number, number];
    readonly groupHunks: (a: any) => [number, number, number];
    readonly groupPaletteRows: (a: any) => [number, number, number];
    readonly groupProposals: (a: any, b: any, c: number) => [number, number, number];
    readonly groupRecurringLines: (a: any, b: any, c: any) => [number, number, number];
    readonly groupResults: (a: any) => [number, number, number];
    readonly groupRuns: (a: any) => [number, number, number];
    readonly groupSubtreeItems: (a: any, b: any) => [number, number, number];
    readonly grownTextRect: (a: any, b: number) => [number, number, number];
    readonly guessBlobContentType: (a: any) => [number, number, number, number];
    readonly guessTitle: (a: number, b: number) => [number, number];
    readonly hasActiveLab: (a: number, b: number, c: any, d: number) => [number, number, number];
    readonly hasConflictMarkers: (a: any) => [number, number, number];
    readonly hasInkView: (a: number, b: number) => number;
    readonly hasLazyBody: (a: number, b: number) => number;
    readonly hasPdfMagic: (a: number, b: number) => number;
    readonly hasPdfView: (a: number, b: number) => number;
    readonly hasResultsTables: (a: any) => [number, number, number];
    readonly hasText: (a: number, b: number) => number;
    readonly headingOutline: (a: any) => [number, number, number];
    readonly headingSlug: (a: any) => [number, number, number, number];
    readonly highlightWithinExcerpt: (a: number, b: number, c: any) => [number, number, number];
    readonly highlightsDigest: (a: any, b: number, c: number) => [number, number, number, number];
    readonly homeConfigPath: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly hostOf: (a: number, b: number) => [number, number];
    readonly htmlFinalUrlHeader: () => [number, number];
    readonly htmlProxyMaxBytes: () => number;
    readonly htmlProxyPath: () => [number, number];
    readonly httpContext: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly httpStatusForKind: (a: number, b: number) => number;
    readonly humanise: (a: number, b: number) => [number, number];
    readonly humanize: (a: number, b: number) => [number, number];
    readonly hydrateTabModes: (a: any, b: any) => [number, number, number];
    readonly hydrateUserSettings: (a: any) => [number, number, number];
    readonly idSuffix: (a: any) => [number, number, number, number];
    readonly ident: (a: number, b: number) => [number, number, number, number];
    readonly imageAltFromFilename: (a: number) => [number, number, number, number];
    readonly imageExtensionForMime: (a: any) => [number, number, number, number];
    readonly imagePathsInBody: (a: any, b: any) => [number, number, number, number];
    readonly imagesOf: (a: any) => [number, number, number, number];
    readonly importRelativePath: (a: number, b: number, c: number, d: number) => [number, number];
    readonly importableEntities: (a: any, b: any) => [number, number, number];
    readonly inItems: (a: number, b: number) => [number, number, number];
    readonly inReferenceList: (a: number, b: number, c: number, d: any) => [number, number, number];
    readonly inboxLinks: (a: any) => [number, number, number];
    readonly incomingRelationLabel: (a: number, b: number) => [number, number];
    readonly indexFromAnalysis: (a: any, b: any) => [number, number, number];
    readonly indexTerms: (a: any, b: any) => [number, number, number];
    readonly indexTermsOf: (a: number, b: number) => [number, number];
    readonly initialPhase: (a: number) => [number, number, number];
    readonly initialReaderViewport: (a: number, b: number) => [number, number, number];
    readonly inkArgbHex: (a: number, b: number, c: number) => [number, number];
    readonly inkAttachmentIndex: (a: number, b: number, c: number, d: number) => number;
    readonly inkBackingRatio: (a: number, b: number, c: number) => number;
    readonly inkBandUnion: (a: number, b: number) => any;
    readonly inkBoundsContain: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly inkBoundsIntersect: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly inkBoundsOf: (a: number, b: number, c: number, d: number) => [number, number];
    readonly inkBoundsUnion: (a: number, b: number, c: number, d: number) => [number, number];
    readonly inkChunkBlobKey: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
    readonly inkChunkBlobSpec: () => [number, number, number];
    readonly inkChunkBodySize: (a: any) => [number, number, number];
    readonly inkChunkHeaderBytes: (a: number, b: number, c: number) => [number, number];
    readonly inkChunkIdOfFileName: (a: number, b: number) => any;
    readonly inkChunkIdsInListing: (a: any) => [number, number, number];
    readonly inkChunkPath: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly inkChunkRawThreshold: () => number;
    readonly inkChunkShouldTryCompress: (a: number) => number;
    readonly inkChunkStoresCompressed: (a: number, b: number) => number;
    readonly inkClampBackgroundIndex: (a: number) => number;
    readonly inkConstants: () => [number, number, number];
    readonly inkContactConsts: () => [number, number, number];
    readonly inkCurveAt: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly inkEngineInfo: (a: number, b: number) => [number, number, number];
    readonly inkEngineRank: (a: number, b: number) => number;
    readonly inkEnumIndex: (a: any, b: number, c: number) => [number, number, number];
    readonly inkEnumValue: (a: any, b: number) => [number, number, number, number];
    readonly inkFlatStrokeSamples: (a: number, b: number, c: number) => [number, number];
    readonly inkHapticsOn: (a: number, b: number) => number;
    readonly inkIsPageSource: (a: number, b: number, c: number, d: number) => number;
    readonly inkIsPdf: (a: number, b: number, c: number, d: number) => number;
    readonly inkKeptIndices: (a: number, b: number) => [number, number];
    readonly inkLassoKeeps: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly inkLineFromHelper: (a: any, b: any) => [number, number, number];
    readonly inkLineRecords: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly inkLineStrokes: (a: any, b: any) => [number, number, number];
    readonly inkNoteWidthToPdfPoints: (a: number) => number;
    readonly inkPageBackground: (a: number, b: number) => [number, number, number];
    readonly inkPageBounds: (a: number, b: number, c: number, d: number) => [number, number];
    readonly inkPageConfidence: (a: any) => [number, number, number];
    readonly inkPageFigures: (a: number, b: number) => [number, number, number];
    readonly inkPageMarker: (a: number) => [number, number];
    readonly inkPageOverBudget: (a: any) => [number, number, number];
    readonly inkPageScissor: (a: any, b: number, c: any, d: any) => [number, number, number];
    readonly inkPageSummary: (a: any) => [number, number, number];
    readonly inkPageSvg: (a: any, b: number) => [number, number, number, number];
    readonly inkPathJsonSize: (a: number, b: number) => number;
    readonly inkPathsBounds: (a: any) => [number, number, number];
    readonly inkPathsHitTest: (a: any, b: number, c: number, d: number) => [number, number, number];
    readonly inkPathsInPolygon: (a: any, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly inkPenPressureByte: (a: number) => number;
    readonly inkPickCandidates: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => [number, number];
    readonly inkPointInPolygon: (a: number, b: number, c: any) => [number, number, number];
    readonly inkPolygonBounds: (a: number, b: number) => [number, number];
    readonly inkPositionOptions: () => [number, number, number];
    readonly inkPressureFactor: (a: number, b: number) => number;
    readonly inkPressureOptions: () => [number, number, number];
    readonly inkPrintDocument: (a: any) => [number, number, number, number];
    readonly inkSidecarDir: (a: number, b: number) => [number, number, number, number];
    readonly inkStrokeBand: (a: any) => [number, number, number];
    readonly inkStrokeBandOf: (a: number, b: number) => [number, number];
    readonly inkStrokeHistoryStep: (a: any, b: any) => [number, number, number];
    readonly inkStrokeInstanceCount: (a: number) => number;
    readonly inkStrokeNearSegment: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => number;
    readonly inkStrokePressures: (a: number, b: number, c: number) => [number, number];
    readonly inkTangentAt: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number];
    readonly inkTrailAlpha: (a: number, b: number) => number;
    readonly inkUnsureConfidence: () => number;
    readonly inkVelocityBetween: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly inkVelocityFactor: (a: number, b: number, c: number) => number;
    readonly inkVocabularyHints: (a: any, b: number, c: number) => [number, number, number];
    readonly inkVocabularyWordList: (a: any) => [number, number, number];
    readonly inkVocabularyWords: (a: any) => [number, number, number];
    readonly inkWidthForPressure: (a: number, b: number, c: number, d: number) => number;
    readonly inkWorkerRoute: (a: any) => [number, number, number];
    readonly inkZoomIn: (a: number) => number;
    readonly inkZoomOut: (a: number) => number;
    readonly inkcapturebatch_count: (a: number) => number;
    readonly inkcapturebatch_flags: (a: number) => [number, number];
    readonly inkcapturebatch_samples: (a: number) => [number, number];
    readonly inkcapturestream_consume: (a: number, b: number, c: number, d: number) => number;
    readonly inkcapturestream_forgetLast: (a: number) => void;
    readonly inkcapturestream_new: () => number;
    readonly inkcapturestream_resetFilter: (a: number) => void;
    readonly inkroutepicker_answer: (a: number, b: number) => [number, number, number];
    readonly inkroutepicker_new: (a: any) => [number, number, number];
    readonly inkroutepicker_start: (a: number) => [number, number, number];
    readonly inkstrokepacker_points: (a: number) => [number, number];
    readonly inkstrokepacker_pressures: (a: number) => [number, number];
    readonly inkstrokepacker_push: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly integrationsBagFromLegacy: (a: any) => [number, number, number];
    readonly invalidationMap: () => [number, number, number];
    readonly invalidationPlan: (a: any) => [number, number, number];
    readonly invertedAbstract: (a: any) => [number, number, number, number];
    readonly isAbsoluteEntry: (a: number, b: number) => number;
    readonly isAbsoluteUrl: (a: number, b: number) => number;
    readonly isAllPages: (a: number, b: number) => number;
    readonly isAllowedPdfProxyUrl: (a: number, b: number) => number;
    readonly isAnnotationSyncState: (a: any) => number;
    readonly isApiHost: (a: number, b: number) => number;
    readonly isAppOwnedPath: (a: any) => [number, number, number];
    readonly isAppStorageKey: (a: number, b: number) => number;
    readonly isBareUrl: (a: any) => [number, number, number];
    readonly isBibFile: (a: number, b: number) => number;
    readonly isBibliographicMatch: (a: any, b: any) => [number, number, number];
    readonly isBlankQuery: (a: number, b: number) => number;
    readonly isBlanketShare: (a: number, b: number) => number;
    readonly isBoldFont: (a: number, b: number) => number;
    readonly isBothEndsRpc: (a: number, b: number) => number;
    readonly isCachePdfUrl: (a: number, b: number) => number;
    readonly isCaughtUp: (a: number, b: number, c: number) => number;
    readonly isCitationDestination: (a: number, b: number) => number;
    readonly isCommitEnter: (a: number, b: number, c: number, d: number) => number;
    readonly isConferenceCopy: (a: any) => [number, number, number];
    readonly isCreatableKind: (a: number, b: number) => number;
    readonly isDismissTap: (a: any, b: any, c: number) => [number, number, number];
    readonly isDocumentKind: (a: number, b: number) => number;
    readonly isDocumentNode: (a: any) => [number, number, number];
    readonly isEditCommand: (a: number, b: number) => number;
    readonly isEditableReaderTarget: (a: any) => number;
    readonly isElectronMcpEntry: (a: any) => [number, number, number];
    readonly isEmptyPaperSummary: (a: number, b: number) => number;
    readonly isExplicitLabMembership: (a: any) => [number, number, number];
    readonly isFolderDraftPath: (a: number, b: number) => number;
    readonly isHighlighterInk: (a: number, b: number) => number;
    readonly isHtmlContentType: (a: number, b: number) => number;
    readonly isHttpsAddress: (a: number, b: number) => number;
    readonly isHydratedPage: (a: number, b: number, c: number, d: number) => number;
    readonly isInheritedLinkCode: (a: number, b: number) => number;
    readonly isInkChunkId: (a: any) => [number, number, number];
    readonly isInkEngineId: (a: number, b: number) => number;
    readonly isInkNoteBody: (a: any) => [number, number, number];
    readonly isInkNoteFrontmatter: (a: any) => [number, number, number];
    readonly isInkNoteId: (a: number, b: number) => number;
    readonly isInkTool: (a: number, b: number) => number;
    readonly isIpAddress: (a: number, b: number) => number;
    readonly isIsoDay: (a: number, b: number) => number;
    readonly isKnownResourceType: (a: number, b: number) => number;
    readonly isLargeCorpus: (a: number) => number;
    readonly isLegacyTokenHex: (a: number, b: number) => number;
    readonly isLibraryListingFresh: (a: number, b: number) => number;
    readonly isLiteral: (a: number, b: number) => [number, number, number, number];
    readonly isLocalZoteroUrl: (a: number, b: number) => number;
    readonly isLoopbackHost: (a: number, b: number, c: number) => number;
    readonly isMarkdownFile: (a: number, b: number) => number;
    readonly isMissingServiceRole: (a: number, b: number) => number;
    readonly isNetworkFailure: (a: number, b: number) => [number, number, number];
    readonly isNetworkFailureValue: (a: any) => number;
    readonly isNewerVersion: (a: any, b: any) => [number, number, number];
    readonly isNoteImportFile: (a: number, b: number) => number;
    readonly isOnSamplingGrid: (a: number) => number;
    readonly isOverleafProjectId: (a: number, b: number) => number;
    readonly isOverleafTextSource: (a: number, b: number) => number;
    readonly isPaperFieldKind: (a: number, b: number) => number;
    readonly isPasteHtmlContentType: (a: number, b: number) => number;
    readonly isPdfContentType: (a: number, b: number) => number;
    readonly isPdfFile: (a: number, b: number, c: number, d: number) => number;
    readonly isPdfTooLarge: (a: number) => number;
    readonly isPenBarrelPointer: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly isPenEraserPointer: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly isPlaceholderTitle: (a: number, b: number) => number;
    readonly isPlainClick: (a: any) => number;
    readonly isPreviewKey: (a: any, b: number) => [number, number, number];
    readonly isPreviewTab: (a: any) => number;
    readonly isPrivateHost: (a: number, b: number) => number;
    readonly isPublicAddress: (a: number, b: number) => number;
    readonly isPublicHttpsUrl: (a: number, b: number) => number;
    readonly isQuotationType: (a: number, b: number) => number;
    readonly isReaderAnnotationType: (a: any) => number;
    readonly isReaderObjectUrl: (a: number, b: number, c: number, d: number) => number;
    readonly isRecentTarget: (a: any) => number;
    readonly isReferenceCacheEntryFresh: (a: number, b: number) => number;
    readonly isRemotePdfUrl: (a: number, b: number) => number;
    readonly isRotatedText: (a: number, b: number) => number;
    readonly isSafeWorkspacePath: (a: any) => [number, number, number];
    readonly isSearchFile: (a: number, b: number) => number;
    readonly isSecretName: (a: number, b: number) => number;
    readonly isSectionOpen: (a: any, b: number, c: number) => [number, number, number];
    readonly isSettled: (a: any, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly isSignedOutRefusal: (a: number, b: number, c: number, d: number) => number;
    readonly isSkippedDir: (a: number, b: number) => number;
    readonly isStaleRunningExperiment: (a: any, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number];
    readonly isStoredPdfUrl: (a: number, b: number) => number;
    readonly isSubstantialPaperText: (a: number, b: number, c: number) => number;
    readonly isSupervisorRole: (a: number, b: number) => number;
    readonly isSyncedTable: (a: number, b: number) => number;
    readonly isTemporaryName: (a: number, b: number) => number;
    readonly isTypingTarget: (a: number, b: number, c: number) => number;
    readonly isUnderIgnoredFolder: (a: any) => [number, number, number];
    readonly isUniqueClash: (a: number, b: number) => number;
    readonly isUnsureConfidence: (a: number) => number;
    readonly isUnsureLine: (a: any) => [number, number, number];
    readonly isUserIntegrationConnected: (a: any, b: number, c: number, d: any) => [number, number, number];
    readonly isVectorCacheFile: (a: number, b: number) => number;
    readonly isWebArticle: (a: any) => [number, number, number];
    readonly isWorkshopSessionId: (a: number, b: number) => number;
    readonly isZipFile: (a: number, b: number) => number;
    readonly isZoteroChildItem: (a: any) => [number, number, number];
    readonly isZoteroLibrarySyncMode: (a: any) => number;
    readonly isoDate: (a: number, b: number) => [number, number];
    readonly isoDayFromParts: (a: number, b: number, c: number) => [number, number];
    readonly itemIdsForPapers: (a: number, b: number, c: any, d: number, e: number) => [number, number, number];
    readonly itemToRect: (a: any, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly joinBibtex: (a: any) => [number, number, number, number];
    readonly joinInkTextLayer: (a: any) => [number, number, number, number];
    readonly jsonBodyError: (a: any) => [number, number];
    readonly jsonDataPath: (a: any, b: any) => [number, number, number, number];
    readonly jsonEditSince: (a: any, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly jsonKindOfPath: (a: any) => [number, number, number];
    readonly keepAllPicks: (a: any, b: any) => [number, number, number];
    readonly keepBothTitle: (a: number, b: number) => [number, number];
    readonly keepFigureOnPage: (a: any, b: any) => [number, number, number];
    readonly keyLabel: (a: number, b: number, c: number) => [number, number];
    readonly kindIcon: (a: number, b: number) => [number, number, number];
    readonly kindIconClass: (a: number, b: number, c: number) => [number, number, number];
    readonly kindMultiplier: (a: number, b: number, c: number) => [number, number, number];
    readonly kindNames: () => [number, number, number];
    readonly kindOf: (a: number, b: number) => [number, number];
    readonly kindOfId: (a: number, b: number) => [number, number];
    readonly kindOwner: (a: number, b: number) => [number, number, number];
    readonly kindSuffix: (a: number, b: number) => [number, number, number];
    readonly kindTintClass: (a: number, b: number) => [number, number, number];
    readonly kindsForResource: (a: number, b: number) => [number, number, number];
    readonly knownCandidates: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly labelForPath: (a: number, b: number, c: any) => [number, number, number];
    readonly labelNumber: (a: any) => [number, number, number];
    readonly labelSize: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly ladderOrder: (a: any) => [number, number, number];
    readonly latestByReviewer: (a: any, b: number, c: number, d: any) => [number, number, number];
    readonly latestByReviewerList: (a: any, b: number, c: number, d: any) => [number, number, number];
    readonly layoutAnnotationMarginNotes: (a: any, b: any, c: number) => [number, number, number];
    readonly layoutForCommand: (a: any, b: any, c: number, d: number) => [number, number, number];
    readonly layoutForTabMenu: (a: any, b: number, c: number, d: number, e: any, f: number, g: number) => [number, number, number];
    readonly layoutFromRecord: (a: number, b: number) => [number, number, number];
    readonly layoutMarginNotes: (a: any, b: any, c: number) => [number, number, number];
    readonly layoutStorageKey: (a: number, b: number) => [number, number];
    readonly leaves: (a: any) => [number, number, number];
    readonly levenshtein: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly libraryBibtex: (a: any) => [number, number, number, number];
    readonly linkCitationMentions: (a: any, b: any, c: any) => [number, number, number];
    readonly linkGroupOf: (a: number, b: number) => [number, number, number];
    readonly linkLabel: (a: any) => [number, number, number];
    readonly linkNodeId: (a: any) => [number, number, number];
    readonly linkSentence: (a: number, b: number, c: number, d: number, e: number, f: number) => any;
    readonly linkTargetsError: (a: number, b: number) => [number, number];
    readonly lintWiki: (a: any, b: number) => [number, number, number];
    readonly listDisplayColor: (a: any) => [number, number, number, number];
    readonly listMembership: (a: any, b: any) => [number, number, number];
    readonly listMembershipByKey: (a: any, b: any, c: any) => [number, number, number];
    readonly listedAnnotations: (a: any) => [number, number, number];
    readonly livePdfTexts: (a: any, b: any) => [number, number, number];
    readonly loadOpenGroups: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly localBlobMergeSignedUrls: (a: any, b: any, c: any) => [number, number, number];
    readonly localBlobMissingPaths: (a: any, b: any) => [number, number, number];
    readonly localBlobReadSql: (a: number) => [number, number];
    readonly localBlobRemovalForgetsUpload: (a: number, b: number) => number;
    readonly localBlobSql: (a: number, b: number) => [number, number, number, number];
    readonly localBlobUnsignedIndices: (a: any) => [number, number, number];
    readonly localDbSharedBuffers: () => [number, number];
    readonly localDeviceUserId: (a: number, b: number, c: number, d: number) => [number, number];
    readonly localDeviceUserSql: () => [number, number];
    readonly localExperimentAccountArtifactsPattern: (a: number, b: number) => [number, number];
    readonly localExperimentArtifactBucket: () => [number, number];
    readonly localExperimentArtifactRest: (a: number, b: number) => [number, number];
    readonly localExperimentArtifactStorageName: (a: number, b: number, c: number) => [number, number];
    readonly localExperimentArtifactStoragePath: (a: number, b: number, c: number, d: number) => [number, number];
    readonly localExperimentBatch: () => number;
    readonly localExperimentPreferWebp: (a: number, b: number, c: number, d: number) => number;
    readonly localExperimentPushSql: (a: number, b: number) => [number, number, number, number];
    readonly localExperimentPushedCursor: (a: number, b: number) => number;
    readonly localExperimentShouldRecompress: (a: number, b: number) => number;
    readonly localFirstKey: () => [number, number];
    readonly localFirstMarkerAccount: (a: number, b: number) => [number, number, number];
    readonly localFirstWanted: (a: number, b: number) => number;
    readonly localIsLocalMode: (a: number, b: number) => number;
    readonly localIsoDate: (a: number, b: number, c: number) => [number, number];
    readonly localKeys: (a: any) => [number, number, number];
    readonly localModeKey: () => [number, number];
    readonly localSecretsJsonText: (a: number, b: number) => [number, number];
    readonly localSecretsLoadSql: () => [number, number];
    readonly localSecretsSaveSql: () => [number, number];
    readonly localSubgraph: (a: number, b: number, c: number, d: any) => [number, number, number];
    readonly locateAnchor: (a: number, b: number, c: any) => [number, number, number];
    readonly locateMention: (a: any, b: number, c: number) => [number, number, number];
    readonly logEntryInputError: (a: any) => [number, number, number, number];
    readonly logEntryMessage: (a: any) => [number, number, number, number];
    readonly logEyebrow: (a: any, b: number, c: number) => [number, number, number];
    readonly logPath: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly looksLikeImageUrl: (a: number, b: number) => number;
    readonly looksLikePdfUrl: (a: number, b: number) => number;
    readonly lwwClearTarget: (a: number, b: number) => [number, number, number, number];
    readonly lwwNotifyResource: (a: number, b: number) => [number, number, number, number];
    readonly makeInkStroke: (a: any) => [number, number, number];
    readonly manualInputFromReference: (a: any) => [number, number, number];
    readonly mapInkConfidence: (a: number, b: number, c: number) => number;
    readonly markActions: (a: any) => [number, number, number];
    readonly markColourTool: (a: number, b: number) => [number, number];
    readonly markPopoverShown: (a: any, b: number, c: number) => [number, number, number];
    readonly markdownFormatAction: (a: number, b: number, c: number, d: number, e: any, f: number) => [number, number, number];
    readonly markdownFormatActions: () => [number, number, number];
    readonly markdownImage: (a: any, b: any) => [number, number, number, number];
    readonly markdownLink: (a: any, b: any) => [number, number, number, number];
    readonly markdownToLatex: (a: number, b: number, c: number) => [number, number, number];
    readonly matchAuthorYearText: (a: number, b: number, c: any) => [number, number, number];
    readonly matchCitationReferences: (a: any, b: any) => [number, number, number];
    readonly matchPageCitations: (a: any, b: any, c: any) => [number, number, number];
    readonly matchVocabulary: (a: number, b: number, c: any) => [number, number, number];
    readonly matchingPageIndices: (a: any, b: any) => [number, number, number];
    readonly mattermostChannelFor: (a: any, b: any) => [number, number, number];
    readonly mattermostConnection: (a: any) => [number, number, number];
    readonly mattermostConnectionReady: (a: any) => [number, number, number];
    readonly mattermostEvents: () => [number, number, number];
    readonly mattermostOptions: (a: any) => [number, number, number];
    readonly mattermostPostPlan: (a: any) => [number, number, number];
    readonly mattermostPostResponsePlan: (a: any) => [number, number, number];
    readonly mattermostTestPosts: (a: any) => [number, number, number];
    readonly maxFusionIds: () => number;
    readonly maxIndexTextUtf16: () => number;
    readonly maxReportChars: () => number;
    readonly maxSignedUrlPaths: () => number;
    readonly mayDriveDevice: (a: number, b: number, c: number, d: number) => number;
    readonly mayOpenExternally: (a: number, b: number) => number;
    readonly mcpClientConfigs: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number, number];
    readonly mcpFileOf: (a: any) => [number, number, number, number];
    readonly mcpMaxItemChars: () => number;
    readonly mcpMaxResultChars: () => number;
    readonly mcpPaperEvidence: (a: any, b: any) => [number, number, number];
    readonly mcpReadResult: (a: any, b: number) => [number, number, number];
    readonly mcpResultNotice: () => [number, number];
    readonly mcpServersJson: (a: any) => [number, number, number, number];
    readonly meanPressure: (a: number, b: number) => [number, number];
    readonly mediaTypeEssence: (a: number, b: number) => [number, number];
    readonly memberNameMap: (a: any) => [number, number, number];
    readonly memberRank: (a: number, b: number) => number;
    readonly memberRoleLabel: (a: any, b: any) => [number, number, number, number];
    readonly memberRoleLabelOf: (a: any, b: number, c: number) => [number, number, number, number];
    readonly mentionItemRanges: (a: any, b: number, c: number) => [number, number, number];
    readonly mentionRects: (a: any, b: number, c: number) => [number, number, number];
    readonly menuPaletteActions: (a: any) => [number, number, number];
    readonly mergeBothChanged: (a: any, b: any, c: number, d: number) => [number, number, number];
    readonly mergeExtractions: (a: any) => [number, number, number];
    readonly mergeGraphPersistedState: (a: any) => [number, number, number];
    readonly mergeHunks: (a: any, b: any, c: any) => [number, number, number, number];
    readonly mergeOrder: (a: number, b: number, c: any, d: number) => [number, number, number];
    readonly mergeOverleafProjects: (a: any, b: any) => [number, number, number];
    readonly mergePaperInto: (a: any, b: any) => [number, number, number];
    readonly mergeReaderAnnotations: (a: any, b: any) => [number, number, number];
    readonly mergeRows: (a: any, b: any, c: any) => [number, number, number];
    readonly mergeSeenIds: (a: number, b: number, c: number, d: number) => [number, number];
    readonly mergeServerAppearance: (a: any, b: any) => [number, number, number];
    readonly mergeTemplate: (a: number, b: number, c: number, d: number) => [number, number];
    readonly mergeVaultPage: (a: any, b: any, c: any) => [number, number, number];
    readonly mergeWikiPages: (a: any, b: any) => [number, number, number];
    readonly mermaidDiagramId: (a: number, b: number) => [number, number];
    readonly mermaidRenderSource: (a: number, b: number) => [number, number];
    readonly metadataTitle: (a: number, b: number) => [number, number];
    readonly metricKeys: (a: any) => [number, number, number];
    readonly metricKeysOf: (a: any) => [number, number, number];
    readonly migratedExpanded: (a: any, b: any) => [number, number, number];
    readonly migratedNotice: (a: number, b: number) => any;
    readonly milestoneFromRow: (a: any) => [number, number, number];
    readonly milestoneInputError: (a: any) => [number, number, number, number];
    readonly milestoneMessage: (a: any) => [number, number, number, number];
    readonly milestoneToRow: (a: any) => [number, number, number];
    readonly milestonesToIcs: (a: any, b: any) => [number, number, number, number];
    readonly minArticleTextChars: () => number;
    readonly minPaperTextChars: () => number;
    readonly minisearchdocs_boostOf: (a: number, b: number, c: number, d: number) => number;
    readonly minisearchdocs_boosts: (a: number, b: number) => [number, number, number];
    readonly minisearchdocs_clear: (a: number) => void;
    readonly minisearchdocs_entries: (a: number) => [number, number, number];
    readonly minisearchdocs_filterOnly: (a: number, b: any, c: any, d: number, e: number) => [number, number, number];
    readonly minisearchdocs_finish: (a: number, b: any, c: any, d: any, e: number, f: number, g: number) => [number, number, number];
    readonly minisearchdocs_has: (a: number, b: number, c: number) => number;
    readonly minisearchdocs_hitById: (a: number, b: number, c: number) => [number, number, number];
    readonly minisearchdocs_idsOfKind: (a: number, b: any) => [number, number, number];
    readonly minisearchdocs_new: () => number;
    readonly minisearchdocs_put: (a: number, b: any) => [number, number];
    readonly minisearchdocs_remove: (a: number, b: number, c: number) => void;
    readonly minisearchdocs_setSettings: (a: number, b: any) => [number, number];
    readonly mirrorManifestText: (a: any, b: any, c: any, d: number, e: number) => [number, number, number, number];
    readonly missingAfterPresence: (a: number, b: number, c: any, d: number, e: number, f: number) => [number, number, number];
    readonly missingAfterTombstones: (a: any, b: any, c: number, d: number, e: number) => [number, number, number];
    readonly missingConfigMessage: (a: any, b: any) => [number, number, number];
    readonly missingFigureWarning: (a: any) => [number, number, number, number];
    readonly missingIdChunks: (a: any) => [number, number, number];
    readonly missingPagePlans: (a: any) => [number, number, number];
    readonly missingR2ConfigMessage: (a: any) => [number, number, number];
    readonly modelBuildBatchRequest: (a: any, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number, number];
    readonly modelCacheUrl: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly modelExtractionLimits: () => [number, number, number];
    readonly modelFinalizeExtraction: (a: any, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly modesFor: (a: number, b: number) => [number, number, number];
    readonly motionTier: (a: any) => [number, number];
    readonly moveTab: (a: any, b: any, c: number, d: number, e: number) => [number, number, number];
    readonly movedIds: (a: any, b: number, c: number, d: number) => [number, number, number];
    readonly movedPath: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly nameOf: (a: any, b: any) => [number, number, number, number];
    readonly nativeCitationMentions: (a: any, b: any, c: any) => [number, number, number];
    readonly navRevealScrollTop: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly needsDisclaimerAcceptance: (a: any) => [number, number, number];
    readonly needsMigrationHint: (a: number, b: number) => number;
    readonly needsOrgSetup: (a: any) => [number, number, number];
    readonly needsPerson: (a: number, b: number, c: number) => number;
    readonly needsStandaloneRoleSync: (a: any, b: any, c: number) => [number, number, number];
    readonly neutraliseContext: (a: number, b: number, c: number, d: number) => [number, number];
    readonly newInkChunkId: (a: number) => [number, number, number, number];
    readonly newIssueUrl: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
    readonly newestDesktopRelease: (a: any) => [number, number, number];
    readonly newestFirstOrder: (a: any) => [number, number, number];
    readonly nextAuthStep: (a: any) => [number, number, number];
    readonly nextCitationPageOffset: (a: number, b: any, c: number) => [number, number, number];
    readonly nextManifest: (a: number, b: number, c: any) => [number, number, number, number];
    readonly nextMatchIndex: (a: number, b: number, c: number) => number;
    readonly nextRedirect: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number];
    readonly nextRotation: (a: number, b: number, c: number) => number;
    readonly nextShortcutsOpen: (a: number, b: number, c: number) => number;
    readonly nextSortOrder: (a: any) => [number, number, number];
    readonly nibWidth: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly nibfilter_filter: (a: number, b: any) => [number, number, number];
    readonly nibfilter_new: (a: any) => [number, number, number];
    readonly nibfilter_reset: (a: number) => void;
    readonly nibfilter_save: (a: number) => any;
    readonly nibfilter_speed: (a: number) => number;
    readonly nodeSize: (a: number, b: number, c: number) => [number, number, number];
    readonly normalisePageRotation: (a: number) => number;
    readonly normaliseWhitespace: (a: number, b: number, c: number) => [number, number, number];
    readonly normalizeAiAccessSettings: (a: number) => [number, number, number];
    readonly normalizeAppearance: (a: any) => [number, number, number];
    readonly normalizeArxivId: (a: any) => [number, number, number, number];
    readonly normalizeColorValue: (a: any) => any;
    readonly normalizeCommentInput: (a: any) => [number, number, number];
    readonly normalizeDoi: (a: number, b: number) => [number, number];
    readonly normalizeFieldName: (a: number, b: number) => [number, number];
    readonly normalizeFontStack: (a: any) => any;
    readonly normalizeGraphViewSettings: (a: any) => [number, number, number];
    readonly normalizeHighlightRects: (a: any) => [number, number, number];
    readonly normalizeLengthValue: (a: any, b: number, c: number) => any;
    readonly normalizeMarkdownImageSyntax: (a: any) => [number, number, number, number];
    readonly normalizeOrgInviteCode: (a: number, b: number) => [number, number];
    readonly normalizePasteSettings: (a: any) => [number, number, number];
    readonly normalizeProjectPath: (a: number, b: number) => any;
    readonly normalizeRepoPath: (a: number, b: number) => [number, number];
    readonly normalizeSearchHistory: (a: any, b: number) => [number, number, number, number];
    readonly normalizeSearchSettings: (a: any) => [number, number, number];
    readonly normalizeSelectOptions: (a: number, b: number) => [number, number];
    readonly normalizeShareInput: (a: any) => [number, number, number];
    readonly normalizeTags: (a: number, b: number) => [number, number];
    readonly normalizeThemeConfig: (a: any) => [number, number, number];
    readonly normalizeTitleKey: (a: number, b: number) => [number, number];
    readonly normalizeUserSettings: (a: any) => [number, number, number];
    readonly normalizeVector: (a: number, b: number) => [number, number];
    readonly normalizeZoteroLibrary: (a: any) => [number, number, number, number];
    readonly noteBacklinks: (a: any, b: number, c: number) => [number, number, number];
    readonly noteBodyText: (a: number, b: number, c: number, d: number) => [number, number];
    readonly noteTags: (a: any) => [number, number, number, number];
    readonly notesTagged: (a: any, b: any) => [number, number, number];
    readonly noticeFor: (a: any, b: number) => [number, number, number];
    readonly objectKey: (a: number, b: number, c: number, d: number) => [number, number];
    readonly oneEuroAlpha: (a: number, b: number) => number;
    readonly oneeurofilter_filter: (a: number, b: number, c: number) => number;
    readonly oneeurofilter_last: (a: number) => any;
    readonly oneeurofilter_new: (a: any) => [number, number, number];
    readonly oneeurofilter_reset: (a: number) => void;
    readonly oneeurofilter_speed: (a: number) => number;
    readonly openAccessIdsOf: (a: any) => [number, number, number];
    readonly openAccessSupports: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly openAlexFirstMatch: (a: any, b: any) => [number, number, number];
    readonly openAlexSearchQuery: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly openAlexToHit: (a: any) => [number, number, number];
    readonly openAlexToMetadata: (a: any) => [number, number, number];
    readonly openModeFor: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly openTab: (a: any, b: any, c: number, d: number) => [number, number, number];
    readonly openTabKeys: (a: any) => [number, number, number];
    readonly openingTab: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly optimisticAnnotationFromDraft: (a: any, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly orValue: (a: number, b: number) => [number, number];
    readonly orderClause: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly originOf: (a: number, b: number) => any;
    readonly originalRange: (a: any, b: number, c: number) => [number, number, number];
    readonly originalUrlFromProxy: (a: number, b: number, c: number, d: number) => any;
    readonly outOfScopeStrays: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number];
    readonly outboxEntries: (a: any) => [number, number, number];
    readonly outlineFromText: (a: any) => [number, number, number];
    readonly outlineIsPlausible: (a: any, b: number) => [number, number, number];
    readonly outlineItemOf: (a: any, b: number) => [number, number, number];
    readonly outlineItemsFor: (a: any) => [number, number, number];
    readonly outlineOf: (a: number, b: number, c: number) => [number, number, number];
    readonly outlineProgress: (a: any) => [number, number, number];
    readonly outlineTextLines: (a: any) => [number, number, number];
    readonly overleafExternalUrl: (a: number, b: number) => [number, number];
    readonly overleafGitUrl: (a: number, b: number) => [number, number];
    readonly overleafProjectMatches: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly overleafProjectShown: (a: number, b: number, c: number, d: any) => [number, number, number];
    readonly ownedAssetFolderPaths: (a: any) => [number, number, number];
    readonly ownedStorage: (a: number, b: number) => [number, number, number];
    readonly packInkStroke: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly packInkStrokeInstances: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly packLocalVectorRow: (a: number, b: number, c: number, d: number) => [number, number];
    readonly packVectorIndex: (a: number, b: number, c: number, d: any) => [number, number, number];
    readonly packVectors: (a: any, b: number, c: number) => [number, number, number, number];
    readonly pageFromChunkBody: (a: number, b: number) => [number, number, number];
    readonly pageImportRefusal: (a: any) => [number, number, number];
    readonly pageListProblem: (a: number, b: number, c: number) => [number, number, number];
    readonly pagePictures: (a: any, b: number) => [number, number, number];
    readonly pageSpanOf: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly pageTextAfterRecognition: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly pageTextFromItems: (a: any) => [number, number, number, number];
    readonly pageTitleScanChars: () => number;
    readonly pagesToEvict: (a: any, b: any, c: number, d: number) => [number, number, number];
    readonly paintedOrder: (a: any) => [number, number, number];
    readonly paletteCss: (a: any, b: number, c: number, d: number) => [number, number, number, number];
    readonly paletteHex: (a: any, b: number, c: number) => [number, number, number, number];
    readonly paletteModeFor: (a: any) => [number, number, number];
    readonly paletteName: (a: any, b: number, c: number) => [number, number, number];
    readonly paperCiteKeys: (a: any) => [number, number, number];
    readonly paperHtmlChromeSelector: () => [number, number];
    readonly paperHtmlCsp: () => [number, number];
    readonly paperHtmlDir: (a: number, b: number) => [number, number];
    readonly paperHtmlForbidTags: () => [number, number];
    readonly paperHtmlPath: (a: number, b: number, c: number, d: number) => [number, number];
    readonly paperImageThumbnailPath: (a: number, b: number) => [number, number];
    readonly paperImageUploadPaths: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number, number];
    readonly paperPdfPath: (a: number, b: number, c: number, d: number) => [number, number];
    readonly paperRelationInputError: (a: any) => [number, number, number, number];
    readonly paperToBibtex: (a: any, b: number, c: number) => [number, number, number, number];
    readonly parseAppVersion: (a: number, b: number) => [number, number, number];
    readonly parseArtifactRefs: (a: number, b: number) => [number, number, number];
    readonly parseBibEntries: (a: any) => [number, number, number];
    readonly parseBibliography: (a: any, b: number) => [number, number, number];
    readonly parseBibliographyEntry: (a: any, b: number, c: number) => [number, number, number];
    readonly parseBiorxiv: (a: any, b: number, c: number) => [number, number, number];
    readonly parseByokReply: (a: any, b: any) => [number, number, number];
    readonly parseCssColour: (a: number, b: number) => any;
    readonly parseDashboardLayout: (a: any) => [number, number, number];
    readonly parseDoaj: (a: any) => [number, number, number];
    readonly parseEditorCitationFormat: (a: number, b: number) => [number, number];
    readonly parseEuropePmc: (a: any) => [number, number, number];
    readonly parseExplorerKeys: (a: number, b: number) => [number, number, number];
    readonly parseExtractionJson: (a: number, b: number) => [number, number, number];
    readonly parseFigureClip: (a: number, b: number) => [number, number, number];
    readonly parseFigureCrop: (a: number, b: number) => [number, number, number];
    readonly parseFigureTokens: (a: number, b: number) => [number, number, number];
    readonly parseFolderDraft: (a: number, b: number) => [number, number, number];
    readonly parseGraphPersistedState: (a: any) => [number, number, number];
    readonly parseHal: (a: any) => [number, number, number];
    readonly parseInkChunkPath: (a: number, b: number) => [number, number, number];
    readonly parseJsonBody: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly parseJsonData: (a: any, b: any, c: any) => [number, number, number];
    readonly parseKindSuffix: (a: number, b: number) => [number, number, number];
    readonly parseLatexSectionTree: (a: any, b: number, c: number) => [number, number, number];
    readonly parseLinkRemovalText: (a: any) => [number, number, number];
    readonly parseMdImageAlt: (a: any) => [number, number, number];
    readonly parseOpenalex: (a: any) => [number, number, number];
    readonly parseOverleafLinks: (a: any) => [number, number, number];
    readonly parseOverleafProjectId: (a: number, b: number) => any;
    readonly parsePageList: (a: number, b: number, c: number) => [number, number, number];
    readonly parsePaperFieldValue: (a: any, b: number, c: number) => [number, number, number];
    readonly parsePaperHtmlDocument: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly parsePaperRef: (a: any, b: any) => [number, number, number];
    readonly parsePlanWidgetBounds: (a: any) => [number, number, number];
    readonly parseQuery: (a: any) => [number, number, number];
    readonly parseReaderSplitPane: (a: number, b: number) => [number, number, number];
    readonly parseRegions: (a: number, b: number) => [number, number, number];
    readonly parseReleaseTag: (a: number, b: number) => [number, number, number];
    readonly parseResultsTableRefs: (a: number, b: number) => [number, number, number];
    readonly parseRollupOptions: (a: number, b: number) => [number, number, number];
    readonly parseSemanticScholar: (a: any) => [number, number, number];
    readonly parseSidecarArgs: (a: any) => [number, number, number];
    readonly parseStoredAiProvider: (a: number, b: number) => [number, number, number];
    readonly parseStrokeClip: (a: number, b: number) => [number, number, number];
    readonly parseTaskbarCreatedId: (a: number, b: number) => [number, number, number];
    readonly parseThemeConfig: (a: any) => [number, number, number];
    readonly parseUnpaywall: (a: any) => [number, number, number];
    readonly parseUserUrl: (a: number, b: number) => any;
    readonly parseWikilinkCreateMode: (a: number, b: number) => [number, number];
    readonly parseWikilinkInner: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly parseWorkspaceFolder: (a: any) => [number, number, number];
    readonly parseZenodo: (a: any) => [number, number, number];
    readonly partitionPdfTexts: (a: any, b: any) => [number, number, number];
    readonly passageId: (a: number, b: number, c: number) => [number, number];
    readonly pasteImageType: (a: number, b: number) => [number, number];
    readonly pasteLandsInVerbatimContext: (a: any, b: number) => [number, number, number];
    readonly pastedFigurePlace: (a: any, b: any, c: any) => [number, number, number];
    readonly pastedStrokesPlace: (a: any, b: any, c: any) => [number, number, number];
    readonly pdfDocId: (a: number, b: number, c: number) => [number, number];
    readonly pdfDocIdsFor: (a: number, b: number, c: number) => [number, number];
    readonly pdfIdPrefix: (a: number, b: number) => [number, number];
    readonly pdfPageHref: (a: number, b: number, c: number) => [number, number];
    readonly pdfPageText: (a: any) => [number, number];
    readonly pdfPointToScreen: (a: number, b: number, c: any) => [number, number, number];
    readonly pdfProxyPath: (a: number, b: number) => any;
    readonly pdfRectToScreenBox: (a: number, b: number, c: any) => [number, number, number];
    readonly pdfSourceResolverOrder: (a: number, b: number) => [number, number, number];
    readonly pdfTextStoreOp: (a: any) => [number, number, number];
    readonly peersFromStates: (a: any, b: any) => [number, number, number];
    readonly peersFromUsers: (a: any, b: number, c: number, d: number) => [number, number, number];
    readonly pendingFieldFills: (a: any, b: number, c: number) => [number, number, number];
    readonly pendingKey: (a: number, b: number, c: number, d: number) => [number, number];
    readonly personalizedPageRank: (a: any, b: number, c: number, d: number) => [number, number, number];
    readonly pgArray: (a: any) => [number, number, number, number];
    readonly pickFreeCopyAttempts: (a: any) => [number, number, number];
    readonly pickKeeper: (a: any) => [number, number, number, number];
    readonly pickKeysToEvict: (a: any, b: number) => [number, number, number];
    readonly pickNearestMatch: (a: any, b: any) => [number, number, number];
    readonly pickProject: (a: any, b: number, c: number) => [number, number, number];
    readonly pickProjectFolder: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly pickRenamedFolder: (a: number, b: number, c: number, d: number) => [number, number];
    readonly pictureComment: (a: any) => [number, number, number, number];
    readonly pictureMeta: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly picturePath: (a: any) => [number, number, number];
    readonly pictureRect: (a: any, b: number) => [number, number, number];
    readonly pinRecentTargets: (a: any, b: any) => [number, number, number];
    readonly pinnedScreenIndex: (a: any) => [number, number, number];
    readonly pitchShareCard: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly pitchShareConstants: () => [number, number, number];
    readonly placeOnSheet: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly placePlanWidget: (a: any, b: any) => [number, number, number];
    readonly planArchiveEntries: (a: any, b: any) => [number, number, number];
    readonly planAssetCopies: (a: any) => [number, number, number];
    readonly planAssetReads: (a: any, b: any, c: any, d: any) => [number, number, number];
    readonly planAssetReanchor: (a: any, b: any, c: any) => [number, number, number];
    readonly planBibImport: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number, number];
    readonly planBibliographyAnnotations: (a: any, b: any) => [number, number, number];
    readonly planChipTarget: (a: any, b: any, c: any, d: number) => [number, number, number];
    readonly planCitationSegments: (a: any, b: any) => [number, number, number];
    readonly planClaimImport: (a: number, b: number, c: number, d: number, e: number, f: number, g: any) => [number, number, number];
    readonly planDelta: (a: any, b: any) => [number, number, number];
    readonly planEmbeddingStart: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly planEyebrow: (a: number, b: number) => [number, number, number];
    readonly planFeedOrigin: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly planFeedUrls: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly planFixOrder: (a: any) => [number, number, number];
    readonly planFuzzyRetry: (a: any) => [number, number, number];
    readonly planImportTitles: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly planItemOrder: (a: number, b: number, c: any, d: number, e: number) => [number, number, number];
    readonly planJsonApply: (a: any) => [number, number, number];
    readonly planMcpTool: (a: number, b: number, c: any, d: any) => [number, number, number];
    readonly planMirror: (a: any, b: any, c: any, d: any) => [number, number, number];
    readonly planOverleafReportCreate: (a: any) => [number, number, number];
    readonly planOverleafReportPatch: (a: any) => [number, number, number];
    readonly planPace: (a: any, b: number, c: number) => [number, number, number, number];
    readonly planPdfAdd: (a: any) => [number, number, number];
    readonly planPdfLookups: (a: any) => [number, number, number];
    readonly planPreviewReads: (a: any, b: number, c: number, d: number, e: any) => [number, number, number];
    readonly planRenames: (a: any, b: any, c: number, d: number) => [number, number, number];
    readonly planSeriesIngest: (a: any, b: number, c: number) => [number, number, number];
    readonly planSeriesIngestIndices: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly planTimeline: (a: any, b: number, c: number) => [number, number, number];
    readonly planWidgetData: (a: any, b: any) => [number, number, number];
    readonly planWikiPages: (a: any) => [number, number, number];
    readonly plotHeight: (a: number, b: number) => number;
    readonly plotTier: (a: number) => [number, number];
    readonly plural: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly pmcCandidates: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly pointInArea: (a: any, b: number, c: number) => [number, number, number];
    readonly pointInPolygon: (a: number, b: number, c: number, d: number) => number;
    readonly postgrestChangesRequest: (a: number, b: number) => [number, number, number];
    readonly postgrestConflictRequest: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly postgrestErrorInfo: (a: number, b: number) => [number, number, number];
    readonly postgrestGoneRequest: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly postgrestPresenceRequest: (a: number, b: number, c: any) => [number, number, number];
    readonly postgrestRequestInit: (a: any, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly postgrestTombstoneRequest: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly postgrestTombstonesForRequest: (a: number, b: number, c: any) => [number, number, number];
    readonly postgrestWritable: (a: number, b: number, c: any) => [number, number, number];
    readonly postgrestWriteRequest: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: any) => [number, number, number];
    readonly preprintServerFor: (a: number, b: number) => [number, number];
    readonly pressureByte: (a: number, b: number) => number;
    readonly previewOpen: (a: any) => [number, number, number];
    readonly previewReaderHref: (a: number, b: number, c: any, d: number, e: number) => [number, number, number];
    readonly previewSource: (a: any, b: any) => [number, number, number];
    readonly previewTab: () => [number, number, number];
    readonly primaryPaperRef: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly prismaCaveat: (a: any) => [number, number, number];
    readonly prismaCounts: (a: any, b: any) => [number, number, number];
    readonly prismaFigureTex: (a: any, b: number) => [number, number, number, number];
    readonly projectDir: (a: any) => [number, number, number, number];
    readonly projectFolderName: (a: number, b: number) => [number, number];
    readonly projectFromRow: (a: any) => [number, number, number];
    readonly projectGateOpen: (a: any, b: any) => [number, number, number];
    readonly projectMetaDir: (a: number) => [number, number, number, number];
    readonly projectName: (a: number, b: number) => [number, number];
    readonly projectPageAnnotationGeometry: (a: any) => [number, number, number];
    readonly projectSearchDocuments: (a: any, b: any, c: any) => [number, number, number];
    readonly projectStoredPdfTexts: (a: any, b: any) => [number, number, number];
    readonly projectZoteroAnnotations: (a: any, b: number) => [number, number, number];
    readonly projectedPageSize: (a: any) => [number, number, number];
    readonly projection: (a: number, b: number) => [number, number, number, number];
    readonly proposalAppendVaultNoteBody: (a: number, b: number, c: any) => [number, number, number, number];
    readonly proposalApplies: (a: number, b: number, c: number, d: number) => number;
    readonly proposalEditVaultNote: (a: any) => [number, number, number];
    readonly proposalExperimentFollowUp: (a: any) => [number, number, number];
    readonly proposalExperimentUpdate: (a: any) => [number, number, number];
    readonly proposalLogEntry: (a: any) => [number, number, number];
    readonly proposalMilestoneFollowUp: (a: any) => [number, number, number];
    readonly proposalMilestoneStatus: (a: any) => [number, number, number, number];
    readonly proposalPaperAnnotation: (a: any) => [number, number, number];
    readonly proposalPaperFieldFill: (a: any, b: any) => [number, number, number];
    readonly proposalPaperFieldId: (a: any) => [number, number, number, number];
    readonly proposalPaperNoteAddition: (a: any, b: number, c: number) => [number, number, number, number];
    readonly proposalPaperUpdate: (a: any) => [number, number, number];
    readonly proposalReadingListChange: (a: any) => [number, number, number];
    readonly proposalRelation: (a: any) => [number, number, number];
    readonly proposalReportNotes: (a: any) => [number, number, number, number];
    readonly proposalVaultNote: (a: any) => [number, number, number];
    readonly proposalZoteroImport: (a: any) => [number, number, number];
    readonly pruneLayout: (a: any, b: any) => [number, number, number];
    readonly pullApplyStep: (a: any) => [number, number, number];
    readonly pullSummary: (a: any) => [number, number, number];
    readonly pullTombstoneStep: (a: any) => [number, number, number];
    readonly pumpRoute: (a: any) => [number, number, number];
    readonly purgeFailureMessage: (a: number, b: number) => [number, number];
    readonly purgesObjects: (a: number, b: number, c: number) => number;
    readonly pushFigureStep: (a: any, b: any, c: any, d: any) => [number, number, number];
    readonly pushInkUndo: (a: any, b: any) => [number, number, number];
    readonly quantizeInkPath: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly queryTermCount: (a: any) => [number, number, number];
    readonly quickOpenResults: (a: any, b: number, c: number) => [number, number, number];
    readonly quoteAwkwardMermaidLabels: (a: number, b: number) => [number, number];
    readonly quoteIdent: (a: number, b: number) => [number, number];
    readonly r2BlobClientConfig: (a: any) => [number, number, number];
    readonly railGroupText: (a: any, b: any, c: any) => [number, number, number];
    readonly rampColour: (a: number) => [number, number];
    readonly rangeWindow: (a: number, b: number) => [number, number, number];
    readonly rankCitationAlerts: (a: any) => [number, number, number];
    readonly rankFilterOrder: (a: number, b: number, c: any, d: any) => [number, number, number];
    readonly rankOpenAccessCandidates: (a: any) => [number, number, number];
    readonly ratingInRange: (a: number) => number;
    readonly readContentType: (a: number, b: number) => [number, number];
    readonly readFailureReason: (a: number, b: number, c: number) => [number, number];
    readonly readFrontmatter: (a: any) => [number, number, number];
    readonly readInkChunkHeader: (a: number, b: number) => [number, number, number];
    readonly readInkNoteBody: (a: any) => [number, number, number];
    readonly readInkNoteMeta: (a: any) => [number, number, number];
    readonly readInkRequest: (a: any) => [number, number, number];
    readonly readMirrorBase: (a: number, b: number) => [number, number, number];
    readonly readMirrorBases: (a: number, b: number) => [number, number, number];
    readonly readStorageConfig: (a: any) => [number, number, number];
    readonly readableText: (a: any) => [number, number, number, number];
    readonly readerAnnotationConsts: () => [number, number, number];
    readonly readerKeyboardCommand: (a: any) => [number, number, number];
    readonly readerPrintDocument: (a: any) => [number, number, number, number];
    readonly readerPrintOrientation: (a: any) => [number, number, number, number];
    readonly readingListNameMatches: (a: number, b: number, c: number, d: number) => number;
    readonly readsFolder: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly recentFailureIds: (a: any, b: number) => [number, number, number];
    readonly recentlyApprovedWikiPages: (a: any, b: number) => [number, number, number];
    readonly recolourNodes: (a: any, b: any, c: number, d: number, e: any, f: any) => [number, number];
    readonly reconstructLines: (a: number, b: any, c: number) => [number, number, number];
    readonly rectanglesOverlap: (a: number, b: number, c: number, d: number) => number;
    readonly redact: (a: number, b: number) => [number, number, number];
    readonly redactAndCap: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly redactOverleafErrorText: (a: number, b: number, c: number, d: number) => [number, number];
    readonly redactSecret: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly referenceCacheKey: (a: number, b: number, c: number) => [number, number];
    readonly referenceForDestination: (a: any, b: any) => [number, number, number];
    readonly referenceLookupAttempts: (a: any) => [number, number, number];
    readonly referenceRef: (a: any) => [number, number, number];
    readonly refreshInkUndoAnnotation: (a: any, b: any) => [number, number, number];
    readonly rekeyManifestText: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly relatedByPpr: (a: any, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly relatedConcepts: (a: number, b: number, c: any, d: any, e: number) => [number, number, number];
    readonly relationTitles: (a: any, b: any) => [number, number, number, number];
    readonly relativeAssetPaths: (a: any) => [number, number, number];
    readonly relayPath: (a: number, b: number, c: number, d: number) => [number, number];
    readonly relayUrl: (a: number, b: number, c: number, d: number) => [number, number];
    readonly rememberSearchQuery: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly removeHashtagFromBody: (a: number, b: number, c: number, d: number) => [number, number];
    readonly renameInkUndoId: (a: any, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly renameSources: (a: any, b: any, c: any) => [number, number, number];
    readonly renamedOutsidePaths: (a: any, b: any) => [number, number, number];
    readonly renderTemplate: (a: number, b: number, c: any) => [number, number, number, number];
    readonly reorderFigureIndices: (a: number, b: number, c: any) => [number, number, number];
    readonly reorderFigures: (a: any, b: number, c: any) => [number, number, number];
    readonly reorderedIds: (a: any, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly replaceVaultAssetPaths: (a: number, b: number, c: any) => [number, number, number, number];
    readonly replaceWikiIndex: (a: number, b: number, c: number, d: number) => [number, number];
    readonly repoStep: (a: number, b: number, c: number, d: number, e: any, f: any, g: any) => [number, number, number];
    readonly repoWebUrl: (a: number, b: number) => [number, number];
    readonly reportMarkdown: (a: any) => [number, number, number, number];
    readonly reportRepo: (a: number, b: number) => [number, number];
    readonly reportSectionInputError: (a: any) => [number, number, number];
    readonly resampleInkStroke: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly resizeFigureBox: (a: any, b: any, c: number, d: number, e: number) => [number, number, number];
    readonly resolveAbsoluteUrl: (a: number, b: number, c: number, d: number) => any;
    readonly resolveAnnotationConflict: (a: any, b: number, c: number) => [number, number, number];
    readonly resolveArtifactRefsMarkdown: (a: number, b: number, c: any, d: number, e: number) => [number, number, number, number];
    readonly resolveArxivId: (a: number, b: number, c: number, d: number) => [number, number];
    readonly resolveCiteKey: (a: any) => [number, number, number, number];
    readonly resolveDisplayRole: (a: number, b: number, c: any) => [number, number, number, number];
    readonly resolveInkPageOrder: (a: any, b: any) => [number, number, number];
    readonly resolveIntegrationConfig: (a: any, b: any) => [number, number, number];
    readonly resolveOrgJoinAssignment: (a: number, b: number, c: any, d: any, e: number, f: number, g: number, h: number) => [number, number, number];
    readonly resolvePaperPdfUrl: (a: any) => [number, number, number];
    readonly resolvePositionSelector: (a: number, b: number, c: any) => [number, number, number];
    readonly resolveRelatedPaperUrl: (a: any) => [number, number, number, number];
    readonly resolveResultsTables: (a: number, b: number, c: any, d: number, e: number) => [number, number, number, number];
    readonly resolveSupervisorId: (a: number, b: number) => [number, number];
    readonly resolveTextAnchor: (a: number, b: number, c: any) => [number, number, number];
    readonly resolveViewportScale: (a: any, b: any, c: any) => [number, number, number];
    readonly resolveWithRow: (a: any, b: any, c: any, d: any, e: number) => [number, number, number];
    readonly resourceTypes: () => [number, number, number];
    readonly responseErrorText: (a: any, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number];
    readonly resultsTable: (a: any) => [number, number, number];
    readonly retrieveAiExcerpts: (a: any, b: number, c: number, d: number) => [number, number, number];
    readonly retryFuzzinessForTerm: (a: number, b: number, c: number) => number;
    readonly reviewers: (a: any) => [number, number, number, number];
    readonly rewriteMcpConfig: (a: any, b: number, c: number, d: any) => [number, number, number];
    readonly rewriteWikilinks: (a: number, b: number, c: any) => [number, number, number, number];
    readonly roleRank: (a: number, b: number) => number;
    readonly rootFolderIdOf: (a: any) => [number, number, number];
    readonly rootKey: (a: any) => [number, number, number];
    readonly rootOf: (a: any) => [number, number, number];
    readonly rootOfKind: (a: number, b: number) => [number, number, number];
    readonly rootVerdict: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly rowSlots: (a: number, b: any, c: any, d: any) => [number, number, number];
    readonly rowsForHeight: (a: number, b: number, c: number) => number;
    readonly s2NestedFields: (a: number, b: number) => [number, number];
    readonly s2PaperId: (a: any) => [number, number, number, number];
    readonly s2ToHit: (a: any) => [number, number, number];
    readonly safeArtifactCaption: (a: number, b: number) => [number, number];
    readonly safeImageDestination: (a: number, b: number) => any;
    readonly safeLabel: (a: number, b: number, c: number, d: number) => [number, number];
    readonly safeName: (a: number, b: number) => [number, number];
    readonly safeRelative: (a: number, b: number) => [number, number, number, number];
    readonly safeWorkspacePath: (a: any) => [number, number, number, number];
    readonly sameManifestIgnoringStamp: (a: number, b: number, c: number, d: number) => number;
    readonly sameOrigin: (a: number, b: number, c: number, d: number) => number;
    readonly samePalette: (a: any, b: any) => [number, number, number];
    readonly samePeers: (a: any, b: any) => [number, number, number];
    readonly sameRow: (a: any, b: any) => [number, number, number];
    readonly sameValue: (a: any, b: any) => [number, number, number];
    readonly sanitizeAppHref: (a: number, b: number) => any;
    readonly sanitizePdfUrl: (a: number, b: number) => any;
    readonly sanitizeReaderHref: (a: number, b: number) => any;
    readonly sanitizeSectionTargets: (a: any) => [number, number, number];
    readonly scopeNoteIndices: (a: any, b: number, c: number, d: number, e: number, f: any) => [number, number, number];
    readonly screenCachePolicy: () => [number, number, number];
    readonly screenForPath: (a: number, b: number) => any;
    readonly screenPointToPdf: (a: number, b: number, c: any) => [number, number, number];
    readonly screeningDecisionError: (a: any, b: any) => [number, number, number];
    readonly screeningDecisionFromRow: (a: any) => [number, number, number];
    readonly screeningDecisionToRow: (a: any) => [number, number, number];
    readonly searchMatches: (a: number, b: number, c: number, d: number) => [number, number];
    readonly searchRevision: (a: any) => [number, number, number, number];
    readonly searchTextFromItems: (a: any) => [number, number, number];
    readonly searchindexstate_adopt: (a: number, b: number) => void;
    readonly searchindexstate_document_count: (a: number) => number;
    readonly searchindexstate_forget: (a: number) => void;
    readonly searchindexstate_markStale: (a: number, b: number, c: number) => number;
    readonly searchindexstate_new: () => number;
    readonly searchindexstate_pdfPageCount: (a: number, b: number, c: number) => number;
    readonly searchindexstate_pendingStale: (a: number) => [number, number, number];
    readonly searchindexstate_ready: (a: number) => number;
    readonly searchindexstate_replacePdfPageCounts: (a: number, b: any) => [number, number];
    readonly searchindexstate_setPdfPageCount: (a: number, b: number, c: number, d: number) => void;
    readonly searchindexstate_set_document_count: (a: number, b: number) => void;
    readonly searchindexstate_settleStale: (a: number, b: any) => [number, number];
    readonly sectionProgress: (a: any) => [number, number, number];
    readonly seedDoi: (a: number, b: number, c: number, d: number) => [number, number];
    readonly seenFiles: (a: any, b: any, c: any, d: any) => [number, number, number];
    readonly segmentInkLines: (a: any, b: number) => [number, number, number];
    readonly segmentsFor: (a: number, b: number) => [number, number, number];
    readonly selectModelProvider: (a: any, b: number, c: number) => [number, number, number, number];
    readonly selectedPdfPages: (a: number, b: number, c: number) => [number, number, number];
    readonly selectedText: (a: any, b: any) => [number, number, number, number];
    readonly selectionToAnchor: (a: any, b: any) => [number, number, number];
    readonly semanticScholarIdentifierUrl: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly semanticScholarMatchUrl: (a: number, b: number, c: number, d: number) => [number, number];
    readonly semanticScholarRetryWaitMs: (a: number) => number;
    readonly semanticScholarShouldRetry: (a: number, b: number) => number;
    readonly semanticScholarTarget: (a: number, b: number, c: number, d: number) => any;
    readonly semanticScholarToMetadata: (a: any) => [number, number, number];
    readonly semanticStatusText: (a: any) => [number, number, number, number];
    readonly sendAdvance: (a: any, b: number, c: number, d: number) => [number, number, number];
    readonly sendStart: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => [number, number, number];
    readonly serialiseArtifactRef: (a: any) => [number, number, number, number];
    readonly serialiseResultsTableRef: (a: any, b: number, c: number) => [number, number, number, number];
    readonly serializeWorkspace: (a: any, b: any) => [number, number, number];
    readonly sessionAction: (a: number, b: number, c: number, d: number) => [number, number];
    readonly sessionClaims: (a: number, b: number) => [number, number];
    readonly setImagePlacement: (a: any, b: any, c: number, d: any) => [number, number, number, number];
    readonly setRatio: (a: any, b: any, c: number) => [number, number, number];
    readonly setTabMode: (a: any, b: any, c: any) => [number, number, number];
    readonly settingsPaletteRows: (a: number, b: number) => [number, number, number];
    readonly settleConflict: (a: any, b: any) => [number, number, number];
    readonly settleConflictPlan: (a: any, b: any, c: any, d: any) => [number, number, number];
    readonly settleExternal: (a: any) => [number, number, number];
    readonly shapeAiProposalDraft: (a: any) => [number, number, number];
    readonly shareAllowsComment: (a: any, b: any, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly shareAllowsEdit: (a: any, b: any, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly shareCoversResource: (a: any, b: any, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly shareLinkDefaultTtlDays: () => number;
    readonly shareSupportsEditAccess: (a: any, b: number, c: number) => [number, number, number];
    readonly shareTargets: (a: any, b: any) => [number, number, number];
    readonly shareableTypes: () => [number, number, number];
    readonly sharedItem: (a: any, b: any, c: any) => [number, number, number];
    readonly sharedItemHref: (a: any) => [number, number, number, number];
    readonly sharedItemTypeLabel: (a: any) => [number, number, number, number];
    readonly sharedPaperAnnotationSummary: (a: any) => [number, number, number];
    readonly sharedProviderHint: (a: any, b: any) => [number, number, number, number];
    readonly sharedReadPlan: (a: any, b: any, c: any) => [number, number, number];
    readonly sharedResourceHref: (a: any, b: number, c: number) => [number, number, number, number];
    readonly shortSha: (a: number, b: number) => [number, number];
    readonly shortcutLabel: (a: number, b: number, c: number) => [number, number];
    readonly shortcutTable: () => [number, number, number];
    readonly shouldAppendInkPoint: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly shouldFetchNextPage: (a: any) => [number, number, number];
    readonly shouldMountShellChildren: (a: number, b: number, c: number) => number;
    readonly shouldPersistBody: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly shouldPersistIndex: (a: number, b: number) => number;
    readonly shouldPullAfterPush: (a: any) => [number, number, number];
    readonly shouldRecoverUnsent: (a: any) => [number, number, number];
    readonly shouldRetrySearch: (a: number, b: number) => number;
    readonly shouldShowWorkspaceLoader: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly shouldStoreReferenceLookup: (a: number, b: number) => number;
    readonly shouldSyncStandalone: (a: any, b: any) => [number, number, number];
    readonly shouldUseDarkPdfRendering: (a: number, b: number, c: number, d: number) => number;
    readonly showConceptEdges: (a: any) => [number, number, number];
    readonly showRelationEdges: (a: any) => [number, number, number];
    readonly simplifyInkPath: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly simplifyPathIndices: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly siteOf: (a: number, b: number) => [number, number];
    readonly slugFor: (a: number, b: number, c: number, d: number) => [number, number];
    readonly slugSegment: (a: number, b: number) => [number, number];
    readonly smoothInkStroke: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly snapInkShape: (a: number, b: number) => [number, number, number];
    readonly snapToText: (a: any, b: number, c: number) => [number, number, number];
    readonly sortByCitations: (a: any) => [number, number, number];
    readonly sortByDue: (a: any) => [number, number, number];
    readonly sortByReadingOrder: (a: any) => [number, number, number];
    readonly sortHitOrder: (a: any, b: any) => [number, number, number];
    readonly sourceNoteTemplateContext: (a: any) => [number, number, number];
    readonly spanDistance: (a: any, b: any) => [number, number, number];
    readonly spanPoints: (a: any, b: any) => [number, number, number];
    readonly splitBibliographyEntries: (a: any) => [number, number, number];
    readonly splitByAuthorStart: (a: any) => [number, number, number];
    readonly splitByMargins: (a: any) => [number, number, number];
    readonly splitHeadline: (a: number, b: number) => [number, number, number];
    readonly splitInkTextLayer: (a: number, b: number) => [number, number, number];
    readonly splitLeaf: (a: number, b: number) => [number, number];
    readonly splitNumberedEntries: (a: any) => [number, number, number];
    readonly splitOutsideEdits: (a: any) => [number, number, number];
    readonly splitPane: (a: any, b: number, c: number, d: any, e: number, f: number) => [number, number, number];
    readonly splitPaperDrop: (a: any) => [number, number, number];
    readonly splitProposalContent: (a: number, b: number) => [number, number, number];
    readonly splitStorageListing: (a: number, b: number, c: any) => [number, number, number];
    readonly splitTopLevel: (a: number, b: number) => [number, number, number];
    readonly stackMarginNotes: (a: any, b: number) => [number, number, number];
    readonly stampWorkspaceId: (a: any, b: any) => [number, number, number];
    readonly startAiSession: (a: any) => [number, number, number];
    readonly statusPatchForExperiment: (a: any, b: any, c: number, d: number) => [number, number, number];
    readonly stepCursor: (a: number, b: number, c: number) => number;
    readonly stepsToPrune: (a: number, b: number) => [number, number, number];
    readonly storageListPage: () => number;
    readonly storageListingHasMore: (a: number) => number;
    readonly storedDigest: (a: number, b: number, c: number, d: number) => [number, number];
    readonly storedDigests: (a: any) => [number, number, number];
    readonly streakDays: (a: any, b: number, c: number) => [number, number, number];
    readonly strideForStep: (a: number) => number;
    readonly stripArchiveRoot: (a: any) => [number, number, number];
    readonly stripFrontmatter: (a: number, b: number) => [number, number, number];
    readonly stripInvisible: (a: number, b: number) => [number, number];
    readonly stripKindSuffix: (a: any) => [number, number, number, number];
    readonly stripRegionMarkers: (a: number, b: number) => [number, number];
    readonly stripStopwords: (a: number, b: number) => [number, number];
    readonly stripUnresolvedImageRefs: (a: any, b: number, c: number, d: any, e: any) => [number, number, number, number];
    readonly strokeBaseWidth: (a: number, b: number, c: number) => number;
    readonly strokeClipText: (a: any) => [number, number, number, number];
    readonly strokePath: (a: number, b: number) => any;
    readonly strokePointTriples: (a: number, b: number, c: number) => [number, number, number, number];
    readonly strokeedgesplit_begin: (a: number, b: any) => [number, number];
    readonly strokeedgesplit_end: (a: number) => number;
    readonly strokeedgesplit_move: (a: number, b: any, c: any) => [number, number, number];
    readonly strokeedgesplit_new: () => number;
    readonly strokeedgesplit_outside: (a: number) => number;
    readonly studentsOf: (a: number, b: number, c: any) => [number, number, number];
    readonly substituteVariables: (a: number, b: number, c: any) => [number, number, number, number];
    readonly subtreeIds: (a: any) => [number, number, number];
    readonly summarizePdfDrop: (a: any) => [number, number, number];
    readonly supportsLocalEmbedding: (a: number, b: number) => number;
    readonly surnameKey: (a: number, b: number) => [number, number];
    readonly syncDot: (a: any) => [number, number, number];
    readonly syncFieldShown: (a: number, b: number, c: number) => number;
    readonly syncStateFromRow: (a: any) => [number, number, number];
    readonly syncStrokeSteps: (a: any, b: number) => [number, number, number];
    readonly syncedTables: () => [number, number, number];
    readonly tabAt: (a: any, b: number, c: number, d: number) => [number, number, number];
    readonly tabKey: (a: any) => [number, number, number, number];
    readonly tabMode: (a: any) => [number, number, number];
    readonly tabSeparatedToMarkdownTable: (a: any) => [number, number, number];
    readonly tableGroups: (a: any) => [number, number, number];
    readonly tagColor: (a: number, b: number) => [number, number];
    readonly tagToHashtag: (a: number, b: number) => [number, number];
    readonly tagTone: (a: any) => [number, number, number];
    readonly tailClause: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly takeInkRedo: (a: any) => [number, number, number];
    readonly takeInkUndo: (a: any) => [number, number, number];
    readonly takePageStep: (a: any, b: number, c: number) => [number, number, number];
    readonly temporaryName: (a: number, b: number, c: number, d: number) => [number, number];
    readonly texEngineArgs: (a: any, b: number, c: number) => [number, number, number];
    readonly texLogErrors: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly textBoxFromRect: (a: any) => [number, number, number];
    readonly textFingerprint: (a: any) => [number, number, number, number];
    readonly textHash: (a: number, b: number) => [number, number];
    readonly textSelectionFromOffsets: (a: any, b: any) => [number, number, number];
    readonly textWithinCap: (a: number, b: number) => number;
    readonly themeConfigTemplate: () => [number, number];
    readonly thumbFits: (a: number) => number;
    readonly thumbKey: (a: number, b: number) => [number, number];
    readonly tickFormat: (a: any) => [number, number, number];
    readonly timelineLaneOffset: (a: number, b: number, c: number) => any;
    readonly timelineLaneX: (a: number, b: number, c: any) => [number, number, number];
    readonly timelineMidYear: (a: number, b: number, c: any) => [number, number, number];
    readonly titleFixes: (a: any) => [number, number, number];
    readonly titleForPath: (a: number, b: number, c: any) => [number, number, number, number];
    readonly titleFromFileName: (a: number, b: number) => [number, number];
    readonly titleKey: (a: number, b: number) => any;
    readonly titleOf: (a: any) => [number, number, number, number];
    readonly titleSimilarity: (a: number, b: number, c: number, d: number) => number;
    readonly toAnnotationSearchDocs: (a: any, b: any, c: number) => [number, number, number];
    readonly toExtractionResult: (a: any, b: number, c: number) => [number, number, number];
    readonly toPdfSearchDocs: (a: any, b: number) => [number, number, number];
    readonly toRelativeBlobLinks: (a: any, b: any) => [number, number, number];
    readonly toRenderStrokes: (a: any, b: any, c: number, d: number) => [number, number, number];
    readonly toSearchDocs: (a: any, b: number) => [number, number, number];
    readonly toZoteroItem: (a: any) => [number, number, number];
    readonly toZoteroWritePayload: (a: any, b: number, c: number) => [number, number, number];
    readonly toastInitialState: () => [number, number, number];
    readonly toastReduce: (a: any, b: any) => [number, number, number];
    readonly toggleExpanded: (a: any, b: number, c: number) => [number, number, number];
    readonly toggleGroup: (a: any, b: number, c: number) => [number, number, number];
    readonly togglePreview: (a: any, b: number, c: number) => [number, number, number];
    readonly toggleSection: (a: any, b: number, c: number) => [number, number, number];
    readonly tokenize: (a: any, b: any) => [number, number, number];
    readonly toolOwnsThePage: (a: number, b: number) => number;
    readonly trailDiameterPx: (a: number, b: number) => number;
    readonly transformTextOps: (a: any, b: any) => [number, number, number];
    readonly transitionsOn: (a: any) => number;
    readonly translateInkPaths: (a: any, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly treePathPairs: (a: any, b: any, c: number, d: number) => [number, number, number];
    readonly treePaths: (a: any, b: any, c: number, d: number) => [number, number, number];
    readonly triageReportedPaths: (a: any) => [number, number, number];
    readonly trimmedOrNone: (a: number, b: number) => any;
    readonly uncroppedFigureBox: (a: any) => [number, number, number];
    readonly unionRect: (a: any) => [number, number, number];
    readonly uniqueCiteKey: (a: any, b: any) => [number, number, number, number];
    readonly uniqueConstraintName: (a: number, b: number) => [number, number];
    readonly uniqueDeviceName: (a: number, b: number, c: number, d: number, e: any) => [number, number, number, number];
    readonly uniqueFigureName: (a: number, b: number, c: any) => [number, number, number, number];
    readonly uniqueTitle: (a: number, b: number, c: any) => [number, number, number, number];
    readonly unpackLocalVectorRow: (a: number, b: number) => [number, number, number];
    readonly unpackVectorBlob: (a: number, b: number) => [number, number];
    readonly unpackVectorHead: (a: number, b: number) => [number, number, number];
    readonly unpackVectors: (a: number, b: number) => [number, number, number];
    readonly unstageAction: (a: number, b: number) => [number, number];
    readonly unstampForCompare: (a: number, b: number, c: number, d: number) => [number, number];
    readonly untrustedContextRule: () => [number, number];
    readonly uploadContentType: (a: number, b: number, c: number, d: number) => [number, number];
    readonly uploadErrorSuffix: (a: number, b: number) => [number, number];
    readonly urlMetaReadFailureMessage: (a: number, b: number, c: number) => [number, number];
    readonly urlMetaShellTarget: (a: number, b: number) => [number, number];
    readonly urlMetaToMetadata: (a: any) => [number, number, number];
    readonly usableStatus: (a: number) => number;
    readonly userGateOpen: (a: any, b: number) => [number, number, number];
    readonly usesInkHighlighterPass: (a: number, b: number) => number;
    readonly validateCompute: (a: any) => [number, number];
    readonly validateComputeError: (a: any) => [number, number, number, number];
    readonly validateDependencies: (a: any) => [number, number];
    readonly validateDependenciesError: (a: any) => [number, number, number, number];
    readonly validateNewMember: (a: any) => [number, number, number];
    readonly validateOrgName: (a: number, b: number) => [number, number, number, number];
    readonly vaultAssetPathsInBody: (a: number, b: number) => [number, number];
    readonly vaultBodyPreview: (a: number, b: number, c: number) => [number, number];
    readonly vaultBodyPreviewChars: () => number;
    readonly vaultImageMarkdown: (a: number, b: number, c: number, d: number) => [number, number];
    readonly vaultImagePrefix: () => [number, number];
    readonly vaultPageBase: (a: any, b: any) => [number, number, number];
    readonly vaultPageSide: (a: any, b: any) => [number, number, number];
    readonly vaultRootFromText: (a: number, b: number) => any;
    readonly vaultTooLargeMessage: (a: number) => [number, number];
    readonly vectorFolderCacheDir: () => [number, number];
    readonly vectorFolderPath: (a: number, b: number) => [number, number];
    readonly vectorIndexFromBytes: (a: number, b: number) => [number, number, number];
    readonly vectorStoreKey: (a: number, b: number) => [number, number];
    readonly vectorindex_add: (a: number, b: any, c: number, d: number) => [number, number];
    readonly vectorindex_allIds: (a: number) => [number, number, number];
    readonly vectorindex_clear: (a: number) => void;
    readonly vectorindex_dimensions: (a: number) => number;
    readonly vectorindex_has: (a: number, b: number, c: number) => number;
    readonly vectorindex_nearestDocs: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly vectorindex_remove: (a: number, b: any) => [number, number];
    readonly vectorindex_search: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly vectorindex_searchDocs: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly vectorindex_size: (a: number) => number;
    readonly vectorindex_toBytes: (a: number) => [number, number];
    readonly vectorindex_vectorOf: (a: number, b: number, c: number) => [number, number];
    readonly verdictFor: (a: any, b: number, c: number, d: any) => [number, number, number];
    readonly verdictsFor: (a: any, b: any) => [number, number, number];
    readonly viewableArtifactUrl: (a: number, b: number, c: number) => any;
    readonly visibleRows: (a: any, b: any) => [number, number, number];
    readonly visualPageSize: (a: any, b: number) => [number, number, number];
    readonly vscodeJson: (a: any) => [number, number, number, number];
    readonly walkOverleafSections: (a: any, b: any) => [number, number, number];
    readonly webCacheDocumentLimit: () => number;
    readonly webdavSupports: (a: number, b: number) => number;
    readonly wikiPageRefs: (a: any) => [number, number, number];
    readonly wikiProposalContent: (a: any) => [number, number, number];
    readonly wikiSourceDocuments: (a: any, b: any, c: number, d: number) => [number, number, number];
    readonly wireErrorReply: (a: any, b: number, c: number) => [number, number, number];
    readonly wireOkReplyHead: (a: any) => [number, number, number];
    readonly wireParseRequest: (a: number, b: number) => [number, number, number];
    readonly wireRoute: (a: number, b: number, c: number) => [number, number, number];
    readonly wireTag: (a: any) => [number, number, number];
    readonly withActive: (a: any, b: number, c: number) => [number, number, number];
    readonly withImageWidth: (a: any, b: number, c: number) => [number, number, number, number];
    readonly withInkPageBackground: (a: number, b: number, c: number, d: number) => [number, number];
    readonly withInkPageFigures: (a: number, b: number, c: any) => [number, number, number, number];
    readonly withMdImageAlt: (a: any, b: any) => [number, number, number, number];
    readonly withMissingFigures: (a: any, b: any) => [number, number, number];
    readonly withStoredHeights: (a: any, b: any) => [number, number, number];
    readonly withTagLine: (a: number, b: number, c: any) => [number, number, number, number];
    readonly withoutExisting: (a: any, b: number, c: number) => [number, number, number];
    readonly withoutGroup: (a: any) => [number, number, number];
    readonly workshopProjectList: (a: any) => [number, number, number];
    readonly workspaceBodies: (a: any, b: any) => [number, number, number];
    readonly workspaceSnapshotCounts: (a: any) => [number, number, number];
    readonly wrapRegion: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
    readonly writeConflictMarkers: (a: any, b: any) => [number, number, number, number];
    readonly writeFrontmatter: (a: any, b: any) => [number, number, number, number];
    readonly writeInkNoteBody: (a: any, b: any) => [number, number, number, number];
    readonly writeInkNoteMeta: (a: any) => [number, number, number];
    readonly writeScope: (a: any) => [number, number, number];
    readonly yearColours: (a: any) => [number, number, number];
    readonly yearSpacing: () => number;
    readonly zenodoRecordId: (a: number, b: number) => [number, number];
    readonly zoomIn: (a: number, b: number, c: number) => number;
    readonly zoomOut: (a: number, b: number, c: number) => number;
    readonly zoteroAnnotationFromItem: (a: any) => [number, number, number];
    readonly zoteroArxivId: (a: any) => [number, number, number];
    readonly zoteroAttemptBackoffMs: (a: number) => number;
    readonly zoteroContentKeys: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly zoteroHeaders: (a: number, b: number) => [number, number, number];
    readonly zoteroIsPdfAttachment: (a: any) => [number, number, number];
    readonly zoteroItemKey: (a: any) => [number, number, number, number];
    readonly zoteroKeyOf: (a: any) => [number, number, number, number];
    readonly zoteroKeysUrl: (a: number, b: number, c: number, d: number, e: any) => [number, number, number, number];
    readonly zoteroLibraryUrl: (a: number, b: number, c: number, d: number) => [number, number];
    readonly zoteroLocalApiOff: () => [number, number];
    readonly zoteroLocalStatusMessage: (a: number) => [number, number, number];
    readonly zoteroNoteFromItem: (a: any) => [number, number, number];
    readonly zoteroPageStarts: (a: number, b: number) => [number, number, number];
    readonly zoteroPageUrl: (a: number, b: number, c: number, d: number, e: any, f: number, g: number) => [number, number, number, number];
    readonly zoteroPickMainPdf: (a: any) => [number, number, number, number];
    readonly zoteroPullJoin: (a: any, b: any, c: any, d: any) => [number, number, number];
    readonly zoteroRemoteToInput: (a: any) => [number, number, number];
    readonly zoteroRemoteToMetadata: (a: any) => [number, number, number];
    readonly zoteroServerBackoffMs: (a: number, b: number, c: number, d: number) => [number, number];
    readonly zoteroSyncPlan: (a: any, b: any) => [number, number, number];
    readonly zoteroTopLevelPath: (a: number, b: number) => [number, number];
    readonly zoteroTotalResults: (a: number, b: number) => [number, number];
    readonly zoteroWriteBackAnnotations: (a: any) => [number, number, number];
    readonly zoteroWriteBackCreateOutcomes: (a: any, b: number, c: number, d: number, e: any, f: number, g: number) => [number, number, number];
    readonly zoteroWriteBackLibraryVersion: (a: number, b: number) => [number, number];
    readonly zoteroWriteBackMessage: (a: any) => [number, number, number, number];
    readonly zoteroWriteBackUpdateHeaders: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly zoteroWriteBackUpdateOutcome: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => [number, number, number];
    readonly zoteroWriteBackUpdateUrl: (a: number, b: number, c: number, d: number) => [number, number];
    readonly wasm_bindgen_cfd6dee753b71865___convert__closures_____invoke___alloc_508e33bd5656020b___string__String__f64__true_: (a: number, b: number, c: number, d: number) => number;
    readonly wasm_bindgen_cfd6dee753b71865___convert__closures_____invoke___js_sys_a74ea40957c530a8___Function_fn_wasm_bindgen_cfd6dee753b71865___JsValue_____wasm_bindgen_cfd6dee753b71865___sys__Undefined___js_sys_a74ea40957c530a8___Function_fn_wasm_bindgen_cfd6dee753b71865___JsValue_____wasm_bindgen_cfd6dee753b71865___sys__Undefined_______true_: (a: number, b: number, c: any, d: any) => void;
    readonly wasm_bindgen_cfd6dee753b71865___convert__closures_____invoke___wasm_bindgen_cfd6dee753b71865___JsValue__wasm_bindgen_cfd6dee753b71865___JsValue__true_: (a: number, b: number, c: any) => any;
    readonly wasm_bindgen_cfd6dee753b71865___convert__closures_____invoke_______true_: (a: number, b: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_destroy_closure: (a: number, b: number) => void;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __externref_drop_slice: (a: number, b: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
