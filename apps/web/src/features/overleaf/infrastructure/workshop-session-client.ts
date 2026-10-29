/**
 * Browser-side calls to the Workshop session and projects routes. Pure: fetch and
 * the bearer header are injected. Every failure is a message, never a throw.
 * The cookie goes up once, on sign-in; only the opaque session id comes back.
 */

export const WORKSHOP_SESSION_PATH = "/api/overleaf/workshop/session";
export const WORKSHOP_PROJECTS_PATH = "/api/overleaf/workshop/projects";

export interface WorkshopClientDeps {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  /** The app's bearer header for its own API routes (`@/lib/auth-headers`). Throws when signed out. */
  authHeaders: (extra?: HeadersInit) => Promise<HeadersInit>;
}

export interface WorkshopProject {
  id: string;
  name: string;
}

export type WorkshopSignInResult = { ok: true; sessionId: string } | { ok: false; message: string };

/** `expired` means the stored session id is no good any more and should be forgotten. */
export type WorkshopProjectsResult =
  | { ok: true; projects: WorkshopProject[] }
  | { ok: false; expired: boolean; message: string };

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Verifies the Overleaf cookie server-side and returns the session id it was stored under. */
export async function signInToWorkshop(deps: WorkshopClientDeps, cookies: string): Promise<WorkshopSignInResult> {
  const trimmed = cookies.trim();
  if (!trimmed) return { ok: false, message: "Paste your Overleaf session cookie first." };
  const res = await post(deps, WORKSHOP_SESSION_PATH, { cookies: trimmed });
  if (!res.ok) return { ok: false, message: res.message };
  const sessionId = (res.body as { sessionId?: unknown }).sessionId;
  if (typeof sessionId !== "string" || !SESSION_ID.test(sessionId)) {
    return { ok: false, message: "The server did not return an Overleaf session." };
  }
  return { ok: true, sessionId };
}

/** Lists the user's Overleaf projects for a stored session, sorted by name. */
export async function listWorkshopProjects(deps: WorkshopClientDeps, sessionId: string): Promise<WorkshopProjectsResult> {
  const res = await post(deps, WORKSHOP_PROJECTS_PATH, { sessionId });
  // Only the route's own "session not found" 401 carries `expired`; a 401 because the
  // app's sign-in lapsed must not forget the Overleaf session (its sealed row would be orphaned).
  if (!res.ok) return { ok: false, expired: res.status === 401 && res.expired, message: res.message };
  const projects = (res.body as { projects?: unknown }).projects;
  if (!Array.isArray(projects)) return { ok: false, expired: false, message: "The server did not return a project list." };
  return {
    ok: true,
    projects: projects
      .filter((p): p is WorkshopProject =>
        typeof p === "object" && p !== null && typeof p.id === "string" && p.id !== "" && typeof p.name === "string")
      .map((p) => ({ id: p.id, name: p.name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/** Forgets the stored session server-side. Best effort: the caller forgets it locally regardless. */
export async function signOutOfWorkshop(deps: WorkshopClientDeps, sessionId: string): Promise<void> {
  try {
    await deps.fetch(`${WORKSHOP_SESSION_PATH}?id=${encodeURIComponent(sessionId)}`, {
      method: "DELETE",
      headers: await deps.authHeaders(),
    });
  } catch {
    // Nothing to tell the user: a missed delete leaves a sealed row only this user can read.
  }
}

type Posted = { ok: true; body: unknown } | { ok: false; status: number; expired: boolean; message: string };

async function post(deps: WorkshopClientDeps, path: string, payload: unknown): Promise<Posted> {
  let res: Response;
  try {
    res = await deps.fetch(path, {
      method: "POST",
      headers: await deps.authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    });
  } catch (err) {
    return { ok: false, status: 0, expired: false, message: `Could not reach Overleaf: ${err instanceof Error ? err.message : String(err)}` };
  }
  const body = (await res.json().catch(() => null)) as { error?: unknown; expired?: unknown } | null;
  if (!res.ok) {
    const error = typeof body?.error === "string" && body.error.trim() ? body.error : null;
    return {
      ok: false,
      status: res.status,
      expired: body?.expired === true,
      message: error ?? `Overleaf request failed (HTTP ${res.status}).`,
    };
  }
  return { ok: true, body: body ?? {} };
}
