/** Browser-side call to POST /api/overleaf/workshop/pdf. Pure: every side effect is injected. */

export const WORKSHOP_PDF_PATH = "/api/overleaf/workshop/pdf";

export interface WorkshopPdfDeps {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  /** The app's bearer header for its own API routes (`@/lib/auth-headers`). Throws when signed out. */
  authHeaders: (extra?: HeadersInit) => Promise<HeadersInit>;
  createObjectUrl: (blob: Blob) => string;
}

export type WorkshopPdfResult = { ok: true; url: string } | { ok: false; message: string };

const SUPERSEDED = "This PDF request was superseded by a newer one.";

/**
 * Fetches the compiled PDF for a stored Workshop session and returns an object URL
 * for it. Nothing is created on any failure path, so the caller has no URL to revoke.
 *
 * `isCurrent` is checked once the body is in hand; a response that is no longer
 * wanted gets no URL at all.
 */
export async function fetchWorkshopPdf(
  deps: WorkshopPdfDeps,
  sessionId: string,
  projectId: string,
  rootResourcePath: string,
  isCurrent: () => boolean = () => true,
): Promise<WorkshopPdfResult> {
  let res: Response;
  try {
    res = await deps.fetch(WORKSHOP_PDF_PATH, {
      method: "POST",
      headers: await deps.authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ sessionId, projectId, rootResourcePath }),
    });
  } catch (err) {
    return fail(`Could not load the PDF: ${errorText(err)}`);
  }

  if (res.status === 401) return fail("Sign in again to load this PDF.");
  if (!res.ok) return fail((await serverError(res)) ?? `Could not load the PDF (HTTP ${res.status}).`);

  if (!(res.headers.get("Content-Type") ?? "").toLowerCase().startsWith("application/pdf")) {
    return fail("The server did not return a PDF.");
  }
  let blob: Blob;
  try {
    blob = await res.blob();
  } catch (err) {
    return fail(`Could not load the PDF: ${errorText(err)}`);
  }
  if (blob.size === 0) return fail("The server returned an empty PDF.");
  if (!isCurrent()) return fail(SUPERSEDED);
  return { ok: true, url: deps.createObjectUrl(blob) };
}

function fail(message: string): WorkshopPdfResult {
  return { ok: false, message };
}

async function serverError(res: Response): Promise<string | null> {
  try {
    const body = (await res.json()) as { error?: unknown };
    return typeof body.error === "string" && body.error.trim() ? body.error : null;
  } catch {
    return null;
  }
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
