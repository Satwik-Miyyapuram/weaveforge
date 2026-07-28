import type { ReaderAnnotation } from "@thesis/core";

export interface BatchImageRegion {
  annotationId: string;
  pageIndex: number;
  rect: number[];
  color: string;
}

/** Collect image-region annotations for bulk extract (rect only; rasterise later). */
export function collectAnnotationImageRegions(
  annotations: readonly ReaderAnnotation[],
): BatchImageRegion[] {
  const out: BatchImageRegion[] = [];
  for (const ann of annotations) {
    if (ann.type !== "image") continue;
    const pos = ann.anchor.zoteroPosition;
    if (!pos?.rects?.length) continue;
    for (const rect of pos.rects) {
      if (!Array.isArray(rect) || rect.length < 4) continue;
      out.push({
        annotationId: ann.id,
        pageIndex: pos.pageIndex,
        rect: rect.slice(0, 4),
        color: ann.color,
      });
    }
  }
  return out;
}

export interface SourceNoteBatchItem {
  paperId: string;
  title: string;
  action: "create" | "rerender";
}

/** Plan source-note generation / re-render for a paper list. */
export function planSourceNoteBatch(
  papers: readonly {
    id: string;
    title: string;
    hasSourceNote: boolean;
  }[],
  mode: "missing" | "all",
): SourceNoteBatchItem[] {
  return papers
    .filter((p) => (mode === "missing" ? !p.hasSourceNote : true))
    .map((p) => ({
      paperId: p.id,
      title: p.title,
      action: p.hasSourceNote ? "rerender" : "create",
    }));
}

export interface ActivityLogEntry {
  id: string;
  at: string;
  kind: string;
  message: string;
}

export function appendActivityLog(
  log: readonly ActivityLogEntry[],
  entry: Omit<ActivityLogEntry, "id" | "at"> & { id?: string; at?: string },
  cap = 100,
): ActivityLogEntry[] {
  const next: ActivityLogEntry = {
    id: entry.id ?? `act-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    at: entry.at ?? new Date().toISOString(),
    kind: entry.kind,
    message: entry.message,
  };
  return [next, ...log].slice(0, Math.max(1, cap));
}
