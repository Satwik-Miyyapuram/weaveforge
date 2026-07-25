import type { IMetadataSource, PaperMetadata, PaperRef } from "@thesis/core";

/**
 * arXiv metadata source. Implements the IMetadataSource contract so it can be
 * registered with the MetadataResolver without changing the resolver or the
 * import use-case (Open/Closed).
 *
 * Uses the public arXiv Atom API. Kept dependency-free (DOMParser / regex) so
 * it runs in the browser and in Node.
 */
export class ArxivMetadataSource implements IMetadataSource {
  readonly id = "arxiv";

  constructor(
    // Wrap so `fetch` keeps its global `this` binding (a bare reference throws
    // "Illegal invocation" in the browser when called as a method).
    private readonly fetchFn: typeof fetch = (...args) => fetch(...args),
    private readonly baseUrl = "https://export.arxiv.org/api/query",
  ) {}

  supports(ref: PaperRef): boolean {
    return ref.kind === "arxiv";
  }

  async fetch(ref: PaperRef): Promise<PaperMetadata> {
    const id = ref.value.trim();
    const res = await this.fetchFn(`${this.baseUrl}?id_list=${encodeURIComponent(id)}`);
    if (!res.ok) {
      throw new Error(`arXiv request failed: ${res.status} ${res.statusText}`);
    }
    const xml = await res.text();
    return parseArxivEntry(xml, id);
  }
}

/** Minimal, dependency-free parse of the first <entry> in an arXiv Atom feed. */
export function parseArxivEntry(xml: string, arxivId: string): PaperMetadata {
  const entry = /<entry>([\s\S]*?)<\/entry>/.exec(xml)?.[1] ?? "";
  const pick = (tag: string) =>
    decode(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(entry)?.[1]?.trim());
  const authors = [...entry.matchAll(/<name>([\s\S]*?)<\/name>/g)]
    .map((m) => decode(m[1]?.trim()))
    .filter((x): x is string => Boolean(x));
  const published = pick("published");
  const year = published ? Number(published.slice(0, 4)) : undefined;

  const title = pick("title")?.replace(/\s+/g, " ");
  return {
    title: title ?? `arXiv:${arxivId}`,
    authors,
    abstract: pick("summary")?.replace(/\s+/g, " "),
    year,
    arxivId,
    url: `https://arxiv.org/abs/${arxivId}`,
  };
}

function decode(s?: string): string | undefined {
  if (!s) return undefined;
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
