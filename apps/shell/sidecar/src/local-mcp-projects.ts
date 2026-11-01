import { idSuffix, projectDir, type WorkspaceProject } from "@weaveforge/core";

import type { VaultSession } from "./vault-handlers";
import { listVaultFiles } from "./vault-handlers";

/** One project as the MCP sees it: `dir` is its folder under the root, "" for a pre-project layout. */
export interface ProjectRef {
  id?: string;
  name: string;
  dir: string;
}

/** The app's projects from its local DB; absent when the shell has no DB open. */
export type ProjectSource = () => Promise<WorkspaceProject[]>;

const PROJECT_FOLDER = /--[a-z0-9]{1,6}$/i;

/**
 * The projects to answer about. With the app's list, each gets the folder the app
 * itself would pick (exact `projectDir`, else the one folder ending in its id
 * suffix); folders no project claims are left out, as the app leaves them out.
 */
export async function resolveProjects(session: VaultSession, source?: ProjectSource): Promise<ProjectRef[]> {
  const listed = await listVaultFiles(session, "");
  const dirs = listed.ok
    ? listed.value.filter((e) => e.kind === "dir").map((e) => e.path).filter((p) => !p.startsWith("."))
    : [];
  const rows = source ? await source().catch(() => []) : [];
  if (rows.length) {
    return rows.map((project) => {
      const exact = projectDir(project);
      if (dirs.includes(exact)) return { ...project, dir: exact };
      const tail = dirs.filter((d) => d.endsWith(`--${idSuffix(project.id)}`));
      // No folder yet is fine: a draft for an empty project still names it.
      return { ...project, dir: tail.length === 1 ? (tail[0] as string) : exact };
    });
  }
  const folders = dirs.filter((d) => PROJECT_FOLDER.test(d));
  return folders.length
    ? folders.map((dir) => ({ name: dir.replace(PROJECT_FOLDER, ""), dir }))
    : [{ name: "workspace", dir: "" }];
}

/** A name as matching reads it: trimmed, lowercased, whitespace runs folded. Entries match the same way. */
export const norm = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");

/** By id, name or folder, then a unique partial name; a miss lists what there is. */
export function pickProject(projects: readonly ProjectRef[], needle: unknown): ProjectRef {
  const wanted = typeof needle === "string" ? norm(needle) : "";
  const names = projects.map((p) => p.name).join(", ");
  const exact = projects.filter((p) => [p.id, p.name, p.dir].some((v) => v && norm(v) === wanted));
  const found = exact.length ? exact : projects.filter((p) => wanted && norm(p.name).includes(wanted));
  if (found.length === 1) return found[0] as ProjectRef;
  throw new Error(`${found.length ? `'${wanted}' matches more than one project` : `No project matches '${wanted}'`}. Projects: ${names}.`);
}
