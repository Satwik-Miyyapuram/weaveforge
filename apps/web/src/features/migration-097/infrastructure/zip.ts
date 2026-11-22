import { unzipSync, zipSync } from "fflate";
import type { FileSink } from "../domain/ports.ts";

/** Packs every file in the sink into one zip, keyed by its sink path. */
export async function zipFiles(sink: FileSink): Promise<Uint8Array> {
  const entries: Record<string, Uint8Array> = {};
  for (const path of await sink.list()) entries[path] = await sink.readBytes(path);
  return zipSync(entries);
}

/** Reads a zip made by zipFiles back into a path -> bytes map. */
export function unzipFiles(zip: Uint8Array): Map<string, Uint8Array> {
  return new Map(Object.entries(unzipSync(zip)));
}
