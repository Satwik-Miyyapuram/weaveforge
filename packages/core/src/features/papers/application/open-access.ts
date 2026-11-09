import { rust } from "../../../shared/rust.js";
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

/** The DOI's registrant decides which preprint server owns it. */
function preprintServerFor(doi: string): "biorxiv" | "medrxiv" | null {
  return /^10\.1101\/[\w.-]+$/.test(doi) ? "biorxiv" : null;
}

function zenodoRecordId(doi: string): string | undefined {
  return doi.match(/^10\.5281\/zenodo\.(\d+)$/i)?.[1];
}

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
    const server = doi ? preprintServerFor(doi) : null;
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
    const id = doi ? zenodoRecordId(doi) : undefined;
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
