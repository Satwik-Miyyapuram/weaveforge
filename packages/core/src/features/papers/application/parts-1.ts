import { WeaveForgeError } from "../../../shared/errors.js";
import type { Clock, IdGenerator } from "../../../shared/parts.js";
import { rust } from "../../../shared/rust.js";
import type { IBibliographyIntegration } from "../../integrations/domain/parts.js";
import {
  createPaper,
  type IPaperFieldRepository,
  type IPaperRepository,
  type NewPaperFieldDefInput,
  type NewPaperInput,
  type Paper,
  type PaperFieldDef,
  type PaperFieldKind,
  PaperFieldValidationError,
  type PaperFieldValue,
  type PaperFieldValueData,
  type PaperStatus,
} from "../domain/parts.js";

// --- metadata-source ---
/**
 * Paper metadata source contract + resolver.
 *
 * Each external source (arXiv, Crossref, Semantic Scholar, Zotero) implements
 * `IMetadataSource`. The resolver delegates to the first source that supports a
 * given reference. Adding a new source means adding a class — never editing the
 * resolver or the use-case (Open/Closed Principle).
 */
export type PaperRef =
  | { kind: "arxiv"; value: string }
  | { kind: "doi"; value: string }
  | { kind: "zotero"; value: string }
  | { kind: "url"; value: string }
  | { kind: "bibliographic"; value: string; hints?: { title?: string; year?: number; firstAuthor?: string } };

/** Metadata returned by a source, shaped to feed `createPaper`. */
export type PaperMetadata = NewPaperInput;

export interface IMetadataSource {
  /** Stable id, e.g. "arxiv". */
  readonly id: string;
  /** Whether this source can resolve the given reference. */
  supports(ref: PaperRef): boolean;
  /** Fetch and normalize metadata for the reference. */
  fetch(ref: PaperRef): Promise<PaperMetadata>;
}

/** Why one provider could not answer. */
export interface MetadataSourceFailure {
  sourceId: string;
  message: string;
}

export class MetadataResolutionError extends WeaveForgeError {
  /** Each provider's error, in the order tried, so an outage does not read as "not found". */
  readonly failures: readonly MetadataSourceFailure[];

  constructor(message: string, failures: readonly MetadataSourceFailure[] = []) {
    super(failures.length ? `${message} ${failures.map((f) => `${f.sourceId}: ${f.message}`).join("; ")}` : message);
    this.name = "MetadataResolutionError";
    this.failures = failures;
  }
}

export class MetadataResolver {
  private readonly sources: readonly IMetadataSource[];
  private readonly cascadeIdentifiers: boolean;

  /**
   * `cascadeIdentifiers` — used by the reader's lookup — lets an identifier
   * ref fall through the provider list when the first provider fails (DOI not
   * in Semantic Scholar → Crossref), instead of surfacing the first error.
   * The add-paper flow keeps the strict first-source semantics.
   */
  constructor(sources: readonly IMetadataSource[], cascadeIdentifiers = false) {
    this.sources = sources;
    this.cascadeIdentifiers = cascadeIdentifiers;
  }

  async resolve(ref: PaperRef): Promise<PaperMetadata> {
    const { metadata } = await this.resolveWithSource(ref);
    return metadata;
  }

  /**
   * Resolution with the answering source's id. Identifier refs keep their
   * original semantics (first supporting source, errors surface) unless the
   * resolver was built to cascade them; a bibliographic search tries each
   * provider in order and only fails when no provider matches.
   */
  async resolveWithSource(ref: PaperRef): Promise<{ metadata: PaperMetadata; sourceId: string }> {
    const sources = this.sources.filter((s) => s.supports(ref));
    if (!sources.length) {
      throw new MetadataResolutionError(
        `No metadata source supports reference of kind "${ref.kind}".`,
      );
    }
    if (ref.kind !== "bibliographic" && !this.cascadeIdentifiers) {
      const source = sources[0]!;
      return { metadata: await source.fetch(ref), sourceId: source.id };
    }
    const failures: MetadataSourceFailure[] = [];
    for (const source of sources) {
      try {
        return { metadata: await source.fetch(ref), sourceId: source.id };
      } catch (err) {
        // Kept, then the next provider is tried.
        const message = err instanceof Error ? err.message : String(err);
        failures.push({ sourceId: source.id, message: message.slice(0, 300) });
      }
    }
    throw new MetadataResolutionError(`No metadata source resolved the ${ref.kind} reference.`, failures);
  }
}

