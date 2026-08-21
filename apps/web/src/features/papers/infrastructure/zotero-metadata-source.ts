import type { IMetadataSource, PaperMetadata, PaperRef } from "@weaveforge/core";
import { zoteroHeaders, zoteroLibraryUrl } from "./zotero-web-api";

/**
 * Zotero metadata source. Resolves a Zotero item key to paper metadata via the
 * Zotero Web API. Implements IMetadataSource so it slots in beside arXiv and
 * Crossref (Open/Closed).
 *
 * Credentials are stored per-user (Settings page). This source reads them via
 * an injected provider and calls Zotero directly from the unlocked browser.
 * The WeaveForge server never receives the API key.
 */

interface ZoteroCredentials {
  apiKey?: string;
  library?: string;
  /** Per-project collection key — scopes sync push/pull to one collection. */
  collection?: string;
}

export type ZoteroCredentialsProvider = () => Promise<ZoteroCredentials>;

interface ZoteroCreator {
  firstName?: string;
  lastName?: string;
  name?: string;
}

/** Item types that describe a file or a comment about a paper, not a paper. */
const CHILD_ITEM_TYPES = new Set(["attachment", "note", "annotation"]);

interface ZoteroItemData {
  itemType?: string;
  /** Present on child items; the key of the bibliography entry they belong to. */
  parentItem?: string;
  title?: string;
  creators?: ZoteroCreator[];
  publicationTitle?: string;
  date?: string;
  DOI?: string;
  url?: string;
  abstractNote?: string;
  extra?: string;
}

export class ZoteroMetadataSource implements IMetadataSource {
  readonly id = "zotero";

  constructor(
    private readonly credentials: ZoteroCredentialsProvider = async () => ({}),
    private readonly fetchFn: typeof fetch = (...args) => fetch(...args),
    private readonly apiOrigin = "https://api.zotero.org",
  ) {}

  supports(ref: PaperRef): boolean {
    return ref.kind === "zotero";
  }

  async fetch(ref: PaperRef): Promise<PaperMetadata> {
    const key = ref.value.trim();
    const creds = await this.credentials();
    if (!creds.apiKey || !creds.library) {
      throw new Error(
        "Zotero is not configured. Add your API key and library in Settings.",
      );
    }
    const headers = zoteroHeaders(creds.apiKey);
    const libraryUrl = zoteroLibraryUrl(creds.library, this.apiOrigin);
    const data = await this.readItem(libraryUrl, headers, key);

    // A key copied out of Zotero often points at the PDF, not the paper: the
    // attachment is what the reader has selected. Its title is "SAGE PDF Full
    // Text", it carries no DOI and no creators, and imported as-is it becomes a
    // nameless row in the library. Follow the parent instead — one extra
    // request, and the entry that results is the bibliography entry.
    if (CHILD_ITEM_TYPES.has(data.itemType ?? "") || data.parentItem) {
      if (!data.parentItem) {
        throw new Error(
          `Zotero item ${key} is a ${data.itemType ?? "child item"} with no parent entry, so it has no paper metadata to import.`,
        );
      }
      return toMetadata(await this.readItem(libraryUrl, headers, data.parentItem));
    }
    return toMetadata(data);
  }

  private async readItem(
    libraryUrl: string,
    headers: Record<string, string>,
    key: string,
  ): Promise<ZoteroItemData> {
    const res = await this.fetchFn(`${libraryUrl}/items/${encodeURIComponent(key)}`, {
      headers,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Zotero request failed: ${res.status} ${detail}`.trim());
    }
    const body = (await res.json()) as { data?: ZoteroItemData };
    return body.data ?? {};
  }
}

function toMetadata(d: ZoteroItemData): PaperMetadata {
  const authors = (d.creators ?? [])
    .map((c) => c.name ?? [c.firstName, c.lastName].filter(Boolean).join(" "))
    .filter((x) => x.length > 0);
  const year = d.date ? Number(/\d{4}/.exec(d.date)?.[0]) || undefined : undefined;
  const arxivId = /arXiv:\s*([\w.\/-]+)/i.exec(d.extra ?? "")?.[1];
  return {
    title: d.title ?? "Untitled (Zotero)",
    authors,
    venue: d.publicationTitle,
    year,
    doi: d.DOI || undefined,
    arxivId,
    url: d.url,
    abstract: d.abstractNote?.replace(/\s+/g, " ").trim(),
  };
}
