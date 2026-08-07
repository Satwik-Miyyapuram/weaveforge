import { extractDoi, normalizeDoi, type IMetadataSource, type PaperMetadata, type PaperRef } from "@weaveforge/core";

/**
 * Crossref metadata source (DOI). Implements IMetadataSource so it registers
 * with the MetadataResolver alongside arXiv without changing the resolver or
 * the import use-case (Open/Closed). Dependency-free (fetch + JSON).
 */

interface CrossrefMessage {
  title?: string[];
  author?: { given?: string; family?: string; name?: string }[];
  "container-title"?: string[];
  issued?: { "date-parts"?: number[][] };
  DOI?: string;
  abstract?: string;
  URL?: string;
}

export class CrossrefMetadataSource implements IMetadataSource {
  readonly id = "crossref";

  constructor(
    private readonly fetchFn: typeof fetch = (...args) => fetch(...args),
    private readonly baseUrl = "https://api.crossref.org/works",
  ) {}

  supports(ref: PaperRef): boolean {
    return ref.kind === "doi";
  }

  async fetch(ref: PaperRef): Promise<PaperMetadata> {
    // Accept full URLs / "doi:" forms by normalizing to the bare DOI first.
    // `extractDoi` also pulls one out of a publisher URL (dl.acm.org/doi/10.x).
    const doi = extractDoi(ref.value) ?? normalizeDoi(ref.value) ?? ref.value.trim();
    const res = await this.fetchFn(`${this.baseUrl}/${encodeURIComponent(doi)}`);
    if (!res.ok) {
      if (res.status === 404) {
        throw new Error(`DOI not found in Crossref: ${doi}`);
      }
      throw new Error(`Crossref request failed: ${res.status} ${res.statusText}`);
    }
    const body = (await res.json()) as { message?: CrossrefMessage };
    return toMetadata(body.message ?? {}, doi);
  }
}

function toMetadata(m: CrossrefMessage, doi: string): PaperMetadata {
  const authors = (m.author ?? [])
    .map((a) => a.name ?? [a.given, a.family].filter(Boolean).join(" "))
    .filter((x) => x.length > 0);
  const year = m.issued?.["date-parts"]?.[0]?.[0];
  return {
    title: m.title?.[0]?.replace(/\s+/g, " ") ?? doi,
    authors,
    venue: m["container-title"]?.[0],
    year,
    doi: m.DOI ?? doi,
    abstract: m.abstract?.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim(),
    url: m.URL ?? `https://doi.org/${doi}`,
  };
}