// --- add-paper.use-case ---
/**
 * Use-cases for adding papers.
 *
 * Orchestration only: it coordinates the domain factory, the repository, and
 * (for imports) the metadata resolver. It contains no persistence details and
 * no HTTP — those are injected as interfaces (Dependency Inversion). Its single
 * responsibility is the *business rule* of adding a paper, including dedupe.
 */
export interface AddPaperDeps {
  repository: IPaperRepository;
  clock: Clock;
  ids: IdGenerator;
}

/**
 * A paper add and whether it wrote anything. Dedupe hands back the paper the
 * library already had, and a caller that says "Added" for that one is wrong.
 */
export interface AddPaperResult {
  paper: Paper;
  created: boolean;
}

export class AddPaperUseCase {
  constructor(private readonly deps: AddPaperDeps) {}

  /** Add a paper from manually entered fields. */
  async addManual(input: NewPaperInput): Promise<Paper> {
    return (await this.add(input)).paper;
  }

  /** {@link addManual}, saying whether the paper is new or a duplicate. */
  async add(input: NewPaperInput): Promise<AddPaperResult> {
    const existing =
      (await this.findDuplicate(input.arxivId, input.doi)) ?? (await this.findByTitle(input));
    if (existing) return { paper: existing, created: false };

    const paper = createPaper(input, {
      clock: this.deps.clock,
      ids: this.deps.ids,
    });
    await this.deps.repository.save(paper);
    return { paper, created: true };
  }

  private async findDuplicate(
    arxivId?: string,
    doi?: string,
  ): Promise<Paper | null> {
    if (arxivId) {
      const byArxiv = await this.deps.repository.findByArxivId(arxivId.trim());
      if (byArxiv) return byArxiv;
    }
    const normDoi = rust().normalizeDoi(doi);
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
    if (input.arxivId?.trim() || rust().normalizeDoi(input.doi)) return null;
    const key = rust().titleKey(input.title);
    if (!key) return null;
    return await this.deps.repository.findByTitleKey(key);
  }
}

/** Decides what a pasted reference really is (see `parsePaperRef`). */
export type ParsePaperRef = (
  kind: Exclude<PaperRef["kind"], "bibliographic">,
  value: string,
) => PaperRef | Promise<PaperRef>;

/**
 * Importing a paper from an external reference (arXiv id / DOI). Composes the
 * metadata resolver with the add use-case so the dedupe rule is reused.
 */
export class ImportPaperUseCase {
  constructor(
    private readonly resolver: MetadataResolver,
    private readonly addPaper: AddPaperUseCase,
    /** Parses the pasted reference. Defaults to the Rust parser (`rust()`). */
    private readonly parseRef: ParsePaperRef = (kind, value) => rust().parsePaperRef(kind, value),
  ) {}

  async fromRef(input: PaperRef, status?: PaperStatus): Promise<Paper> {
    return (await this.importRef(input, status)).paper;
  }

  /** {@link fromRef}, saying whether the paper is new or a duplicate. */
  async importRef(input: PaperRef, status?: PaperStatus): Promise<AddPaperResult> {
    // Whatever the picker said, resolve what was actually pasted: an abs page,
    // a PDF link and a bare id are all the same paper.
    const ref = input.kind === "bibliographic" ? input : await this.parseRef(input.kind, input.value);
    const metadata = await this.resolver.resolve(ref);
    // Ensure the originating id is recorded for future dedupe.
    if (ref.kind === "arxiv" && !metadata.arxivId) metadata.arxivId = ref.value;
    if (ref.kind === "doi" && !metadata.doi) metadata.doi = ref.value;
    return this.addPaper.add(status ? { ...metadata, status } : metadata);
  }
}

// --- manage-paper-fields.use-case ---
/**
 * Project-scoped custom fields on papers: define / rename / set value.
 *
 * Rename only changes the definition name — values stay keyed by field id.
 */
export interface ManagePaperFieldsDeps {
  fields: IPaperFieldRepository;
  ids: IdGenerator;
}

export class ManagePaperFieldsUseCase {
  constructor(private readonly deps: ManagePaperFieldsDeps) {}

