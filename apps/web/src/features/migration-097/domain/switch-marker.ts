/** Written after a verified switch to OPFS files. Its presence means this browser opens files directly. */
export const SWITCH_MARKER_PATH = ".weaveforge/migration-0.9.8/switched.json";

export interface SwitchMarker {
  switchedAt: string;
  deviceId: string | null;
}

/** The sink surface the marker needs: text in, text out. */
export interface MarkerSink {
  write(path: string, data: string): Promise<void>;
  readText(path: string): Promise<string>;
}

/**
 * Reads the marker. Missing, unreadable, unparseable or incomplete markers all read as null,
 * so a damaged marker never locks a browser out of the server backend.
 */
export async function readSwitchMarker(sink: MarkerSink): Promise<SwitchMarker | null> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await sink.readText(SWITCH_MARKER_PATH));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const { switchedAt, deviceId } = parsed as Partial<SwitchMarker>;
  if (typeof switchedAt !== "string") return null;
  return { switchedAt, deviceId: typeof deviceId === "string" ? deviceId : null };
}

export async function writeSwitchMarker(sink: MarkerSink, marker: SwitchMarker): Promise<void> {
  await sink.write(SWITCH_MARKER_PATH, JSON.stringify(marker));
}
