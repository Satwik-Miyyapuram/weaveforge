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
 */

import { normalizeDoi } from "../domain/paper.js";

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

export interface OpenAccessOptions {
  http: OpenAccessHttp;
  /**
   * Unpaywall asks every caller for a contact address. Without one the
   * Unpaywall step is skipped rather than sent with a made-up address.
   */
  unpaywallEmail?: string | null;
  /** Limit the sources asked, e.g. in tests. Defaults to all of them. */
  sources?: readonly OpenAccessSource[];
}

// ---------------------------------------------------------------------------
// Small readers for untyped JSON. Every index can change its shape, so every
// field is checked rather than trusted.

type Json = Record<string, unknown>;

function obj(value: unknown): Json | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : null;
}

function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** An https URL without credentials, or undefined. `http:` is upgraded: every index here serves both. */
export function openAccessUrl(raw: unknown): string | undefined {
  const value = str(raw);
  if (!value) return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (url.protocol === "http:") url.protocol = "https:";
  if (url.protocol !== "https:" || url.username || url.password) return undefined;
  return url.toString();
}

function candidate(
  url: unknown,
  format: OpenAccessFormat,
  source: OpenAccessSource,
  extra: { license?: unknown; version?: unknown } = {},
): OpenAccessCandidate | null {
  const safe = openAccessUrl(url);
  if (!safe) return null;
  const license = str(extra.license);
  const version = str(extra.version);
  return { url: safe, format, source, ...(license ? { license } : {}), ...(version ? { version } : {}) };
}

function compact(list: readonly (OpenAccessCandidate | null)[]): OpenAccessCandidate[] {
  return list.filter((c): c is OpenAccessCandidate => c !== null);
}

