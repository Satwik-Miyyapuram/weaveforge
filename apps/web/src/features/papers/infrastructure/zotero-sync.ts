import { normalizeDoi, type NewPaperInput, type Paper } from "@weaveforge/core";
import type { ZoteroSyncResult } from "../domain/zotero";
import type { ZoteroCredentialsProvider } from "./zotero-metadata-source";
import { toZoteroItem } from "./zotero-exporter";
import { fetchAllZoteroItems, zoteroHeaders, zoteroLibraryUrl, zoteroTopLevelPath } from "./zotero-web-api";

export type { ZoteroSyncResult } from "../domain/zotero";

/** Zotero item types that are children of a paper, never papers themselves. */
const CHILD_ITEM_TYPES = new Set(["attachment", "note", "annotation"]);

interface ZoteroCreator { firstName?: string; lastName?: string; name?: string }
interface ZoteroData {
  key?: string;
  /** Set when the item hangs off a parent — an attachment, note or annotation. */
  parentItem?: string;
  title?: string;
  creators?: ZoteroCreator[];
  publicationTitle?: string;
  date?: string;
  DOI?: string;
  url?: string;
  abstractNote?: string;
  extra?: string;
  itemType?: string;
  tags?: { tag?: string }[];
}

export interface ZoteroSyncDeps {
  credentials: ZoteroCredentialsProvider;
  listPapers: () => Promise<Paper[]>;
  addPaper: (input: NewPaperInput) => Promise<unknown>;
  /** Persist a paper (used to write back Zotero item keys after a push). */
  savePaper?: (paper: Paper) => Promise<void>;
  /** Delete a local paper (used when its Zotero item was deleted remotely). */
  deletePaper?: (id: string) => Promise<void>;
  /** After pull, sync Zotero item-level tags onto the local paper. */
  onItemTags?: (paper: Paper, remote: ZoteroData) => Promise<void>;
  fetchFn?: typeof fetch;
  baseUrl?: string;
}

export class ZoteroSync {
  private readonly fetchFn: typeof fetch;
  private readonly baseUrl: string;
  constructor(private readonly deps: ZoteroSyncDeps) {
    this.fetchFn = deps.fetchFn ?? ((...a) => fetch(...a));
    this.baseUrl = deps.baseUrl ?? "https://api.zotero.org";
  }

  async sync(): Promise<ZoteroSyncResult> {
    const creds = await this.deps.credentials();
    if (!creds.apiKey || !creds.library) {
      throw new Error("Zotero is not configured. Add your API key and library in Settings.");
    }
    const headers = zoteroHeaders(creds.apiKey);
    const libraryUrl = zoteroLibraryUrl(creds.library, this.baseUrl);
    const col = creds.collection;

    // --- pull side: read ALL remote items (paginated; scoped to the project's
    // collection). Reading only the first page would make items past the page
    // size look "missing" and get re-pushed every sync → duplicates. Pages
    // after the first go out together — see `fetchAllZoteroItems`. ---
    const remoteRaw = await fetchAllZoteroItems<{ data?: ZoteroData }>({
      baseUrl: libraryUrl,
      // Top-level items only. `/items` also returns attachments, notes and
      // annotations, and a Zotero PDF attachment is titled "Preprint PDF" or
      // "Full Text PDF" — which passed the `has a title` filter below, carried
      // no DOI or arXiv id, and so keyed on its own title and was imported as
      // though it were a paper. That is where the "Preprint PDF" entries in the
      // library came from.
      path: zoteroTopLevelPath(col),
      headers,
      fetchFn: this.fetchFn,
      label: "list",
    });
    const remote = remoteRaw
      .map((r) => r.data)
      .filter((d): d is ZoteroData => !!d && !!d.title)
      // Belt and braces: the endpoint should not return these, but importing a
      // child item as a paper is bad enough to be worth refusing twice. A
      // `parentItem` is the same statement from the other side — an item that
      // hangs off a paper is not one, whatever its `itemType` says.
      .filter((d) => !CHILD_ITEM_TYPES.has(d.itemType ?? "") && !d.parentItem);

    const local = await this.deps.listPapers();
    // Match if any content key overlaps. Each side emits its DOI + arXiv keys
    // (the same paper can carry a DOI on one side, an arXiv id on the other);
    // title is only a fallback key when a paper has neither id (see contentKeys).
    // So a paper with a DOI/arXiv will NOT match a remote item that has only a title.
    const remoteKeys = new Set(remote.flatMap(keysOfRemote));
    const localKeys = new Set(local.flatMap(keysOfLocal));
    // Zotero item keys still present remotely (for delete-propagation).
    const remoteItemKeys = new Set(remote.map((d) => d.key).filter(Boolean) as string[]);
    const hasRemoteMatch = (p: Paper) => keysOfLocal(p).some((k) => remoteKeys.has(k));

    // Reconcile in a safe order against this one remote snapshot: PULL first
    // (additive), then PUSH (additive), then DELETE (destructive) last.

    // --- pull: remote items not present locally (by any content key) ---
    //
    // The tag pass used to re-read the *entire* paper list inside this loop,
    // once per pulled item, to find the row it had just created — so pulling
    // 200 papers meant 200 full reads of a table that was growing as it went.
    // One read afterwards finds all of them.
    let pulled = 0;
    const pulledItems: ZoteroData[] = [];
    for (const d of remote) {
      const ks = keysOfRemote(d);
      if (ks.length === 0 || ks.some((k) => localKeys.has(k))) continue;
      await this.deps.addPaper(remoteToInput(d));
      ks.forEach((k) => localKeys.add(k));
      pulled += 1;
      if (this.deps.onItemTags && d.key) pulledItems.push(d);
    }

    if (pulledItems.length > 0 && this.deps.onItemTags) {
      const byZoteroKey = new Map<string, Paper>();
      for (const p of await this.deps.listPapers()) {
        const zk = p.metadata?.["zoteroKey"] as string | undefined;
        if (zk) byZoteroKey.set(zk, p);
      }
      for (const d of pulledItems) {
        const created = d.key ? byZoteroKey.get(d.key) : undefined;
        if (created) await this.deps.onItemTags(created, d);
      }
    }

    // --- push: local papers that have never been in Zotero. ---
    //
    // A stored `zoteroKey` means this row came from — or was already pushed to
    // — Zotero, so it is never a push candidate again. Pushing on "key exists
    // but is missing from the remote snapshot" is what re-seeded junk: rows
    // pulled from PDF attachments before the top-level fix carry an attachment
    // key, attachments are (correctly) absent from `/items/top`, and so every
    // sync exported "SAGE PDF Full Text" back to Zotero as a fresh top-level
    // item — which the next pull then imported as a genuine paper, immune to
    // every child-item filter. A key that is gone from the remote snapshot is a
    // delete to propagate, handled below; it is never a reason to push.
    const toPush = local.filter((p) => {
      if (p.metadata?.["zoteroKey"]) return false;
      return keysOfLocal(p).length > 0 && !hasRemoteMatch(p);
    });
    let pushed = 0;
    if (toPush.length) {
      const items = toPush.map((p) => {
        const it = toZoteroItem(p);
        if (col) it.collections = [col];
        return it;
      });
      const res = await this.fetchFn(`${libraryUrl}/items`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json", "Zotero-Write-Token": crypto.randomUUID().replace(/-/g, "") },
        body: JSON.stringify(items),
      });
      if (!res.ok) {
        const d = await res.text().catch(() => "");
        throw new Error(`Zotero push failed (${res.status}). ${d}`.trim());
      }
      const result = (await res.json()) as {
        successful?: Record<string, { key?: string }>;
      };
      const ok = result.successful ?? {};
      pushed = Object.keys(ok).length || toPush.length;
      // Write back the new Zotero keys so future deletes propagate.
      if (this.deps.savePaper) {
        for (const [idx, created] of Object.entries(ok)) {
          const paper = toPush[Number(idx)];
          if (paper && created?.key) {
            await this.deps.savePaper({
              ...paper,
              metadata: { ...paper.metadata, zoteroKey: created.key },
            });
          }
        }
      }
    }

