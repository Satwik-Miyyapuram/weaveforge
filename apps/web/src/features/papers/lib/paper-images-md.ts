import { normalizeMarkdownImageSyntax } from "@weaveforge/core";

/** Prefix embedded paper images use in markdown: `![](paperimg:userId/paperId/file.webp)`. */
export const PAPER_IMAGE_PREFIX = "paperimg:";

function escapeMarkdownAltText(alt: string): string {
  const s = alt
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return "image";
  // Keep the alt text inside a single [...] without breaking markdown.
  return s
    .replace(/\\/g, "\\\\")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]");
}

export function paperImageMarkdown(path: string, alt = "image"): string {
  return `![${escapeMarkdownAltText(alt)}](${PAPER_IMAGE_PREFIX}${path})`;
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

function extFromMime(mime: string): string {
  if (mime === "image/jpeg") return "jpeg";
  if (mime === "image/webp") return "webp";
  if (mime === "image/gif") return "gif";
  if (mime === "image/svg+xml") return "svg";
  return "png";
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
      result = result.replace(m[0], paperImageMarkdown(await upload(paperId, blob, extFromMime(blob.type)), alt));
    } catch {
      // Keep the original ref if the blob URL is stale.
    }
  }
  return result;
}
