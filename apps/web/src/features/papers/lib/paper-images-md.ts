import {
  imageExtensionForMime,
  markdownImage,
  normalizeMarkdownImageSyntax,
} from "@weaveforge/core";

/** Prefix embedded paper images use in markdown: `![](paperimg:userId/paperId/file.webp)`. */
export const PAPER_IMAGE_PREFIX = "paperimg:";

export function paperImageMarkdown(path: string, alt = "image"): string {
  return markdownImage(`${PAPER_IMAGE_PREFIX}${path}`, alt);
}

/** Collect unique paper image paths referenced in a note body. */
export function paperImagePathsInBody(body: string): string[] {
  const paths = new Set<string>();
  const normalized = normalizeMarkdownImageSyntax(body);
  const re = new RegExp(`!\\[[^\\]]*\\]\\(${PAPER_IMAGE_PREFIX}([^)\\s]+)\\)`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(normalized)) !== null) {
    paths.add(m[1]!);
  }
  return [...paths];
}


/** Upload any pasted `blob:` image refs and rewrite them to paperimg: paths before save. */
export async function materializePaperBlobImages(
  body: string,
  paperId: string,
  upload: (paperId: string, blob: Blob, ext: string) => Promise<string>,
): Promise<string> {
  const normalized = normalizeMarkdownImageSyntax(body);
  const re = /!\[([^\]]*)\]\((blob:[^)]+)\)/g;
  let result = normalized;
  for (const m of [...normalized.matchAll(re)]) {
    const alt = m[1] ?? "image";
    try {
      const res = await fetch(m[2]!);
      if (!res.ok) continue;
      const blob = await res.blob();
      result = result.replace(m[0], paperImageMarkdown(await upload(paperId, blob, imageExtensionForMime(blob.type)), alt));
    } catch {
      // Keep the original ref if the blob URL is stale.
    }
  }
  return result;
}