  listDefs(): Promise<PaperFieldDef[]> {
    return this.deps.fields.listDefs();
  }

  listValuesForPaper(paperId: string): Promise<PaperFieldValue[]> {
    return this.deps.fields.listValuesForPaper(paperId);
  }

  listValuesForProject(): Promise<PaperFieldValue[]> {
    return this.deps.fields.listValuesForProject();
  }

  async define(input: NewPaperFieldDefInput): Promise<PaperFieldDef> {
    const name = rust().normalizeFieldName(input.name);
    if (!name) throw new PaperFieldValidationError("Field name is required.");
    if (!rust().isPaperFieldKind(input.kind)) {
      throw new PaperFieldValidationError(`Unknown field kind "${input.kind}".`);
    }
    if (input.kind === "rollup") {
      if (!input.rollup) {
        throw new PaperFieldValidationError("Rollup fields require a rollup config.");
      }
      await this.validateRollupConfig(input.rollup.relationFieldId, input.rollup.sourceFieldId);
    }
    const options = normalizeOptions(input.kind, input.options, input.rollup);
    const existing = await this.deps.fields.listDefs();
    if (existing.some((d) => d.name.toLowerCase() === name.toLowerCase())) {
      throw new PaperFieldValidationError(`A field named "${name}" already exists.`);
    }
    const sortOrder =
      existing.length === 0 ? 0 : Math.max(...existing.map((d) => d.sortOrder)) + 1;
    const def: PaperFieldDef = {
      id: this.deps.ids.newId(),
      name,
      kind: input.kind,
      options,
      sortOrder,
    };
    await this.deps.fields.saveDef(def);
    return def;
  }

  async rename(fieldId: string, rawName: string): Promise<PaperFieldDef> {
    const name = rust().normalizeFieldName(rawName);
    if (!name) throw new PaperFieldValidationError("Field name is required.");
    const def = await this.requireDef(fieldId);
    const existing = await this.deps.fields.listDefs();
    if (
      existing.some(
        (d) => d.id !== fieldId && d.name.toLowerCase() === name.toLowerCase(),
      )
    ) {
      throw new PaperFieldValidationError(`A field named "${name}" already exists.`);
    }
    const updated: PaperFieldDef = { ...def, name };
    await this.deps.fields.saveDef(updated);
    return updated;
  }

  async updateOptions(fieldId: string, rawOptions: string[]): Promise<PaperFieldDef> {
    const def = await this.requireDef(fieldId);
    if (def.kind !== "select" && def.kind !== "multi_select") {
      throw new PaperFieldValidationError("Only select fields have options.");
    }
    const updated: PaperFieldDef = {
      ...def,
      options: normalizeOptions(def.kind, rawOptions),
    };
    await this.deps.fields.saveDef(updated);
    return updated;
  }

  async remove(fieldId: string): Promise<void> {
    await this.requireDef(fieldId);
    // A rollup that reads this field would be left pointing at nothing, so the
    // user removes the rollup first. Values go with the def (repository/DB cascade).
    const readers = (await this.deps.fields.listDefs()).filter((d) => {
      if (d.kind !== "rollup") return false;
      const config = rust().parseRollupOptions(d.options);
      return config?.relationFieldId === fieldId || config?.sourceFieldId === fieldId;
    });
    if (readers.length > 0) {
      const names = readers.map((d) => `"${d.name}"`).join(", ");
      throw new PaperFieldValidationError(
        `This field is used by the rollup ${names}. Remove the rollup first.`,
      );
    }
    await this.deps.fields.deleteDef(fieldId);
  }

  async setValue(
    paperId: string,
    fieldId: string,
    raw: PaperFieldValueData | null,
  ): Promise<PaperFieldValue | null> {
    if (!paperId) throw new PaperFieldValidationError("paperId is required.");
    const def = await this.requireDef(fieldId);
    const value = checkedValue(def.kind, raw);
    if (value == null) {
      await this.deps.fields.removeValue(paperId, fieldId);
      return null;
    }
    return this.deps.fields.setValue({ paperId, fieldId, value });
  }

  private async requireDef(fieldId: string): Promise<PaperFieldDef> {
    const def = (await this.deps.fields.listDefs()).find((d) => d.id === fieldId);
    if (!def) throw new PaperFieldValidationError(`No field with id "${fieldId}".`);
    return def;
  }

