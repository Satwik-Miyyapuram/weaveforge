export interface WorkshopRequest {
  sessionId: string;
  projectId: string;
  /** Null lets Overleaf compile the project's main document. */
  rootResourcePath: string | null;
}

export type WorkshopRequestResult =
  | { ok: true; value: WorkshopRequest }
  | { ok: false; message: string };

const PROJECT_ID = /^[A-Za-z0-9]+$/;
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Validates a request body for the Workshop routes. The body carries a session id, never a cookie. */
export function readWorkshopRequest(body: unknown): WorkshopRequestResult {
  if (typeof body !== "object" || body === null) {
    return { ok: false, message: "A JSON body is required." };
  }
  const { sessionId, projectId, rootResourcePath } = body as Record<string, unknown>;
  if (typeof sessionId !== "string" || !SESSION_ID.test(sessionId)) {
    return { ok: false, message: "A valid Overleaf session id is required. Sign in to Overleaf first." };
  }
  if (typeof projectId !== "string" || !PROJECT_ID.test(projectId)) {
    return { ok: false, message: "A valid Overleaf project id is required." };
  }
  let root: string | null = null;
  if (typeof rootResourcePath === "string") {
    root = rootResourcePath.trim() || null;
  } else if (rootResourcePath !== undefined && rootResourcePath !== null) {
    return { ok: false, message: "The root .tex file must be a text path." };
  }
  return { ok: true, value: { sessionId, projectId, rootResourcePath: root } };
}

/** Validates a body that carries only a session id (used by the projects route). */
export function readWorkshopSessionId(body: unknown): { ok: true; value: string } | { ok: false; message: string } {
  const sessionId = typeof body === "object" && body !== null ? (body as Record<string, unknown>).sessionId : undefined;
  if (typeof sessionId !== "string" || !SESSION_ID.test(sessionId)) {
    return { ok: false, message: "A valid Overleaf session id is required. Sign in to Overleaf first." };
  }
  return { ok: true, value: sessionId };
}
