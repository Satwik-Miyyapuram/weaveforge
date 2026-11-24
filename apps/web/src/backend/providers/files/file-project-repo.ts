/**
 * Project repository for the files mode: one workspace holds many projects, each
 * in its own folder `<slug>--<id6>` named by `.weaveforge/project.json` inside it.
 * A root `.weaveforge/workspace.json` with an id (early 0.9.7) is a project in the root.
 */
import {
  createProject,
  NotFoundError,
  type IProjectManager,
  type IProjectRepository,
  type IWorkspaceFs,
  type NewProjectInput,
  type Project,
} from "@weaveforge/core";
import { loadCore } from "@/lib/rust-core";

const META = ".weaveforge";
const WORKSPACE_JSON = `${META}/workspace.json`;
const DELETED_JSON = "project.deleted.json";
const PROJECT_KEYS = ["id", "name", "color", "createdAt"] as const;
/** How long a project's folder is trusted before its file is looked at again. */
const FOLDER_TTL_MS = 2000;

export const PROJECT_JSON = `${META}/project.json`;

interface Entry {
  project: Project;
  /** "" for the legacy project in the workspace root. */
  folder: string;
}

const fileOf = (folder: string): string => (folder ? `${folder}/${PROJECT_JSON}` : WORKSPACE_JSON);
const tailOf = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

export class FileProjectRepository implements IProjectRepository, IProjectManager {
  private readonly folders = new Map<string, { folder: string; checkedAt: number }>();

  constructor(
    private readonly fs: IWorkspaceFs,
    private readonly now: () => number = Date.now,
  ) {}

  async getById(id: string): Promise<Project | null> {
    return (await this.find(id))?.project ?? null;
  }

  async list(): Promise<Project[]> {
    return (await this.scan()).map((entry) => entry.project);
  }

  /** The project's folder under the workspace, "" for the legacy root, null when there is no such project. */
  async folderOf(id: string): Promise<string | null> {
    const known = this.folders.get(id);
    if (known) {
      if (this.now() - known.checkedAt < FOLDER_TTL_MS) return known.folder;
      if ((await this.readProject(known.folder))?.id === id) {
        known.checkedAt = this.now();
        return known.folder;
      }
    }
    return (await this.find(id))?.folder ?? null;
  }

  async create(input: NewProjectInput): Promise<Project> {
    const { color, ...rest } = createProject(input, {
      clock: { nowIso: () => new Date().toISOString() },
      ids: { newId: () => crypto.randomUUID() },
    });
    const project: Project = { ...rest, ...(color ? { color } : {}) };
    const { projectDir } = await loadCore();
    await this.write(projectDir(project), project);
    return project;
  }

  /** Gives a project that already has an id its folder, reusing one that is already its own. Returns the folder. */
  async adopt(project: Project): Promise<string> {
    const current = await this.find(project.id);
    if (current) return current.folder;
    const core = await loadCore();
    const exact = core.projectDir(project);
    const folder = core.pickProjectFolder(await this.dirNames(), exact, `--${core.idSuffix(project.id)}`, []) ?? exact;
    await this.write(folder, project);
    return folder;
  }

  async save(project: Project): Promise<void> {
    const current = await this.find(project.id);
    if (!current) throw new NotFoundError(`Project ${project.id} not found.`);
    await this.write(current.folder, { ...project, createdAt: current.project.createdAt });
    if (current.folder && project.name !== current.project.name) await this.moveFolder(current.folder, project);
  }

  /** Unlists the project and keeps every file; the screen then moves the folder to the trash. */
  async delete(id: string): Promise<void> {
    const current = await this.find(id);
    if (!current) return;
    this.folders.delete(id);
    if (current.folder) {
      await this.fs.rename(fileOf(current.folder), `${current.folder}/${META}/${DELETED_JSON}`);
      return;
    }
    const rest = await this.readRaw("");
    for (const key of PROJECT_KEYS) delete rest[key];
    await this.writeRaw("", rest);
  }

  remove(id: string): Promise<void> {
    return this.delete(id);
  }

  private async find(id: string): Promise<Entry | null> {
    return (await this.scan()).find((entry) => entry.project.id === id) ?? null;
  }

  private async dirNames(): Promise<string[]> {
    const names: string[] = [];
    for (const entry of await this.fs.list("")) {
      const name = tailOf(entry.path);
      if (entry.kind === "dir" && !name.startsWith(".")) names.push(name);
    }
    return names;
  }

  private async scan(): Promise<Entry[]> {
    const { projectDir } = await loadCore();
    const folders = ["", ...(await this.dirNames())];
    const found = await Promise.all(
      folders.map(async (folder) => ({ folder, project: await this.readProject(folder) })),
    );
    const byId = new Map<string, Entry>();
    for (const { folder, project } of found) {
      if (!project) continue;
      // Two folders with one id: a copied folder. The one named after the project is it.
      if (byId.has(project.id) && folder !== projectDir(project)) continue;
      byId.set(project.id, { folder, project });
    }
    const checkedAt = this.now();
    this.folders.clear();
    for (const [id, { folder }] of byId) this.folders.set(id, { folder, checkedAt });
    return [...byId.values()].sort(
      (a, b) => a.project.createdAt.localeCompare(b.project.createdAt) || a.folder.localeCompare(b.folder),
    );
  }

  /** One atomic folder rename, or none: a folder that cannot move keeps its name and still works. */
  private async moveFolder(from: string, project: Project): Promise<void> {
    const { projectDir } = await loadCore();
    const to = projectDir(project);
    if (to === from || (await this.dirNames()).includes(to)) return;
    try {
      await this.fs.rename(from, to);
      this.folders.set(project.id, { folder: to, checkedAt: this.now() });
    } catch {
      this.folders.delete(project.id);
    }
  }

  /** A file that does not parse hides only its own project. */
  private async readProject(folder: string): Promise<Project | null> {
    let raw: Partial<Project>;
    try {
      if (!(await this.fs.stat(fileOf(folder)))) return null;
      raw = JSON.parse(await this.fs.readText(fileOf(folder))) as Partial<Project>;
    } catch {
      return null;
    }
    if (typeof raw?.id !== "string" || typeof raw.name !== "string") return null;
    return {
      id: raw.id,
      name: raw.name,
      ...(typeof raw.color === "string" ? { color: raw.color } : {}),
      createdAt: typeof raw.createdAt === "string" ? raw.createdAt : "",
    };
  }

  /** Merges into the existing file so other keys survive. */
  private async write(folder: string, project: Project): Promise<void> {
    await this.writeRaw(folder, { ...(await this.readRaw(folder)), ...project });
    this.folders.set(project.id, { folder, checkedAt: this.now() });
  }

  private async readRaw(folder: string): Promise<Record<string, unknown>> {
    if (!(await this.fs.stat(fileOf(folder)))) return {};
    return JSON.parse(await this.fs.readText(fileOf(folder))) as Record<string, unknown>;
  }

  /** Temp file then rename, so a crash never leaves a half-written file. */
  private async writeRaw(folder: string, data: Record<string, unknown>): Promise<void> {
    await this.fs.mkdirp(folder ? `${folder}/${META}` : META);
    const path = fileOf(folder);
    await this.fs.writeFile(`${path}.tmp`, JSON.stringify(data, null, 2) + "\n");
    await this.fs.rename(`${path}.tmp`, path);
  }
}
