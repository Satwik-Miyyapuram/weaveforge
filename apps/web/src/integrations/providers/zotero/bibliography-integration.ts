import { extractHashtags, type IPaperRepository, type ManageTagsUseCase } from "@weaveforge/core";
import { appendTagHashtags, reconcileTagsFromBody } from "@/features/papers/lib/note-tags";
import type {
  BibliographyAnnotation,
  BibliographyCredentials,
  IBibliographyIntegration,
} from "@weaveforge/core";
import type { IZoteroLibrarySync, IZoteroExporter, IZoteroAnnotationPull } from "@/features/papers/domain/zotero";
import type { ISettingsRepository } from "@weaveforge/core";
import { getUserIntegrationField } from "@weaveforge/core";
import { zoteroHeaders, zoteroLibraryUrl } from "@/features/papers/infrastructure/zotero-web-api";
import { getSupabase } from "@/lib/supabase";

/**
 * Zotero's own settings page shows a bare user id ("123456"), so that is what
 * people paste. The API needs a library *path*. The collections route already
 * accepts either; do the same here so a direct-fetch build behaves identically.
 */
function normalizeZoteroLibrary(library: string | undefined): string | undefined {
  const value = library?.trim();
  if (!value) return undefined;
  if (/^\d+$/.test(value)) return `users/${value}`;
  return /^(users|groups)\/\d+$/.test(value) ? value : undefined;
}

export class ZoteroBibliographyIntegration implements IBibliographyIntegration {
  readonly providerId = "zotero";

  constructor(
    private readonly deps: {
      librarySync: IZoteroLibrarySync;
      exporter: IZoteroExporter;
      annotations: IZoteroAnnotationPull;
      papers: IPaperRepository;
      tags: ManageTagsUseCase;
      settings: ISettingsRepository;
      fetchFn?: typeof fetch;
    },
  ) {}

  async syncLibrary() {
    return this.deps.librarySync.sync();
  }

  async pullAnnotations(): Promise<Map<string, BibliographyAnnotation[]>> {
    return this.deps.annotations.pullAll();
  }

  async pushPaper(paper: import("@weaveforge/core").Paper) {
    return this.deps.exporter.save(paper);
  }

  async removeRemotePaper(remoteKey: string) {
    await this.deps.exporter.remove(remoteKey);
  }

  async listCollections(credentials?: BibliographyCredentials) {
    // Prefer what the user has typed over what was last saved, so the picker
    // fills in while the connection dialog is still open.
    const typedKey = credentials?.["apiKey"]?.trim();
    const typedLibrary = credentials?.["library"]?.trim();
    let apiKey = typedKey;
    let library = typedLibrary;
    if (!apiKey || !library) {
      const s = await this.deps.settings.get();
      apiKey = apiKey || getUserIntegrationField(s, "zotero", "apiKey");
      library = library || getUserIntegrationField(s, "zotero", "library");
    }
    library = normalizeZoteroLibrary(library);
    if (!apiKey || !library) return [];
    if (!this.deps.fetchFn) {
      const { data: sessionData } = await getSupabase().auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) return [];
      const res = await fetch("/api/integrations/zotero/collections", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey, library }),
        cache: "no-store",
      });
      if (!res.ok) return [];
      const payload = (await res.json()) as { collections?: { key: string; name: string }[] };
      return payload.collections ?? [];
    }

    const res = await this.deps.fetchFn(`${zoteroLibraryUrl(library)}/collections?limit=100`, {
      headers: zoteroHeaders(apiKey),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { data?: { key: string; name: string } }[];
    return data
      .map((c) => ({ key: c.data?.key ?? "", name: c.data?.name ?? "" }))
      .filter((c) => c.key);
  }
}

/** Merge pulled annotations into local papers + tag index. */
export async function applyBibliographyAnnotations(
  byPaper: Map<string, BibliographyAnnotation[]>,
  papers: import("@weaveforge/core").IPaperRepository,
  tags: ManageTagsUseCase,
): Promise<number> {
  const all = await papers.list();
  let synced = 0;
  for (const p of all) {
    const zk = p.metadata?.["zoteroKey"] as string | undefined;
    const anns = zk ? byPaper.get(zk) : undefined;
    if (!anns?.length) continue;
    // Tags live in the note body as #hashtags — append any Zotero tags (and the
    // hashtags inside annotation comments/text) to the bottom of the summary,
    // then reconcile the paper's tag index from the body.
    const tagNames = anns.filter((a) => a.kind !== "note").flatMap((a) => [
      ...a.tags,
      ...extractHashtags(a.comment),
      ...extractHashtags(a.text),
    ]);
    const newSummary = appendTagHashtags(p.summary ?? "", tagNames);
    await papers.save({
      ...p,
      summary: newSummary || undefined,
      metadata: { ...p.metadata, annotations: anns },
    });
    await reconcileTagsFromBody(tags, p.id, newSummary);
    synced += anns.length;
  }
  return synced;
}
