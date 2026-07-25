import { normalizeMarkdownImageSyntax } from "@thesis/core";

/** Prefix for report section images: `![](reportimg:userId/sectionId/file.webp)`. */
export const REPORT_IMAGE_PREFIX = "reportimg:";

function escapeMarkdownAltText(alt: string): string {
  const s = alt
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return "image";
  return s
    .replace(/\\/g, "\\\\")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]");
}

export function reportImageMarkdown(path: string, alt = "image"): string {
  return `![${escapeMarkdownAltText(alt)}](${REPORT_IMAGE_PREFIX}${path})`;
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

function extFromMime(mime: string): string {
  if (mime === "image/jpeg") return "jpeg";
  if (mime === "image/webp") return "webp";
  if (mime === "image/gif") return "gif";
  if (mime === "image/svg+xml") return "svg";
  return "png";
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
        reportImageMarkdown(await upload(sectionId, blob, extFromMime(blob.type)), alt),
      );
    } catch {
      /* keep original if blob URL is stale */
    }
  }
  return result;
}
