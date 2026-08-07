import type { Paper } from "@weaveforge/core";
import type {
  ZoteroCredentialsProvider,
} from "./zotero-metadata-source";
import { zoteroHeaders, zoteroLibraryUrl } from "./zotero-web-api";

/**
 * Pushes a paper directly from the unlocked browser to Zotero. The Thesis
 * Tracker server never receives the decrypted Zotero key or write payload.
 */
export class ZoteroExporter {
  constructor(
    private readonly credentials: ZoteroCredentialsProvider = async () => ({}),
    private readonly fetchFn: typeof fetch = (...args) => fetch(...args),
    private readonly apiOrigin = "https://api.zotero.org",
  ) {}

  /** Create the item in Zotero; returns the new Zotero item key. */
  async save(paper: Paper): Promise<string | undefined> {
    const creds = await this.credentials();
    if (!creds.apiKey || !creds.library) {
      throw new Error(
        "Zotero is not configured. Add your API key and library in Settings.",
      );
    }
    const item = toZoteroItem(paper);
    if (creds.collection) item.collections = [creds.collection];
    const res = await this.fetchFn(`${zoteroLibraryUrl(creds.library, this.apiOrigin)}/items`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...zoteroHeaders(creds.apiKey),
        "Zotero-Write-Token": crypto.randomUUID().replace(/-/g, ""),
      },
      body: JSON.stringify([item]),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Zotero save failed (${res.status}). ${detail}`.trim());
    }
    const result = (await res.json()) as {
      failed?: Record<string, unknown>;
      successful?: Record<string, { key?: string }>;
    };
    if (result.failed && Object.keys(result.failed).length > 0) {
      throw new Error(`Zotero rejected the item: ${JSON.stringify(result.failed)}`);
    }
    return result.successful?.["0"]?.key;
  }

  /** Delete the item from Zotero by its key. Best-effort (no-op if absent). */
  async remove(zoteroKey: string): Promise<void> {
    const creds = await this.credentials();
    if (!creds.apiKey || !creds.library) return; // not configured — nothing to do
    const res = await this.fetchFn(`${zoteroLibraryUrl(creds.library, this.apiOrigin)}/items/${encodeURIComponent(zoteroKey)}`, {
      method: "DELETE",
      headers: zoteroHeaders(creds.apiKey),
    });
    if (!res.ok && res.status !== 404 && res.status !== 412) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Zotero delete failed (${res.status}). ${detail}`.trim());
    }
  }
}

export function toZoteroItem(paper: Paper): Record<string, unknown> {
  const extra: string[] = [];
  if (paper.arxivId) extra.push(`arXiv:${paper.arxivId}`);

  return {
    itemType: "journalArticle",
    title: paper.title,
    creators: paper.authors.map((name) => splitCreator(name)),
    publicationTitle: paper.venue ?? "",
    date: paper.year ? String(paper.year) : "",
    DOI: paper.doi ?? "",
    url: paper.url ?? "",
    abstractNote: paper.abstract ?? paper.summary ?? "",
    extra: extra.join("\n"),
  };
}

function splitCreator(name: string): Record<string, string> {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) {
    return { creatorType: "author", name };
  }
  const lastName = parts.pop()!;
  return { creatorType: "author", firstName: parts.join(" "), lastName };
}