  private async validateRollupConfig(
    relationFieldId: string,
    sourceFieldId?: string,
  ): Promise<void> {
    const defs = await this.deps.fields.listDefs();
    const relation = defs.find((d) => d.id === relationFieldId);
    if (!relation || relation.kind !== "relation") {
      throw new PaperFieldValidationError("Rollup must reference a relation field.");
    }
    if (!sourceFieldId) return;
    const source = defs.find((d) => d.id === sourceFieldId);
    if (!source || source.kind === "rollup" || source.kind === "relation") {
      throw new PaperFieldValidationError("Rollup source must be a value field.");
    }
  }
}

function normalizeOptions(
  kind: PaperFieldKind,
  raw: string[] | undefined,
  rollup?: NewPaperFieldDefInput["rollup"],
): string[] {
  if (kind === "rollup") {
    if (!rollup) return [];
    return rust().encodeRollupOptions(rollup);
  }
  if (kind !== "select" && kind !== "multi_select") return [];
  return rust().normalizeSelectOptions(raw ?? []);
}

/** The checked value for `kind`, or null to clear it. Refusals become PaperFieldValidationError. */
function checkedValue(kind: PaperFieldKind, raw: PaperFieldValueData | null): PaperFieldValueData | null {
  const core = rust();
  try {
    return core.coercePaperFieldValue(kind, raw);
  } catch (error) {
    throw new PaperFieldValidationError(error instanceof Error ? error.message : String(error));
  }
}

// --- open-access ---
/**
 * Finding a free, legal copy of a paper across the open-access indexes.
 *
 * Each source is asked by the identifiers the paper already has (DOI, arXiv
 * id, PMCID) and answers with candidate copies: where the file is, whether it
 * is a PDF or a web page, and what the index says about its licence and
 * version. The sources are keyless and send CORS headers, so the same chain
 * runs in the web build and the desktop build.
 *
 * Nothing here fetches a paper. It only names candidates; the caller decides
 * which to fetch and how (the reader tries PDFs first, then web pages).
 *
 * The HTTP port is injected. It answers parsed JSON, `null` when the index
 * has no record (a 404), and throws when the index could not be asked (a
 * network error, a 5xx, a rate limit). The result lists the sources that
 * threw, so the caller can tell "no free copy is indexed" apart from "the
 * indexes could not be reached".
 *
 * The parsers, id cleaning and ranking are Rust (`papers::open_access`). This
 * file asks the indexes and runs the chain.
 */

export type OpenAccessFormat = "pdf" | "html";

/** Where a free copy was found. The order here is the order candidates are tried. */
export const OPEN_ACCESS_SOURCES = [
  "paper",
  "arxiv",
  "openalex",
  "unpaywall",
  "semantic-scholar",
  "europe-pmc",
  "biorxiv",
  "doaj",
  "zenodo",
  "hal",
] as const;
export type OpenAccessSource = (typeof OPEN_ACCESS_SOURCES)[number];

export interface OpenAccessCandidate {
  url: string;
  format: OpenAccessFormat;
  source: OpenAccessSource;
  /** As the index states it, e.g. "cc-by". */
  license?: string;
  /** "publishedVersion", "acceptedVersion", "submittedVersion", or a preprint version. */
  version?: string;
}

export interface OpenAccessIds {
  doi?: string | null;
  arxivId?: string | null;
  pmcid?: string | null;
  /** A PDF the paper record already carries (`openAccessPdf`, a typed link). */
  knownPdfUrl?: string | null;
  /**
   * The paper's own web page, when its link is not a PDF: a research blog
   * post or essay that *is* the paper, or a publisher's article page that may
   * carry the full text. Tried before any page an index lists.
   */
  pageUrl?: string | null;
}

/** GET a JSON document: the parsed body, `null` for "no such record", or a throw for "could not ask". */
export type OpenAccessHttp = (url: string) => Promise<unknown>;

export interface OpenAccessLookup {
  candidates: OpenAccessCandidate[];
  /** Sources that threw rather than answering. Empty when every source answered. */
  failed: OpenAccessSource[];
  /** The indexes that were actually asked — the rest had no id they answer to. */
  asked: OpenAccessSource[];
}

/** Europe PMC's answer: its candidates and the PMCID it names. */
export interface EuropePmcAnswer {
  candidates: OpenAccessCandidate[];
  pmcid?: string;
}

