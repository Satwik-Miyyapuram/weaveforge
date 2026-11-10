import { readyCore } from "@/lib/rust-core";

/** Summarise Zotero-projected annotations for shared-paper view access. */
export function sharedPaperAnnotationSummary(metadata: Record<string, unknown> | undefined): {
  count: number;
  samples: string[];
} {
  return readyCore().sharedPaperAnnotationSummary(metadata);
}
