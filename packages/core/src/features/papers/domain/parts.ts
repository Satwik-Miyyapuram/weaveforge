import { ValidationError } from "../../../shared/errors.js";
import type {
  Clock,
  Identifiable,
  IdGenerator,
  IReadableRepository,
  IWritableRepository,
} from "../../../shared/parts.js";
import { rust } from "../../../shared/rust.js";

// --- paper-field ---
/** Supported custom field kinds on papers. */
export const PAPER_FIELD_KINDS = [
  "text",
  "number",
  "select",
  "multi_select",
  "relation",
  "rollup",
] as const;
export type PaperFieldKind = (typeof PAPER_FIELD_KINDS)[number];

export type PaperFieldRollupAgg = "count" | "values" | "sum" | "avg";

/** Rollup config encoded in `options` for kind=rollup. */
export interface PaperFieldRollupConfig {
  relationFieldId: string;
  agg: PaperFieldRollupAgg;
  /** Required for values/sum/avg — the related paper's field to aggregate. */
  sourceFieldId?: string;
}

/** Project-scoped definition of a custom field shown on every paper. */
export interface PaperFieldDef extends Identifiable {
  id: string;
  name: string;
  kind: PaperFieldKind;
  /**
   * Option labels for select / multi_select.
   * For rollup: encoded config tokens (`rel:…`, `agg:…`, optional `src:…`).
   * Empty for text / number / relation.
   */
  options: string[];
  sortOrder: number;
}

export interface NewPaperFieldDefInput {
  name: string;
  kind: PaperFieldKind;
  options?: string[];
  rollup?: PaperFieldRollupConfig;
}

/**
 * Stored value payload. Shape depends on the field kind:
 * - text / select → string
 * - number → number
 * - multi_select / relation → string[] (option labels or paper ids)
 * - rollup → not stored (computed)
 */
export type PaperFieldValueData = string | number | string[];

/** One paper's value for one field definition. */
export interface PaperFieldValue extends Identifiable {
  id: string;
  paperId: string;
  fieldId: string;
  value: PaperFieldValueData;
}

export interface SetPaperFieldValueInput {
  paperId: string;
  fieldId: string;
  value: PaperFieldValueData;
}

export class PaperFieldValidationError extends ValidationError {
  constructor(message: string) {
    super(message);
    this.name = "PaperFieldValidationError";
  }
}

// --- paper ---
/**
 * Papers domain model — pure, no I/O, no SDK imports.
 *
 * The `Paper` entity and its invariants live here. Persistence and metadata
 * fetching are someone else's job (infrastructure). This file has exactly one
 * reason to change: the rules of what a Paper *is* (Single Responsibility).
 */
export type PaperStatus = "to_read" | "reading" | "read" | "skimmed";

export const PAPER_STATUSES: readonly PaperStatus[] = [
  "to_read",
  "reading",
  "read",
  "skimmed",
];

