export interface WorkshopRequest {
  cookies: string;
  projectId: string;
  rootResourcePath: string;
}

export type WorkshopRequestResult =
  | { ok: true; value: WorkshopRequest }
  | { ok: false; message: string };

const PROJECT_ID = /^[A-Za-z0-9]+$/;

/** Validates a request body for the Workshop routes. The cookie is returned trimmed and never logged. */
export function readWorkshopRequest(body: unknown): WorkshopRequestResult {
  if (typeof body !== "object" || body === null) {
    return { ok: false, message: "A JSON body is required." };
  }
  const { cookies, projectId, rootResourcePath } = body as Record<string, unknown>;
  const trimmedCookies = typeof cookies === "string" ? cookies.trim() : "";
  if (!trimmedCookies) return { ok: false, message: "An Overleaf session cookie is required." };
  if (typeof projectId !== "string" || !PROJECT_ID.test(projectId)) {
    return { ok: false, message: "A valid Overleaf project id is required." };
  }
  const root = typeof rootResourcePath === "string" ? rootResourcePath.trim() : "";
  if (!root) return { ok: false, message: "The root .tex file is required." };
  return { ok: true, value: { cookies: trimmedCookies, projectId, rootResourcePath: root } };
}