/** A link that names a PDF: a `.pdf` file, or a `/pdf/` path as arXiv and many repositories use. */
function looksLikePdfUrl(url: string | undefined): boolean {
  return /\.pdf(?:$|[?#])|\/pdf\//i.test(url ?? "");
}

/** arXiv ids: new style `2101.00001` (with optional version) or old style `hep-th/9901001`. */
const ARXIV_ID = /^(?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[a-z]{2})?\/\d{7})(?:v\d+)?$/i;

export function cleanArxivId(raw: string | null | undefined): string | undefined {
  const value = raw?.trim().replace(/^arxiv:/i, "");
  return value && ARXIV_ID.test(value) ? value : undefined;
}

/** A DOI minted by arXiv (`10.48550/arXiv.2101.00001`) carries the arXiv id. */
function arxivIdFromDoi(doi: string | undefined): string | undefined {
  const match = doi?.match(/^10\.48550\/arxiv\.(.+)$/i);
  return cleanArxivId(match?.[1]);
}

export function cleanPmcid(raw: string | null | undefined): string | undefined {
  const value = raw?.trim().toUpperCase();
  if (!value) return undefined;
  const withPrefix = /^\d+$/.test(value) ? `PMC${value}` : value;
  return /^PMC\d+$/.test(withPrefix) ? withPrefix : undefined;
}

// ---------------------------------------------------------------------------
// Parsers: one per index, pure, so each can be tested against a saved answer.

export function arxivCandidates(arxivId: string): OpenAccessCandidate[] {
  const id = encodeURIComponent(arxivId).replace(/%2F/gi, "/");
  return compact([
    candidate(`https://arxiv.org/pdf/${id}`, "pdf", "arxiv", { version: "submittedVersion" }),
    // arXiv's own HTML rendering (from the TeX source). Not every paper has
    // one; a miss is a 404, which the fetch step treats like any other miss.
    candidate(`https://arxiv.org/html/${id}`, "html", "arxiv", { version: "submittedVersion" }),
  ]);
}

export function parseOpenAlex(body: unknown): OpenAccessCandidate[] {
  const work = obj(body);
  if (!work) return [];
  const best = obj(work["best_oa_location"]);
  const locations = [best, ...arr(work["locations"]).map(obj)].filter((l): l is Json => l !== null);
  const out: (OpenAccessCandidate | null)[] = [];
  for (const location of locations) {
    if (location["is_oa"] === false) continue;
    const extra = { license: location["license"], version: location["version"] };
    out.push(candidate(location["pdf_url"], "pdf", "openalex", extra));
    // A landing page is only a paper when the index says the location is open.
    if (location["is_oa"] === true) out.push(candidate(location["landing_page_url"], "html", "openalex", extra));
  }
  return compact(out);
}

export function parseUnpaywall(body: unknown): OpenAccessCandidate[] {
  const record = obj(body);
  if (!record) return [];
  const best = obj(record["best_oa_location"]);
  const locations = [best, ...arr(record["oa_locations"]).map(obj)].filter((l): l is Json => l !== null);
  const out: (OpenAccessCandidate | null)[] = [];
  for (const location of locations) {
    const extra = { license: location["license"], version: location["version"] };
    out.push(candidate(location["url_for_pdf"], "pdf", "unpaywall", extra));
    out.push(candidate(location["url_for_landing_page"], "html", "unpaywall", extra));
  }
  return compact(out);
}

export function parseSemanticScholar(body: unknown): OpenAccessCandidate[] {
  const paper = obj(body);
  const pdf = obj(paper?.["openAccessPdf"]);
  if (!pdf) return [];
  return compact([candidate(pdf["url"], "pdf", "semantic-scholar", { license: pdf["license"] })]);
}

/** Europe PMC's `search` answer, `resultType=core`. Also yields the PMCID for the PMC copies. */
export function parseEuropePmc(body: unknown): { candidates: OpenAccessCandidate[]; pmcid?: string } {
  const results = arr(obj(obj(body)?.["resultList"])?.["result"]).map(obj);
  const record = results.find((r) => r !== null) ?? null;
  if (!record) return { candidates: [] };
  const pmcid = cleanPmcid(str(record["pmcid"]));
  const license = record["license"];
  const out: (OpenAccessCandidate | null)[] = [];
  for (const entry of arr(obj(record["fullTextUrlList"])?.["fullTextUrl"]).map(obj)) {
    if (!entry) continue;
    // "OA" open access, "F" free to read. "S" (subscription) and "R" (registration) are not free.
    const availability = str(entry["availabilityCode"])?.toUpperCase();
    if (availability !== "OA" && availability !== "F") continue;
    const style = str(entry["documentStyle"])?.toLowerCase();
    const format: OpenAccessFormat | null = style === "pdf" ? "pdf" : style === "html" ? "html" : null;
    if (format) out.push(candidate(entry["url"], format, "europe-pmc", { license }));
  }
  if (pmcid && record["isOpenAccess"] === "Y") out.push(...pmcCandidates(pmcid, str(license)));
  return { candidates: compact(out), ...(pmcid ? { pmcid } : {}) };
}

/** PubMed Central's copies of an article, by PMCID. */
export function pmcCandidates(pmcid: string, license?: string): OpenAccessCandidate[] {
  return compact([
    candidate(`https://europepmc.org/articles/${pmcid}?pdf=render`, "pdf", "europe-pmc", { license }),
    candidate(`https://pmc.ncbi.nlm.nih.gov/articles/${pmcid}/`, "html", "europe-pmc", { license }),
  ]);
}

/** The bioRxiv/medRxiv `details` answer for one DOI. The newest version wins. */
export function parseBiorxiv(body: unknown, server: "biorxiv" | "medrxiv"): OpenAccessCandidate[] {
  const versions = arr(obj(body)?.["collection"]).map(obj).filter((v): v is Json => v !== null);
  const latest = versions[versions.length - 1];
  const doi = str(latest?.["doi"]);
  const version = str(latest?.["version"]) ?? (typeof latest?.["version"] === "number" ? String(latest["version"]) : undefined);
  if (!latest || !doi || !version || !/^\d+$/.test(version)) return [];
  const base = `https://www.${server}.org/content/${doi}v${version}`;
  const extra = { license: latest["license"], version: `v${version}` };
  return compact([
    candidate(`${base}.full.pdf`, "pdf", "biorxiv", extra),
    candidate(`${base}.full`, "html", "biorxiv", extra),
  ]);
}

export function parseDoaj(body: unknown): OpenAccessCandidate[] {
  const out: (OpenAccessCandidate | null)[] = [];
  for (const result of arr(obj(body)?.["results"]).map(obj)) {
    const bibjson = obj(result?.["bibjson"]);
    const license = arr(obj(bibjson?.["journal"])?.["license"]).map(obj)[0]?.["type"];
    for (const link of arr(bibjson?.["link"]).map(obj)) {
      if (!link || str(link["type"])?.toLowerCase() !== "fulltext") continue;
      const contentType = str(link["content_type"])?.toLowerCase() ?? "";
      const url = str(link["url"]);
      const format: OpenAccessFormat = contentType.includes("pdf") || looksLikePdfUrl(url) ? "pdf" : "html";
      out.push(candidate(url, format, "doaj", { license, version: "publishedVersion" }));
    }
  }
  return compact(out);
}

export function parseZenodo(body: unknown): OpenAccessCandidate[] {
  const record = obj(body);
  if (!record) return [];
  const metadata = obj(record["metadata"]);
  // A restricted or embargoed record lists files nobody can download.
  if (str(metadata?.["access_right"]) && str(metadata?.["access_right"]) !== "open") return [];
  const license = obj(metadata?.["license"])?.["id"] ?? metadata?.["license"];
  const out: (OpenAccessCandidate | null)[] = [];
  for (const file of arr(record["files"]).map(obj)) {
    const key = str(file?.["key"]) ?? "";
    if (!/\.pdf$/i.test(key)) continue;
    out.push(candidate(obj(file?.["links"])?.["self"], "pdf", "zenodo", { license }));
  }
  return compact(out);
}

export function parseHal(body: unknown): OpenAccessCandidate[] {
  const docs = arr(obj(obj(body)?.["response"])?.["docs"]).map(obj);
  const out: (OpenAccessCandidate | null)[] = [];
  for (const doc of docs) {
    if (!doc) continue;
    const license = doc["licence_s"];
    out.push(candidate(doc["fileMain_s"], "pdf", "hal", { license }));
    // A HAL record without a file of its own may still point at a free copy elsewhere.
    const external = str(doc["linkExtUrl_s"]);
    if (external) out.push(candidate(external, looksLikePdfUrl(external) ? "pdf" : "html", "hal", { license }));
  }
  return compact(out);
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
}) => Promise<OpenAccessCandidate[]>;

