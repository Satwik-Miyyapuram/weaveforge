import type { IPaperRepository, ManageTagsUseCase } from "@weaveforge/core";
import type { Paper } from "@weaveforge/core";
import type {
  BibliographyAnnotationPull,
  BibliographyCredentials,
  IBibliographyIntegration,
} from "@weaveforge/core";
import type { IZoteroLibrarySync, IZoteroExporter, IZoteroAnnotationPull } from "@/features/papers/domain/zotero";
import type { ISettingsRepository } from "@weaveforge/core";
import { getUserIntegrationField } from "@weaveforge/core";
import { normalizeZoteroLibrary, zoteroHeaders, zoteroLibraryUrl } from "@/features/papers/infrastructure/zotero-web-api";
import { getDataClient } from "@/lib/data-client";

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

  async pullAnnotations(): Promise<BibliographyAnnotationPull> {
    return this.deps.annotations.pull();
  }

  async pushPaper(paper: Paper) {
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
      const { data: sessionData } = await getDataClient().auth.getSession();
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
