import { readyCore } from "@/lib/rust-core";

export interface ArtifactItem {
  url: string;
  label: string;
}

/** An entry with nothing to show: saved on the desktop app only, or missing or refused. */
export interface MissingArtifact {
  label: string;
  reason: "desktop" | "missing";
}

const LOCAL_PREFIX = "app://artifacts/";

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
      missing.push({ label: readyCore().figureLabel(entry, missing.length), reason: "desktop" });
      return;
    }
    const url = urls[i];
    if (!url) {
      if (settled || readyCore().isAbsoluteEntry(entry)) missing.push({ label: readyCore().figureLabel(entry, missing.length), reason: "missing" });
      return;
    }
    const kind = readyCore().artifactKind(entry);
    const group = kind === "image" ? images : kind === "pdf" ? pdfs : links;
    group.push({ url, label: readyCore().figureLabel(entry, group.length) });
  });
  return { images, pdfs, links, missing };
}
