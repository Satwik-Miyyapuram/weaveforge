import type { LatexSectionNode } from "@weaveforge/core";
import { relayUrl } from "@/lib/parts";
import { authHeaders } from "@/lib/auth-headers";
import { LocalOverleafGateway } from "@/features/overleaf/infrastructure/local-overleaf-gateway";
import { getContainer } from "@/bootstrap";

export type LinkedReport = {
  id: string; project_id: string; title: string; connection_id: string; overleaf_project_id: string;
  entry_file: string; external_url: string | null; last_fetched_at: string | null;
  section_targets: Record<string, number>;
};
export type ReportContent = { files: { path: string; content: string }[]; entryFile: string; sectionTree: { roots: LatexSectionNode[]; files: string[]; warnings: string[] }; overleafUrl: string };

/**
 * The rows, from wherever this copy keeps them.
 *
 * A copy working with no account has no server to call, and 0.9.8 keeps no
 * local database, so there are no rows to read or write: the gateway refuses
 * every operation with "Overleaf needs an account." A signed-in copy calls the
 * relay routes, which keep the rows on the server. Resolved once and remembered:
 * the answer cannot change without a reload, because the whole backend is wired
 * at startup. Which wiring that is comes from the auth facade; importing the
 * local backend provider here would make this file know which one a window was
 * built with.
 */
let localGateway: LocalOverleafGateway | null | undefined;
export function local(): LocalOverleafGateway | null {
  if (localGateway === undefined) localGateway = getContainer().auth.isLocalMode() ? new LocalOverleafGateway() : null;
  return localGateway;
}

export async function api(path: string, init?: RequestInit) {
  const response = await fetch(relayUrl(path), {
    ...init,
    headers: { ...(await authHeaders({ "Content-Type": "application/json" })), ...(init?.headers ?? {}) },
  });
  const text = await response.text().catch(() => "");
  let payload: { error?: string; reports?: LinkedReport[]; report?: LinkedReport; connection?: { id: string } } = {};
  try { payload = JSON.parse(text) ?? {}; } catch { /* not JSON: the raw text is the detail */ }
  if (!response.ok) throw overleafRequestError(response.status, payload.error, text);
  return payload;
}

/** A failed relay call, naming its status and the server's own words (#698). */
export function overleafRequestError(status: number, error: unknown, body: string): Error {
  const detail = (typeof error === "string" && error.trim() ? error : body).trim().slice(0, 300);
  return new Error(`Overleaf request failed (HTTP ${status})${detail ? `: ${detail}` : "."}`);
}
