/**
 * R6 format reach — types and stubs. Full EPUB/HTML readers and mobile are
 * deferred pending product prioritisation; these ports keep the anchor model ready.
 */

/** EPUB Content Fragment Identifier (epubcfi) locator. */
export interface EpubCfiLocus {
  type: "EpubCfiSelector";
  cfi: string;
}

export interface CombinedEpubAnchor {
  contentHash?: string;
  cfi?: EpubCfiLocus;
  /** Quote fallback when the spine repaginates. */
  quote?: string;
}

export function isEpubCfiLocus(value: unknown): value is EpubCfiLocus {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return v.type === "EpubCfiSelector" && typeof v.cfi === "string" && v.cfi.trim().length > 0;
}

export function parseEpubCfi(raw: string): EpubCfiLocus | null {
  const cfi = raw.trim();
  if (!cfi.startsWith("epubcfi(") || !cfi.endsWith(")")) return null;
  return { type: "EpubCfiSelector", cfi };
}

/** HTML snapshot reading — URL + optional CSS selector range. */
export interface HtmlSnapshotLocus {
  type: "HtmlSnapshotSelector";
  url: string;
  cssSelector?: string;
  exact?: string;
}

export function buildHtmlSnapshotLocus(input: {
  url: string;
  cssSelector?: string;
  exact?: string;
}): HtmlSnapshotLocus | null {
  const url = input.url.trim();
  if (!/^https:\/\//i.test(url)) return null;
  return {
    type: "HtmlSnapshotSelector",
    url,
    ...(input.cssSelector?.trim() ? { cssSelector: input.cssSelector.trim() } : {}),
    ...(input.exact?.trim() ? { exact: input.exact.trim() } : {}),
  };
}

/** Opt-in paper-pdfs bucket policy stub (ladder step 6). */
export interface PaperPdfBucketPolicy {
  enabled: boolean;
  quotaBytes: number;
  tierEviction: boolean;
}

export const DEFAULT_PAPER_PDF_BUCKET_POLICY: PaperPdfBucketPolicy = {
  enabled: false,
  quotaBytes: 0,
  tierEviction: false,
};

export function paperPdfBucketAllowsUpload(
  policy: PaperPdfBucketPolicy,
  usedBytes: number,
  incomingBytes: number,
): boolean {
  if (!policy.enabled) return false;
  if (policy.quotaBytes <= 0) return false;
  return usedBytes + incomingBytes <= policy.quotaBytes;
}

/** Honest deferral registry for R6 items not shipping unsupervised. */
export const R6_DEFERRALS = [
  {
    id: "epub-reader-ui",
    reason: "epub.js UI shell deferred; CFI anchor types land first.",
  },
  {
    id: "html-snapshot-ui",
    reason: "HTML snapshot viewer deferred; locus builder lands first.",
  },
  {
    id: "mobile-reader",
    reason: "Gated on memory measurement in the old pdf-viewer plan §10.",
  },
  {
    id: "offline-cached-reading",
    reason: "IndexedDB byte cache exists; full offline shell deferred.",
  },
  {
    id: "linked-attachment-base-dir",
    reason: "Desktop path mapping needs a native host; not available in web.",
  },
] as const;
