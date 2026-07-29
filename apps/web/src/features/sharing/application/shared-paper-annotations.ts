import type { ZoteroAnnotation } from "../../papers/domain/zotero.js";
import { projectZoteroAnnotations } from "../../reader/application/project-zotero-annotations.js";

/** Summarise Zotero-projected annotations for shared-paper view access. */
export function sharedPaperAnnotationSummary(metadata: Record<string, unknown> | undefined): {
  count: number;
  samples: string[];
} {
  const raw = (metadata?.["annotations"] as ZoteroAnnotation[] | undefined) ?? [];
  const projected = projectZoteroAnnotations(raw);
  return {
    count: projected.length,
    samples: projected
      .map((a) => (a.text || a.comment).trim())
      .filter(Boolean)
      .slice(0, 3),
  };
}
