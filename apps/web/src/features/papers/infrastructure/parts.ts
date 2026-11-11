import { logToApp } from "@/lib/error-report/app-log";
import { describeRejection } from "@/lib/format-error";
import { loadCore, readyCore } from "@/lib/rust-core";
import {
  type IMetadataSource,
  type IProjectBibliographyCollectionStore,
  paperInputWithoutNulls,
  type PaperMetadata,
  type PaperRef,
} from "@weaveforge/core";
import type { CrossrefMessage } from "@weaveforge/wasm";

// --- arxiv-metadata-source ---
/**
 * arXiv metadata source. Implements the IMetadataSource contract so it can be
 * registered with the MetadataResolver without changing the resolver or the
 * import use-case (Open/Closed).
 *
 * Uses the public arXiv Atom API. The feed is parsed in Rust (`arxivEntryToMetadata`).
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
    // Accept an abs/pdf URL or an `arXiv:` prefixed string, not just a bare id.
    const core = await loadCore();
    const id = core.normalizeArxivId(ref.value) ?? ref.value.trim();
    const res = await this.fetchFn(`${this.baseUrl}?id_list=${encodeURIComponent(id)}`);
    if (!res.ok) {
      throw new Error(`arXiv request failed: ${res.status} ${res.statusText}`);
    }
    const xml = await res.text();
    return paperInputWithoutNulls(core.arxivEntryToMetadata(xml, id));
  }
}

// --- crossref-metadata-source ---
/**
 * Crossref metadata source (DOI). Implements IMetadataSource so it registers
 * with the MetadataResolver alongside arXiv without changing the resolver or
 * the import use-case (Open/Closed). Dependency-free (fetch + JSON).
 */

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
    const doi = (await loadCore()).extractDoi(ref.value) ?? readyCore().normalizeDoi(ref.value) ?? ref.value.trim();
    const res = await this.fetchFn(`${this.baseUrl}/${encodeURIComponent(doi)}`);
    if (!res.ok) {
      if (res.status === 404) {
        throw new Error(`DOI not found in Crossref: ${doi}`);
      }
      throw new Error(`Crossref request failed: ${res.status} ${res.statusText}`);
    }
    const body = (await res.json()) as { message?: CrossrefMessage };
    return paperInputWithoutNulls(readyCore().crossrefToMetadata(body.message ?? {}, doi));
  }
}

// --- zotero-collection ---
/**
 * The collection "read Zotero on this computer" imports: the same per-project
 * collection the cloud sync reads. `undefined` — no project, none chosen, or a
 * setting that cannot be read — means the whole library, a superset of it, so
 * a reader gets their papers rather than an error about a setting. The failed
 * read is logged, because the import then quietly takes more than was asked.
 */
export function localZoteroCollection(
  settings: Pick<IProjectBibliographyCollectionStore, "getCollection">,
  projectId: () => string | null | undefined,
): () => Promise<string | undefined> {
  return async () => {
    const id = projectId();
    if (!id) return undefined;
    try {
      return await settings.getCollection(id);
    } catch (err) {
      logToApp({
        level: "warn",
        source: "zotero",
        message: "Could not read the project's Zotero collection; importing the whole library",
        detail: `${id}: ${describeRejection(err)}`,
      });
      return undefined;
    }
  };
}
