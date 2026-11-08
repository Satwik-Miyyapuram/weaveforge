import type { WorkshopProjectsResult } from "@/features/overleaf/infrastructure/workshop-session-client";
import type { LinkedReport } from "../ui/linked-overleaf-api";
import { mergeOverleafProjects, pickedOverleafProjects } from "./overleaf-project-list";

/** One row under the editor's Overleaf folder. */
export interface OverleafTreeRow {
  id: string;
  name: string;
}

/** The row shown when there is nothing to open yet: it opens the Overleaf screen to sign in. */
export const SIGN_IN_ROW: OverleafTreeRow = { id: "projects", name: "Sign in to Overleaf" };

export interface OverleafTreeDeps {
  /** Sign-in routes exist (see `canShowWorkshop`). */
  workshop: boolean;
  /** The open WeaveForge project, whose linked reports also show. */
  projectId: string | null;
  sessionId: () => string | null;
  listAccount: (sessionId: string) => Promise<WorkshopProjectsResult>;
  listLinked: (projectId: string) => Promise<LinkedReport[]>;
  /** The account projects chosen to show; null shows all. */
  picked: () => string[] | null;
}

/**
 * The same projects the Overleaf screen lists (linked first, then the picked
 * account projects), as rows for the editor's sidebar. Never throws: a list
 * that fails is left out. Signed out with nothing linked, one row to sign in.
 */
export async function loadOverleafTreeRows(deps: OverleafTreeDeps): Promise<OverleafTreeRow[]> {
  const sessionId = deps.workshop ? deps.sessionId() : null;
  const [account, linked] = await Promise.all([
    sessionId
      ? deps.listAccount(sessionId).then((result) => (result.ok ? result.projects : null), () => null)
      : Promise.resolve(null),
    deps.projectId ? deps.listLinked(deps.projectId).catch(() => []) : Promise.resolve([]),
  ]);
  const ids = deps.picked();
  const rows = pickedOverleafProjects(mergeOverleafProjects(account, linked), ids ? new Set(ids) : null);
  if (account === null && rows.length === 0) return [SIGN_IN_ROW];
  return rows.map((row) => ({ id: row.id, name: row.name }));
}