export interface OpenAccessOptions {
  http: OpenAccessHttp;
  /**
   * Unpaywall asks every caller for a contact address. Without one the
   * Unpaywall step is skipped rather than sent with a made-up address.
   */
  unpaywallEmail?: string | null;
  /** The user's OpenAlex key: their own daily budget instead of the shared keyless one. */
  openAlexKey?: string | null;
  /** Limit the sources asked, e.g. in tests. Defaults to all of them. */
  sources?: readonly OpenAccessSource[];
}

// ---------------------------------------------------------------------------
// The chain.

type Step = (ctx: {
  doi?: string;
  arxivId?: string;
  pmcid?: string;
  http: OpenAccessHttp;
  unpaywallEmail?: string;
  openAlexKey?: string;
}) => Promise<OpenAccessCandidate[]>;

const STEPS: Record<Exclude<OpenAccessSource, "paper">, Step> = {
  arxiv: async ({ arxivId }) => (arxivId ? rust().arxivCandidates(arxivId) : []),
  openalex: async ({ doi, http, openAlexKey }) => {
    if (!doi) return [];
    const key = openAlexKey ? `?api_key=${encodeURIComponent(openAlexKey)}` : "";
    return rust().parseOpenalex(await http(`https://api.openalex.org/works/doi:${encodeURIComponent(doi)}${key}`));
  },
  unpaywall: async ({ doi, http, unpaywallEmail }) =>
    doi && unpaywallEmail
      ? rust().parseUnpaywall(await http(`https://api.unpaywall.org/v2/${encodeURIComponent(doi)}?email=${encodeURIComponent(unpaywallEmail)}`))
      : [],
  "semantic-scholar": async ({ doi, arxivId, http }) => {
    const key = doi ? `DOI:${doi}` : arxivId ? `ARXIV:${arxivId.replace(/v\d+$/, "")}` : null;
    if (!key) return [];
    return rust().parseSemanticScholar(
      await http(`https://api.semanticscholar.org/graph/v1/paper/${encodeURIComponent(key)}?fields=openAccessPdf`),
    );
  },
  "europe-pmc": async ({ doi, pmcid, http }) => {
    const query = pmcid ? `PMCID:${pmcid}` : doi ? `DOI:"${doi}"` : null;
    if (!query) return [];
    const parsed = rust().parseEuropePmc(
      await http(
        `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(query)}&resultType=core&format=json&pageSize=1`,
      ),
    );
    return parsed.candidates;
  },
  biorxiv: async ({ doi, http }) => {
    const server = doi ? rust().preprintServerFor(doi) : undefined;
    if (!doi || !server) return [];
    // bioRxiv and medRxiv share the 10.1101 prefix; the API answers an empty
    // collection from the wrong server, so ask bioRxiv and then medRxiv.
    const bio = rust().parseBiorxiv(await http(`https://api.biorxiv.org/details/biorxiv/${doi}`), "biorxiv");
    if (bio.length) return bio;
    return rust().parseBiorxiv(await http(`https://api.biorxiv.org/details/medrxiv/${doi}`), "medrxiv");
  },
  doaj: async ({ doi, http }) =>
    doi ? rust().parseDoaj(await http(`https://doaj.org/api/search/articles/${encodeURIComponent(`doi:"${doi}"`)}`)) : [],
  zenodo: async ({ doi, http }) => {
    const id = doi ? rust().zenodoRecordId(doi) : undefined;
    return id ? rust().parseZenodo(await http(`https://zenodo.org/api/records/${id}`)) : [];
  },
  hal: async ({ doi, http }) =>
    doi
      ? rust().parseHal(
          await http(
            `https://api.archives-ouvertes.fr/search/?q=${encodeURIComponent(`doiId_s:"${doi}"`)}&fl=fileMain_s,linkExtUrl_s,licence_s&wt=json&rows=1`,
          ),
        )
      : [],
};

/**
 * Ask every applicable index at once and merge their answers.
 *
 * The indexes are independent, so they run in parallel; one being slow or
 * down costs only its own answer.
 */
