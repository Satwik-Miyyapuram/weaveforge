import type { LatexSectionNode } from "@weaveforge/core";
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
 * A copy working with no account has no API routes to call -- the desktop
 * build ships no server -- so the same six operations go straight to the local
 * database and the shell. Resolved once and remembered: the answer cannot
 * change without a reload, because the whole backend is wired at startup.
 * Which wiring that is comes from the auth facade; importing the local backend
 * provider here would make this file know which one a window was built with.
 */
let localGateway: LocalOverleafGateway | null | undefined;
export function local(): LocalOverleafGateway | null {
  if (localGateway === undefined) localGateway = getContainer().auth.isLocalMode() ? new LocalOverleafGateway() : null;
  return localGateway;
}

export async function api(path: string, init?: RequestInit) {
  const response = await fetch(path, {
    ...init,
    headers: { ...(await authHeaders({ "Content-Type": "application/json" })), ...(init?.headers ?? {}) },
  });
  const payload = await response.json().catch(() => ({})) as { error?: string; reports?: LinkedReport[]; report?: LinkedReport; connection?: { id: string } };
  if (!response.ok) throw new Error(payload.error ?? "Overleaf request failed.");
  return payload;
}
