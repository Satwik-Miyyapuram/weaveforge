import { figureLabel } from "./figure-label";

export interface ArtifactItem {
  url: string;
  label: string;
}

const IMAGE = /\.(png|jpe?g|webp|gif|svg|avif)$/;

function isImage(entry: string): boolean {
  if (entry.startsWith("data:")) return entry.startsWith("data:image/");
  try {
    return IMAGE.test(new URL(entry).pathname.toLowerCase());
  } catch {
    return IMAGE.test((entry.split("?")[0] ?? "").toLowerCase());
  }
}

/**
 * Pair each stored entry with the URL it resolved to, split into figures and
 * links. Kind and name come from the entry: a signed URL may not carry the
 * filename (tiered storage serves `/api/blobs/content?t=…`). Entries with no
 * URL yet are left out.
 */
export function artifactItems(
  entries: readonly string[],
  urls: readonly (string | null)[],
): { images: ArtifactItem[]; links: ArtifactItem[] } {
  const images: ArtifactItem[] = [];
  const links: ArtifactItem[] = [];
  entries.forEach((entry, i) => {
    const url = urls[i];
    if (!url) return;
    const group = isImage(entry) ? images : links;
    group.push({ url, label: figureLabel(entry, group.length) });
  });
  return { images, links };
}