    // --- delete-propagation: only remove a local paper when its Zotero item is
    // truly gone — its stored key is absent AND no remote item still matches it
    // by content. Skip entirely if the remote list came back empty, so a partial
    // or failed read can never mass-delete the library. ---
    let deletedLocal = 0;
    if (this.deps.deletePaper && remote.length > 0) {
      for (const p of local) {
        const zk = p.metadata?.["zoteroKey"] as string | undefined;
        if (zk && !remoteItemKeys.has(zk) && !hasRemoteMatch(p)) {
          await this.deps.deletePaper(p.id);
          deletedLocal += 1;
        }
      }
    }

    return { pushed, pulled, deletedLocal };
  }
}

/**
 * Content keys for a paper — match if ANY overlaps. Strong ids (doi, arxiv)
 * are preferred; title is only a fallback when neither exists, since different
 * papers can share a title. Whitespace-only ids/titles yield no key.
 */
function contentKeys(doi?: string, arxivId?: string, title?: string): string[] {
  const keys: string[] = [];
  const nd = normalizeDoi(doi);
  if (nd) {
    keys.push("doi:" + nd);
    // arXiv DataCite DOIs embed the id: 10.48550/arXiv.2103.03230
    const m = /^10\.48550\/arxiv\.(.+)$/i.exec(nd);
    if (m?.[1]) keys.push("arxiv:" + m[1].toLowerCase());
  }
  const ax = arxivId?.trim().toLowerCase();
  if (ax) keys.push("arxiv:" + ax);
  if (keys.length === 0) {
    const t = title?.trim().toLowerCase().replace(/\s+/g, " ");
    if (t) keys.push("title:" + t);
  }
  return keys;
}
function keysOfLocal(p: Paper): string[] {
  return contentKeys(p.doi, p.arxivId, p.title);
}
/**
 * arXiv id from a Zotero item: the `arXiv:<id>` tag in `extra`, else the id in
 * an arxiv.org/abs|pdf/<id> URL.
 */
function arxivOfRemote(d: ZoteroData): string | undefined {
  const url = d.url ?? "";
  return (
    /arXiv:\s*([\w.\/-]+)/i.exec(d.extra ?? "")?.[1]?.trim() ??
    /arXiv:\s*([\w.\/-]+)/i.exec(url)?.[1]?.trim() ??
    /arxiv\.org\/(?:abs|pdf)\/([\w.\/-]+?)(?:\.pdf)?(?:[?#].*)?$/i.exec(url)?.[1]?.trim()
  );
}
function keysOfRemote(d: ZoteroData): string[] {
  return contentKeys(d.DOI, arxivOfRemote(d), d.title);
}
function remoteToInput(d: ZoteroData): NewPaperInput {
  const authors = (d.creators ?? [])
    .map((c) => c.name ?? [c.firstName, c.lastName].filter(Boolean).join(" "))
    .filter((x) => x.length > 0);
  const year = d.date ? Number(/\d{4}/.exec(d.date)?.[0]) || undefined : undefined;
  const arxivId = arxivOfRemote(d);
  return {
    title: d.title ?? "Untitled (Zotero)",
    authors,
    venue: d.publicationTitle,
    year,
    doi: d.DOI || undefined,
    arxivId,
    url: d.url,
    abstract: d.abstractNote,
    metadata: d.key ? { zoteroKey: d.key } : undefined,
  };
}
