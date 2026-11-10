/**
 * Browser-side calls to the desktop app's live Overleaf routes (`live/*`), which
 * hold the editing connection to Overleaf. Pure: fetch and the bearer header are
 * injected. Every failure is a message, never a throw.
 */
import type { TextComponent } from "@weaveforge/wasm";
import { post, type WorkshopClientDeps } from "./workshop-session-client";
import { readyCore } from "@/lib/rust-core";

export const WORKSHOP_LIVE_PATH = "/api/overleaf/workshop/live/";
export const WORKSHOP_FILE_PATH = "/api/overleaf/workshop/file";

/** One editable text file of the project, by its path from the project root. */
export interface LiveDocEntry {
  id: string;
  path: string;
}

export type LiveOpenResult =
  | {
      ok: true;
      liveId: string;
      name: string;
      rootDocId: string | null;
      docs: LiveDocEntry[];
      /** Binary files (images, PDFs), which Visual shows for `\includegraphics`. */
      files: LiveDocEntry[];
      canEdit: boolean;
      /** `joinProjectResponse` args as Overleaf sent them, for the vendored IDE. */
      join: unknown[];
    }
  | { ok: false; expired: boolean; message: string };

export type LiveDocResult = { ok: true; text: string; version: number } | { ok: false; message: string };

export type LiveSendResult = { ok: true } | { ok: false; closed: boolean; message: string };

export type LiveEmitResult = { ok: true; reply: unknown[] } | { ok: false; closed: boolean; message: string };

export type LiveEventsResult =
  | { ok: true; events: { name: string; args: unknown[] }[]; closed: boolean }
  | { ok: false; closed: boolean; message: string };

/** The project's docs (not binary files) as paths, sorted; Overleaf's root folder has no name in paths. */
export function flattenDocs(rootFolder: unknown): LiveDocEntry[] {
  return sortByPath(readyCore().flattenOverleafDocs(rootFolder));
}

/** The project's binary files as paths, sorted. */
export function flattenFiles(rootFolder: unknown): LiveDocEntry[] {
  return sortByPath(readyCore().flattenOverleafFiles(rootFolder));
}

/** The walk is Rust and returns walk order; the sort uses the locale the paths are shown in. */
function sortByPath(entries: LiveDocEntry[]): LiveDocEntry[] {
  return entries.sort((a, b) => a.path.localeCompare(b.path));
}

/** Opens the live connection to one project of a stored Workshop session. */
export async function openLiveProject(deps: WorkshopClientDeps, sessionId: string, projectId: string): Promise<LiveOpenResult> {
  const res = await post(deps, `${WORKSHOP_LIVE_PATH}open`, { sessionId, projectId });
  if (!res.ok) return { ok: false, expired: res.status === 401 && res.expired, message: res.message };
  const body = res.body as { liveId?: unknown; name?: unknown; rootDocId?: unknown; rootFolder?: unknown; permissionsLevel?: unknown; join?: unknown };
  if (typeof body.liveId !== "string") return { ok: false, expired: false, message: "The server did not open the project." };
  return {
    ok: true,
    liveId: body.liveId,
    name: typeof body.name === "string" ? body.name : "",
    rootDocId: typeof body.rootDocId === "string" ? body.rootDocId : null,
    docs: flattenDocs(body.rootFolder),
    files: flattenFiles(body.rootFolder),
    canEdit: body.permissionsLevel === "owner" || body.permissionsLevel === "readAndWrite",
    join: Array.isArray(body.join) ? body.join : [],
  };
}

/** One binary project file, or null when it could not be downloaded. */
export async function fetchLiveFile(
  deps: WorkshopClientDeps,
  sessionId: string,
  projectId: string,
  fileId: string,
): Promise<Blob | null> {
  try {
    const res = await deps.fetch(WORKSHOP_FILE_PATH, {
      method: "POST",
      headers: await deps.authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ sessionId, projectId, fileId }),
    });
    return res.ok ? await res.blob() : null;
  } catch {
    return null;
  }
}

/** One doc's text and the version it is at. */
export async function loadLiveDoc(deps: WorkshopClientDeps, liveId: string, docId: string): Promise<LiveDocResult> {
  const res = await post(deps, `${WORKSHOP_LIVE_PATH}doc`, { liveId, docId });
  if (!res.ok) return { ok: false, message: res.message };
  const body = res.body as { lines?: unknown; version?: unknown };
  if (!Array.isArray(body.lines) || typeof body.version !== "number") {
    return { ok: false, message: "The server did not return the file." };
  }
  return { ok: true, text: body.lines.map(String).join("\n"), version: body.version };
}

/** Sends one op at `version`; Overleaf confirms it with an `otUpdateApplied` event. */
export async function sendLiveUpdate(
  deps: WorkshopClientDeps,
  liveId: string,
  docId: string,
  op: TextComponent[],
  version: number,
): Promise<LiveSendResult> {
  const res = await post(deps, `${WORKSHOP_LIVE_PATH}update`, { liveId, docId, op, version });
  if (!res.ok) return { ok: false, closed: res.status === 410, message: res.message };
  return { ok: true };
}

/** Relays one of the vendored IDE's socket events; the reply is its callback's args. */
export async function emitLive(deps: WorkshopClientDeps, liveId: string, name: string, args: unknown[]): Promise<LiveEmitResult> {
  const res = await post(deps, `${WORKSHOP_LIVE_PATH}emit`, { liveId, name, args });
  if (!res.ok) return { ok: false, closed: res.status === 410, message: res.message };
  const body = res.body as { reply?: unknown };
  return { ok: true, reply: Array.isArray(body.reply) ? body.reply : [] };
}

/** The events Overleaf sent since the last call; waits for one when there are none. */
export async function takeLiveEvents(deps: WorkshopClientDeps, liveId: string): Promise<LiveEventsResult> {
  const res = await post(deps, `${WORKSHOP_LIVE_PATH}events`, { liveId });
  if (!res.ok) return { ok: false, closed: res.status === 410, message: res.message };
  const body = res.body as { events?: unknown; closed?: unknown };
  const events = (Array.isArray(body.events) ? body.events : [])
    .filter((e): e is { name: string; args?: unknown } => typeof e === "object" && e !== null && typeof e.name === "string")
    .map((e) => ({ name: e.name, args: Array.isArray(e.args) ? e.args : [] }));
  return { ok: true, events, closed: body.closed === true };
}

/** Closes the live connection. Best effort: the app drops it on exit anyway. */
export async function closeLiveProject(deps: WorkshopClientDeps, liveId: string): Promise<void> {
  await post(deps, `${WORKSHOP_LIVE_PATH}close`, { liveId });
}
