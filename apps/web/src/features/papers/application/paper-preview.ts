/**
 * What the paper page shows in its preview frame, and where the frame leads.
 *
 * The preview comes from what is on this device: the first page of a saved
 * PDF, or the title and site of a saved web page. Either one opens in the
 * reader, so the frame and the "PDF" button link there even when the paper
 * has no web link to a PDF — a PDF the person added from disk, or a paper
 * that is only a web page.
 */
export type PaperPreview =
  | { kind: "loading" }
  | { kind: "pdf"; imageUrl: string }
  | { kind: "page"; title: string; site: string }
  | { kind: "none" };

/** The reader link for the paper, or null when there is nothing it could open. */
export function previewReaderHref(
  remoteHref: string | null,
  preview: PaperPreview,
  localHref: string,
): string | null {
  if (remoteHref) return remoteHref;
  return preview.kind === "pdf" || preview.kind === "page" ? localHref : null;
}

/** The host a saved page came from, without "www.", or the address as given. */
export function siteOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * Previews already made, by paper id, so a page drawn once is not drawn
 * again. Bounded: past `limit` the least recently used one is dropped and
 * its picture's object URL revoked, so browsing many papers does not keep
 * every first page in memory for the session.
 */
export class PreviewCache {
  private readonly entries = new Map<string, PaperPreview>();

  constructor(
    private readonly limit: number,
    private readonly revoke: (url: string) => void,
  ) {}

  get(paperId: string): PaperPreview | undefined {
    const hit = this.entries.get(paperId);
    if (hit) {
      this.entries.delete(paperId);
      this.entries.set(paperId, hit);
    }
    return hit;
  }

  /** Keep `preview`, or the one already kept for the paper; returns the kept one. */
  remember(paperId: string, preview: PaperPreview): PaperPreview {
    if (preview.kind === "none" || preview.kind === "loading") return preview;
    const known = this.get(paperId);
    if (known) {
      this.drop(preview);
      return known;
    }
    this.entries.set(paperId, preview);
    while (this.entries.size > this.limit) {
      const [oldest, dropped] = this.entries.entries().next().value!;
      this.entries.delete(oldest);
      this.drop(dropped);
    }
    return preview;
  }

  private drop(preview: PaperPreview): void {
    if (preview.kind === "pdf") this.revoke(preview.imageUrl);
  }
}
