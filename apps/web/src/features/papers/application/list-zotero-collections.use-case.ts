import type { ISettingsRepository } from "@weaveforge/core";
import type { ZoteroCollection } from "../domain/zotero";
import { zoteroHeaders, zoteroLibraryUrl } from "../infrastructure/zotero-web-api";

export class ListZoteroCollectionsUseCase {
  constructor(
    private readonly deps: {
      settings: ISettingsRepository;
      fetchFn?: typeof fetch;
    },
  ) {}

  async execute(): Promise<ZoteroCollection[]> {
    const s = await this.deps.settings.get();
    if (!s.zoteroApiKey || !s.zoteroLibrary) return [];
    const fetchFn = this.deps.fetchFn ?? fetch;
    const res = await fetchFn(`${zoteroLibraryUrl(s.zoteroLibrary)}/collections?limit=100`, {
      headers: zoteroHeaders(s.zoteroApiKey),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { data?: { key: string; name: string } }[];
    return data
      .map((c) => ({ key: c.data?.key ?? "", name: c.data?.name ?? "" }))
      .filter((c) => c.key);
  }
}