export interface Paper extends Identifiable {
  id: string;
  title: string;
  authors: string[];
  year?: number;
  venue?: string;
  doi?: string;
  arxivId?: string;
  url?: string;
  pdfPath?: string;
  abstract?: string;
  /** The reader's own summary / notes. */
  summary?: string;
  status: PaperStatus;
  /** Optional 1–5 rating. */
  rating?: number;
  /** ISO date (yyyy-mm-dd) the paper was read. */
  readAt?: string;
  bibtex?: string;
  /** Keyword tags (normalized, no leading '#'). Derived from the summary and
   *  Zotero annotations, or edited by hand. Used by filters + the graph. */
  tags: string[];
  /** Extensible bag for anything not modeled explicitly. */
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/**
 * The card projection of a paper — what `listSummaries()` returns.
 *
 * The papers grid paints a card from a subset of columns; the full row (the
 * abstract, the bibtex, the `metadata` bag) is only loaded when a paper is
 * opened. Typing that subset as a `Paper` is what let a summary be concatenated
 * with full rows into one list and then written back through `toRow`, dropping
 * everything the projection had not fetched (review-2 F6).
 *
 * The fields here are exactly what the card needs and what the summary columns
 * carry (see `PAPER_SUMMARY_COLUMNS` in the PostgREST adapter). Absent on
 * purpose: `abstract`, `bibtex`, `metadata`, `venue`, `rating`.
 */
export interface PaperSummary {
  id: string;
  title: string;
  authors: string[];
  status: PaperStatus;
  year?: number;
  /** ISO date (yyyy-mm-dd) the paper was read. */
  readAt?: string;
  pdfPath?: string;
  doi?: string;
  arxivId?: string;
  url?: string;
  /** The reader's own summary / notes (a column, not the derived `metadata`). */
  summary?: string;
  /** Keyword tags (normalized, no leading '#'). */
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

/** Fields accepted when creating a paper; the rest are defaulted. */
export interface NewPaperInput {
  title: string;
  authors?: string[];
  year?: number;
  venue?: string;
  doi?: string;
  arxivId?: string;
  url?: string;
  abstract?: string;
  summary?: string;
  status?: PaperStatus;
  rating?: number;
  bibtex?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

/** A paper input whose optional fields may be `null`, as the Rust core returns them. */
export type NullablePaperInput = { title: string } & {
  [K in Exclude<keyof NewPaperInput, "title">]?: NewPaperInput[K] | null;
};

/** Drops `null` fields so a Rust-built input fits `NewPaperInput`. */
export function paperInputWithoutNulls(input: NullablePaperInput): NewPaperInput {
  return Object.fromEntries(Object.entries(input).filter(([, v]) => v !== null)) as unknown as NewPaperInput;
}

export interface PaperFilter {
  status?: PaperStatus;
  /** Case-insensitive substring match against title. */
  titleContains?: string;
  arxivId?: string;
  doi?: string;
}

export class PaperValidationError extends ValidationError {
  constructor(message: string) {
    super(message);
    this.name = "PaperValidationError";
  }
}

/**
 * Build a valid Paper from partial input, applying defaults and invariants.
 * Throwing here keeps invalid entities from ever reaching a repository.
 */
export function createPaper(
  input: NewPaperInput,
  deps: { clock: Clock; ids: IdGenerator },
): Paper {
  let title: string;
  try {
    title = rust().checkNewPaper(input.title ?? "", input.rating ?? undefined);
  } catch (error) {
    throw new PaperValidationError((error as Error).message);
  }
  const now = deps.clock.nowIso();
  return {
    id: deps.ids.newId(),
    title,
    authors: input.authors ?? [],
    year: input.year,
    venue: input.venue,
    doi: rust().normalizeDoi(input.doi),
    arxivId: input.arxivId?.trim(),
    url: input.url,
    abstract: input.abstract,
    summary: input.summary,
    status: input.status ?? "to_read",
    rating: input.rating,
    bibtex: input.bibtex,
    tags: rust().normalizeTags(input.tags ?? []),
    metadata: input.metadata ?? {},
    createdAt: now,
    updatedAt: now,
  };
}

/** A hashtag with the offset it was found at, for evidence that points at it. */
export interface HashtagRef {
  /** Normalized: no leading '#', lowercased. */
  tag: string;
  /** Index of the '#' in the text it was read from. */
  index: number;
  /** Length of the matched text, including the '#'. */
  length: number;
}

/** The placeholder older rows hold in place of a summary. */
export const NO_SUMMARY = "No summary yet.";

// --- parts ---
// --- annotation-pin ---
/** Project-scoped placement of a Zotero annotation in a report section. */
export interface AnnotationPin extends Identifiable {
  id: string;
  paperId: string;
  annotationKey: string;
  reportSectionId: string;
  createdAt: string;
}

export interface SaveAnnotationPinInput {
  paperId: string;
  annotationKey: string;
  reportSectionId: string;
}

// --- annotation-pin-repository ---
export interface IAnnotationPinRepository {
  save(input: SaveAnnotationPinInput): Promise<AnnotationPin>;
  remove(paperId: string, annotationKey: string): Promise<void>;
  listForProject(): Promise<AnnotationPin[]>;
  listForPaper(paperId: string): Promise<AnnotationPin[]>;
  listForSection(reportSectionId: string): Promise<AnnotationPin[]>;
}

// --- annotation-quotation-type ---
/** Citavi-style taxonomy for how an annotation will be used in writing. */
export type QuotationType = "direct" | "paraphrase" | "summary";

/** Project-scoped quotation type for a Zotero annotation key. */
export interface AnnotationQuotationType extends Identifiable {
  id: string;
  paperId: string;
  annotationKey: string;
  quotationType: QuotationType;
  createdAt: string;
  updatedAt: string;
}

export interface SaveAnnotationQuotationTypeInput {
  paperId: string;
  annotationKey: string;
  quotationType: QuotationType;
}

// --- annotation-quotation-type-repository ---
export interface IAnnotationQuotationTypeRepository {
  save(input: SaveAnnotationQuotationTypeInput): Promise<AnnotationQuotationType>;
  remove(paperId: string, annotationKey: string): Promise<void>;
  listForPaper(paperId: string): Promise<AnnotationQuotationType[]>;
}

// --- paper-field-repository ---
/**
 * Project-scoped custom field defs + values. Implementations are scoped to the
 * current user/project the same way as annotation pins.
 */
export interface IPaperFieldRepository {
  listDefs(): Promise<PaperFieldDef[]>;
  saveDef(def: PaperFieldDef): Promise<void>;
  deleteDef(id: string): Promise<void>;

