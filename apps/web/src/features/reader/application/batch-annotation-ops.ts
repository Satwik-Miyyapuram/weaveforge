export interface BatchImageRegion {
  annotationId: string;
  pageIndex: number;
  rect: number[];
  color: string;
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