export async function findOpenAccessCopies(ids: OpenAccessIds, options: OpenAccessOptions): Promise<OpenAccessLookup> {
  const doi = rust().normalizeDoi(ids.doi?.replace(/^doi:/i, "") ?? undefined) || undefined;
  const arxivId = rust().resolveArxivId(ids.arxivId ?? undefined, doi) ?? undefined;
  const pmcid = rust().cleanPmcid(ids.pmcid ?? undefined) ?? undefined;
  const wanted = new Set(options.sources ?? OPEN_ACCESS_SOURCES);
  const unpaywallEmail = options.unpaywallEmail?.trim() || undefined;
  const openAlexKey = options.openAlexKey?.trim() || undefined;

  const known = wanted.has("paper") ? rust().knownCandidates(ids.knownPdfUrl ?? undefined, ids.pageUrl ?? undefined) : [];
  const pmc = pmcid && wanted.has("europe-pmc") ? rust().pmcCandidates(pmcid) : [];

  const sources = (Object.keys(STEPS) as Exclude<OpenAccessSource, "paper">[]).filter((s) => wanted.has(s));
  const asked = new Set<OpenAccessSource>();
  const settled = await Promise.allSettled(
    sources.map((source) => {
      const http: OpenAccessHttp = (url) => {
        asked.add(source);
        return options.http(url);
      };
      return STEPS[source]({ doi, arxivId, pmcid, http, unpaywallEmail, openAlexKey });
    }),
  );
  const failed: OpenAccessSource[] = [];
  const found: OpenAccessCandidate[] = [];
  settled.forEach((result, i) => {
    if (result.status === "fulfilled") found.push(...result.value);
    else failed.push(sources[i]!);
  });
  return {
    candidates: rust().rankOpenAccessCandidates([...known, ...pmc, ...found]),
    failed,
    asked: sources.filter((s) => asked.has(s)),
  };
}

// --- push-paper-to-zotero.use-case ---
/**
 * What came of trying to put a paper into the user's bibliography manager.
 *
 * An outcome rather than a boolean, and rather than a throw, because "already
 * there" and "Zotero was unreachable" are different situations that a caller may
 * reasonably treat differently — and because the two copies of this rule that
 * preceded it disagreed about the failure in a way nobody had decided: one
 * wrapped the push in a `try`/`catch` and returned nothing, the other let the
 * error propagate out of a *confirmed* AI proposal, after the paper had already
 * been added.
 */
export type ZoteroPushOutcome = "pushed" | "already-linked" | "failed";

/**
 * Push a paper to the bibliography provider and remember the remote key.
 *
 * One rule, in core, because both dependencies are already core ports: the paper
 * repository to read the key and store it back, and the bibliography
 * integration to push. The rule was written twice — once in the papers facade's
 * `autoPush`, once as a callback in the composition root — and the copies had
 * already drifted.
 *
 * Best-effort by design. A paper with no item behind it in Zotero is a valid
 * state, not an error, so a library that refuses the push must not fail the
 * write that already happened: for the AI path the paper is added first, and
 * reporting "the proposal failed" after adding it would be the worst of both
 * answers. Failures are *reported* through the outcome instead of silently
 * swallowed, which is the part the facade's copy got wrong.
 */
export class PushPaperToZoteroUseCase {
  constructor(
    private readonly deps: {
      papers: Pick<IPaperRepository, "getById" | "save">;
      bibliography: Pick<IBibliographyIntegration, "pushPaper">;
    },
  ) {}

  async execute(paper: Paper): Promise<ZoteroPushOutcome> {
    // A stored key means this row already has an item behind it — pushed
    // earlier, or pulled from the library — and pushing again would duplicate it.
    if (paper.metadata?.zoteroKey) return "already-linked";

    let key: string | undefined;
    try {
      key = await this.deps.bibliography.pushPaper(paper);
    } catch {
      return "failed";
    }
    // The provider refuses a paper it cannot identify by returning nothing,
    // which is not an error either.
    if (!key) return "failed";

    // The push takes a network round trip, and the caller's object can be
    // older than the stored row (the form writes the summary, then pushes what
    // it held before). Store the key on the row as it is now, not on that copy.
    // A row deleted meanwhile stays deleted; the item in Zotero is still there.
    const fresh = await this.deps.papers.getById(paper.id);
    if (!fresh) return "pushed";
    await this.deps.papers.save({
      ...fresh,
      metadata: { ...fresh.metadata, zoteroKey: key },
    });
    return "pushed";
  }
}
