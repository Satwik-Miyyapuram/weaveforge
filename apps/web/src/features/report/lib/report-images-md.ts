import {
  imageExtensionForMime,
  markdownImage,
  normalizeMarkdownImageSyntax,
} from "@weaveforge/core";

/** Prefix for report section images: `![](reportimg:userId/sectionId/file.webp)`. */
export const REPORT_IMAGE_PREFIX = "reportimg:";

export function reportImageMarkdown(path: string, alt = "image"): string {
  return markdownImage(`${REPORT_IMAGE_PREFIX}${path}`, alt);
}

/** Collect unique report image paths referenced in section notes. */
export function reportImagePathsInBody(body: string): string[] {
  const paths = new Set<string>();
  const normalized = normalizeMarkdownImageSyntax(body);
  const re = new RegExp(`!\\[[^\\]]*\\]\\(${REPORT_IMAGE_PREFIX}([^)\\s]+)\\)`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(normalized)) !== null) {
    paths.add(m[1]!);
  }
  return [...paths];
}


/** Upload pasted `blob:` image refs and rewrite them to reportimg: paths before save. */
export async function materializeReportBlobImages(
  body: string,
  sectionId: string,
  upload: (sectionId: string, blob: Blob, ext: string) => Promise<string>,
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
      result = result.replace(
        m[0],
        reportImageMarkdown(await upload(sectionId, blob, imageExtensionForMime(blob.type)), alt),
      );
    } catch {
      /* keep original if blob URL is stale */
    }
  }
  return result;
}
