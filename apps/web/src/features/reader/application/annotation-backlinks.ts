import type { AnnotationPin, ReaderAnnotation } from "@weaveforge/core";

export interface AnnotationBacklinkTarget {
  kind: "report_section" | "vault_page";
  id: string;
  title: string;
}

export interface AnnotationBacklinkHit {
  annotationId: string;
  annotationKey: string;
  targets: AnnotationBacklinkTarget[];
}

/**
 * Build reverse links from annotations → report sections (via pins) and vault
 * pages (via body text containing the annotation key or quoted text).
 */
export function findAnnotationBacklinks(input: {
  annotations: readonly Pick<ReaderAnnotation, "id" | "zoteroKey" | "text">[];
  pins: readonly Pick<AnnotationPin, "annotationKey" | "reportSectionId" | "paperId">[];
  sections: readonly { id: string; title: string }[];
  vaultPages: readonly { id: string; title: string; body: string }[];
}): AnnotationBacklinkHit[] {
  const sectionById = new Map(input.sections.map((s) => [s.id, s]));
  const pinsByKey = new Map<string, string[]>();
  for (const pin of input.pins) {
    const list = pinsByKey.get(pin.annotationKey) ?? [];
    list.push(pin.reportSectionId);
    pinsByKey.set(pin.annotationKey, list);
  }

  const hits: AnnotationBacklinkHit[] = [];
  for (const ann of input.annotations) {
    const key = ann.zoteroKey?.trim() || ann.id;
    const targets: AnnotationBacklinkTarget[] = [];
    const seen = new Set<string>();

    for (const sectionId of pinsByKey.get(key) ?? []) {
      const section = sectionById.get(sectionId);
      if (!section || seen.has(`section:${section.id}`)) continue;
      seen.add(`section:${section.id}`);
      targets.push({ kind: "report_section", id: section.id, title: section.title });
    }

    const quote = ann.text.trim();
    for (const page of input.vaultPages) {
      const body = page.body ?? "";
      const mentionsKey = body.includes(key);
      const mentionsQuote = quote.length >= 12 && body.includes(quote);
      if (!mentionsKey && !mentionsQuote) continue;
      if (seen.has(`vault:${page.id}`)) continue;
      seen.add(`vault:${page.id}`);
      targets.push({ kind: "vault_page", id: page.id, title: page.title });
    }

    if (targets.length) {
      hits.push({ annotationId: ann.id, annotationKey: key, targets });
    }
  }
  return hits;
}

export function backlinksForAnnotation(
  hits: readonly AnnotationBacklinkHit[],
  annotationId: string,
): AnnotationBacklinkTarget[] {
  return hits.find((h) => h.annotationId === annotationId)?.targets ?? [];
}
