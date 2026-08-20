import {
  imageExtensionForMime,
  normalizeMarkdownImageSyntax,
  vaultImageMarkdown,
} from "@weaveforge/core";


/** Upload blob: image refs in markdown and replace them with vault: paths before save. */
export async function materializeBlobImagesInBody(
  body: string,
  pageId: string,
  upload: (pageId: string, blob: Blob, ext: string) => Promise<string>,
): Promise<string> {
  const normalized = normalizeMarkdownImageSyntax(body);
  const re = /!\[([^\]]*)\]\((blob:[^)]+)\)/g;
  let result = normalized;
  const matches = [...normalized.matchAll(re)];
  for (const m of matches) {
    const alt = m[1] ?? "image";
    const blobUrl = m[2]!;
    try {
      const res = await fetch(blobUrl);
      if (!res.ok) continue;
      const blob = await res.blob();
      const ext = imageExtensionForMime(blob.type);
      const path = await upload(pageId, blob, ext);
      result = result.replace(m[0], vaultImageMarkdown(path, alt));
    } catch {
      // Keep the original ref if the blob URL is stale or unreadable.
    }
  }
  return result;
}
