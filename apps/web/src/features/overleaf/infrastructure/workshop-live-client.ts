/**
 * Browser-side calls to the desktop app's live Overleaf routes (`live/*`), which
 * hold the editing connection to Overleaf. Pure: fetch and the bearer header are
 * injected. Every failure is a message, never a throw.
 */
import type { TextOp } from "../domain/text-ot";
import { post, type WorkshopClientDeps } from "./workshop-session-client";

export const WORKSHOP_LIVE_PATH = "/api/overleaf/workshop/live/";

/** One editable text file of the project, by its path from the project root. */
export interface LiveDocEntry {
  id: string;
  path: string;
}

export type LiveOpenResult =
  | { ok: true; liveId: string; name: string; rootDocId: string | null; docs: LiveDocEntry[]; canEdit: boolean }
  | { ok: false; expired: boolean; message: string };

export type LiveDocResult = { ok: true; text: string; version: number } | { ok: false; message: string };

export type LiveSendResult = { ok: true } | { ok: false; closed: boolean; message: string };

export type LiveEventsResult =
  | { ok: true; events: { name: string; args: unknown[] }[]; closed: boolean }
  | { ok: false; closed: boolean; message: string };

type Folder = { name?: unknown; docs?: unknown; folders?: unknown };

/** The project's docs (not binary files) as paths, sorted; Overleaf's root folder has no name in paths. */
export function flattenDocs(rootFolder: unknown): LiveDocEntry[] {
  const out: LiveDocEntry[] = [];
  const walk = (folder: Folder, prefix: string) => {
    for (const doc of Array.isArray(folder.docs) ? folder.docs : []) {
      const d = doc as { _id?: unknown; name?: unknown };
      if (typeof d._id === "string" && typeof d.name === "string") out.push({ id: d._id, path: prefix + d.name });
    }
    for (const child of Array.isArray(folder.folders) ? folder.folders : []) {
      const f = child as Folder;
      if (typeof f.name === "string") walk(f, `${prefix}${f.name}/`);
    }
  };
  for (const root of Array.isArray(rootFolder) ? rootFolder : []) walk(root as Folder, "");
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/** Opens the live connection to one project of a stored Workshop session. */
export async function openLiveProject(deps: WorkshopClientDeps, sessionId: string, projectId: string): Promise<LiveOpenResult> {
  const res = await post(deps, `${WORKSHOP_LIVE_PATH}open`, { sessionId, projectId });
  if (!res.ok) return { ok: false, expired: res.status === 401 && res.expired, message: res.message };
  const body = res.body as { liveId?: unknown; name?: unknown; rootDocId?: unknown; rootFolder?: unknown; permissionsLevel?: unknown };
  if (typeof body.liveId !== "string") return { ok: false, expired: false, message: "The server did not open the project." };
  return {
    ok: true,
    liveId: body.liveId,
    name: typeof body.name === "string" ? body.name : "",
    rootDocId: typeof body.rootDocId === "string" ? body.rootDocId : null,
    docs: flattenDocs(body.rootFolder),
    canEdit: body.permissionsLevel === "owner" || body.permissionsLevel === "readAndWrite",
  };
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
  op: TextOp,
  version: number,
): Promise<LiveSendResult> {
  const res = await post(deps, `${WORKSHOP_LIVE_PATH}update`, { liveId, docId, op, version });
  if (!res.ok) return { ok: false, closed: res.status === 410, message: res.message };
  return { ok: true };
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
