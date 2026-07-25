/** Browser-only Zotero Web API helpers. Keep decrypted credentials out of app routes. */
export const ZOTERO_API_ORIGIN = "https://api.zotero.org";

export function zoteroLibraryUrl(library: string, apiOrigin = ZOTERO_API_ORIGIN): string {
  return `${apiOrigin.replace(/\/$/, "")}/${library.replace(/^\//, "")}`;
}

export function zoteroHeaders(apiKey: string): Record<string, string> {
  return { "Zotero-API-Key": apiKey, "Zotero-API-Version": "3" };
}
