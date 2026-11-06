import { figureLabel } from "./figure-label";

export interface ArtifactItem {
  url: string;
  label: string;
}

/** An entry with nothing to show: saved on the desktop app only, or missing or refused. */
export interface MissingArtifact {
  label: string;
  reason: "desktop" | "missing";
}

const IMAGE = /\.(png|jpe?g|webp|gif|svg|avif)$/;
const PDF = /\.pdf$/;
const LOCAL_PREFIX = "app://artifacts/";

function pathOf(entry: string): string {
  try {
    return new URL(entry).pathname.toLowerCase();
  } catch {
    return (entry.split("?")[0] ?? "").toLowerCase();
  }
}

function isImage(entry: string): boolean {
  if (entry.startsWith("data:")) return entry.startsWith("data:image/");
  return IMAGE.test(pathOf(entry));
}

function isPdf(entry: string): boolean {
  if (entry.startsWith("data:")) return entry.startsWith("data:application/pdf");
  return PDF.test(pathOf(entry));
}

function isAbsolute(entry: string): boolean {
  return entry.startsWith(LOCAL_PREFIX) || /^https?:\/\//i.test(entry) || entry.startsWith("data:");
}

/**
 * Pair each stored entry with the URL it resolved to, split into figures,
 * PDFs and links. Kind and name come from the entry: a signed URL may not
 * carry the filename (tiered storage serves `/api/blobs/content?t=…`).
 *
 * An entry with no URL is left out while it may still be signing. It counts as
 * missing once `settled` (signing finished or failed), or at once for an
 * absolute entry, which never signs. An `app://artifacts/` entry outside the
 * desktop shell is a file kept on that computer only.
 */
export function artifactItems(
  entries: readonly string[],
  urls: readonly (string | null)[],
  { settled = false, inShell = true }: { settled?: boolean; inShell?: boolean } = {},
): { images: ArtifactItem[]; pdfs: ArtifactItem[]; links: ArtifactItem[]; missing: MissingArtifact[] } {
  const images: ArtifactItem[] = [];
  const pdfs: ArtifactItem[] = [];
  const links: ArtifactItem[] = [];
  const missing: MissingArtifact[] = [];
  entries.forEach((entry, i) => {
    if (!inShell && entry.startsWith(LOCAL_PREFIX)) {
      missing.push({ label: figureLabel(entry, missing.length), reason: "desktop" });
      return;
    }
    const url = urls[i];
    if (!url) {
      if (settled || isAbsolute(entry)) missing.push({ label: figureLabel(entry, missing.length), reason: "missing" });
      return;
    }
    const group = isImage(entry) ? images : isPdf(entry) ? pdfs : links;
    group.push({ url, label: figureLabel(entry, group.length) });
  });
  return { images, pdfs, links, missing };
}
