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