  listValuesForPaper(paperId: string): Promise<PaperFieldValue[]>;
  listValuesForProject(): Promise<PaperFieldValue[]>;
  /** Upsert by (paperId, fieldId); preserves id on update. */
  setValue(input: SetPaperFieldValueInput): Promise<PaperFieldValue>;
  removeValue(paperId: string, fieldId: string): Promise<void>;
}

// --- paper-identity ---
/**
 * The little a citation link needs to know about a paper in the library.
 *
 * Three fields, and each has a reader: `id` to link to, `title` to show, and
 * `status` to say whether the reader has read it. Nothing else is read by either
 * caller, which is the point — `findByDoi` and `findByArxivId` answer with a
 * whole `Paper`, so a citation lookup transferred the abstract, the bibtex and
 * the metadata bag of every reference it matched.
 *
 * It is the same lesson as `listSummaries`, in a different caller: a projection
 * typed as a full entity is a lie that costs columns, and a caller that only
 * needs an id should not be handed one.
 */
export interface PaperIdentity {
  id: string;
  title: string;
  status: PaperStatus;
}

/**
 * Looking a paper up by the identifier a citation carries.
 *
 * A port of its own rather than two more methods on `IPaperRepository` because
 * its callers do not have a repository: the citation linker and the reader's
 * reference panel want to know whether a DOI is in the library and what it looks
 * like, and nothing else. Depending on the narrow port is what keeps them from
 * growing a use for `list()` or `save()`.
 */
export interface IPaperIdentityLookup {
  findIdentityByArxivId(arxivId: string): Promise<PaperIdentity | null>;
  findIdentityByDoi(doi: string): Promise<PaperIdentity | null>;
}

// --- paper-repository ---
/**
 * Repository contract for papers.
 *
 * Defined in the domain layer (Dependency Inversion): application code depends
 * on this interface; infrastructure provides PostgREST / in-memory / SQLite
 * implementations. Any implementation must be substitutable (Liskov) and is
 * verified by the shared contract test suite.
 */
/**
 * The full paper store, which also answers the narrow identity question.
 *
 * `extends IPaperIdentityLookup` rather than declaring those two methods here:
 * a caller that only wants to know whether a DOI is in the library depends on
 * the narrow port, and an adapter is one object that satisfies both. The methods
 * are required — an implementation that cannot answer "is this DOI here" cannot
 * serve the citation linker at all, and finding that out at a call site is worse
 * than finding it out at the class.
 */
export interface IPaperRepository
  extends IReadableRepository<Paper, PaperFilter>,
    IWritableRepository<Paper>,
    IPaperIdentityLookup {
  /**
   * The card projection every paper list paints from.
   *
   * Returns {@link PaperSummary}, not `Paper`: the projection drops the
   * abstract, bibtex and metadata bag, and typing it as a full paper is what
   * allowed a summary to be written back over a real row (review-2 F6). An
   * implementation that has the whole row may return it — a `Paper` satisfies
   * `PaperSummary` — but a caller may only rely on the summary fields.
   *
   * Required, not optional. It was optional "so an implementation may fall back
   * to list()", which pushed that decision to every caller: six of them wrote
   * `listSummaries?.() ?? list()`, and every one of those is a place that
   * silently loads abstracts and metadata it does not paint — or, worse, hands
   * back the wide type and undoes the point of the projection. An implementation
   * that genuinely has no cheaper read implements this by returning `list()`,
   * which is where that choice belongs.
   */
  listSummaries(): Promise<PaperSummary[]>;
  /** Look up by arXiv id for dedupe on import. Returns null if not present. */
  findByArxivId(arxivId: string): Promise<Paper | null>;
  /** Look up by (normalized) DOI for dedupe on import. */
  findByDoi(doi: string): Promise<Paper | null>;
  /**
   * The paper whose `titleKey(title)` equals `key`, or null.
   *
   * Dedupe by title used to load the whole library and compare keys in memory
   * on every add. An adapter narrows the read; the match itself stays the
   * domain's `titleKey`, so the answer is the one that scan gave.
   */
  findByTitleKey(key: string): Promise<Paper | null>;
  /**
   * Writes the tag column and the stamp, and nothing else.
   *
   * The tag cache was written back as a whole row read moments earlier, which
   * overwrote any edit made in between. A missing paper is left missing.
   */
  setTags(id: string, tags: string[], updatedAt: string): Promise<void>;
  /**
   * Replaces the summary only if it still is `expected` (undefined: no summary).
   *
   * Returns whether it did. A caller that gets false re-reads and tries again,
   * so two appends made at once both land instead of the second erasing the
   * first. A missing paper is left missing and answers false.
   */
  replaceSummary(
    id: string,
    expected: string | undefined,
    next: string,
    updatedAt: string,
  ): Promise<boolean>;
}