const STEPS: Record<Exclude<OpenAccessSource, "paper">, Step> = {
  arxiv: async ({ arxivId }) => (arxivId ? arxivCandidates(arxivId) : []),
  openalex: async ({ doi, http }) =>
    doi ? parseOpenAlex(await http(`https://api.openalex.org/works/doi:${encodeURIComponent(doi)}`)) : [],
  unpaywall: async ({ doi, http, unpaywallEmail }) =>
    doi && unpaywallEmail
      ? parseUnpaywall(await http(`https://api.unpaywall.org/v2/${encodeURIComponent(doi)}?email=${encodeURIComponent(unpaywallEmail)}`))
      : [],
  "semantic-scholar": async ({ doi, arxivId, http }) => {
    const key = doi ? `DOI:${doi}` : arxivId ? `ARXIV:${arxivId.replace(/v\d+$/, "")}` : null;
    if (!key) return [];
    return parseSemanticScholar(
      await http(`https://api.semanticscholar.org/graph/v1/paper/${encodeURIComponent(key)}?fields=openAccessPdf`),
    );
  },
  "europe-pmc": async ({ doi, pmcid, http }) => {
    const query = pmcid ? `PMCID:${pmcid}` : doi ? `DOI:"${doi}"` : null;
    if (!query) return [];
    const parsed = parseEuropePmc(
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
    const bio = parseBiorxiv(await http(`https://api.biorxiv.org/details/biorxiv/${doi}`), "biorxiv");
    if (bio.length) return bio;
    return parseBiorxiv(await http(`https://api.biorxiv.org/details/medrxiv/${doi}`), "medrxiv");
  },
  doaj: async ({ doi, http }) =>
    doi ? parseDoaj(await http(`https://doaj.org/api/search/articles/${encodeURIComponent(`doi:"${doi}"`)}`)) : [],
  zenodo: async ({ doi, http }) => {
    const id = doi ? zenodoRecordId(doi) : undefined;
    return id ? parseZenodo(await http(`https://zenodo.org/api/records/${id}`)) : [];
  },
  hal: async ({ doi, http }) =>
    doi
      ? parseHal(
          await http(
            `https://api.archives-ouvertes.fr/search/?q=${encodeURIComponent(`doiId_s:"${doi}"`)}&fl=fileMain_s,linkExtUrl_s,licence_s&wt=json&rows=1`,
          ),
        )
      : [],
};

/**
 * Deduplicate by URL (first mention wins, keeping the earlier source's
 * licence), then order PDFs before web pages, each in source order.
 */
export function rankOpenAccessCandidates(list: readonly OpenAccessCandidate[]): OpenAccessCandidate[] {
  const seen = new Set<string>();
  const unique: OpenAccessCandidate[] = [];
  for (const item of list) {
    const key = item.url.replace(/#.*$/, "");
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  const rank = (c: OpenAccessCandidate) =>
    (c.format === "pdf" ? 0 : 100) + OPEN_ACCESS_SOURCES.indexOf(c.source);
  return unique
    .map((c, i) => ({ c, i }))
    .sort((a, b) => rank(a.c) - rank(b.c) || a.i - b.i)
    .map(({ c }) => c);
}

/**
 * Ask every applicable index at once and merge their answers.
 *
 * The indexes are independent, so they run in parallel; one being slow or
 * down costs only its own answer.
 */
export async function findOpenAccessCopies(ids: OpenAccessIds, options: OpenAccessOptions): Promise<OpenAccessLookup> {
  const doi = normalizeDoi(ids.doi?.replace(/^doi:/i, "") ?? undefined) || undefined;
  const arxivId = cleanArxivId(ids.arxivId) ?? arxivIdFromDoi(doi);
  const pmcid = cleanPmcid(ids.pmcid);
  const wanted = new Set(options.sources ?? OPEN_ACCESS_SOURCES);
  const unpaywallEmail = options.unpaywallEmail?.trim() || undefined;

  const known = wanted.has("paper")
    ? compact([candidate(ids.knownPdfUrl, "pdf", "paper"), candidate(ids.pageUrl, "html", "paper")])
    : [];
  const pmc = pmcid && wanted.has("europe-pmc") ? pmcCandidates(pmcid) : [];

  const sources = (Object.keys(STEPS) as Exclude<OpenAccessSource, "paper">[]).filter((s) => wanted.has(s));
  const asked = new Set<OpenAccessSource>();
  const settled = await Promise.allSettled(
    sources.map((source) => {
      const http: OpenAccessHttp = (url) => {
        asked.add(source);
        return options.http(url);
      };
      return STEPS[source]({ doi, arxivId, pmcid, http, unpaywallEmail });
    }),
  );
  const failed: OpenAccessSource[] = [];
  const found: OpenAccessCandidate[] = [];
  settled.forEach((result, i) => {
    if (result.status === "fulfilled") found.push(...result.value);
    else failed.push(sources[i]!);
  });
  return {
    candidates: rankOpenAccessCandidates([...known, ...pmc, ...found]),
    failed,
    asked: sources.filter((s) => asked.has(s)),
  };
}
