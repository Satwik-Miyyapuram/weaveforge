/**
 * Project repository for the files mode (0.9.7): one workspace is one project.
 * The project is `.weaveforge/workspace.json` at the workspace root; its id is
 * stored there, so it stays stable across renames of the folder.
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

const WORKSPACE_JSON = ".weaveforge/workspace.json";
const PROJECT_KEYS = ["id", "name", "color", "createdAt"] as const;

export class FileProjectRepository implements IProjectRepository, IProjectManager {
  constructor(private readonly fs: IWorkspaceFs) {}

  async getById(id: string): Promise<Project | null> {
    const project = await this.read();
    return project?.id === id ? project : null;
  }

  async list(): Promise<Project[]> {
    const project = await this.read();
    return project ? [project] : [];
  }

  async create(input: NewProjectInput): Promise<Project> {
    const project = createProject(input, {
      clock: { nowIso: () => new Date().toISOString() },
      ids: { newId: () => crypto.randomUUID() },
    });
    await this.write(project);
    return project;
  }

  async save(project: Project): Promise<void> {
    const current = await this.read();
    if (!current || current.id !== project.id) throw new NotFoundError(`Project ${project.id} not found.`);
    await this.write({ ...project, createdAt: current.createdAt });
  }

  /** Drops only the project keys; other keys in workspace.json are kept. */
  async delete(id: string): Promise<void> {
    if ((await this.read())?.id !== id) return;
    const rest = await this.readRaw();
    for (const key of PROJECT_KEYS) delete rest[key];
    await this.writeRaw(rest);
  }

  remove(id: string): Promise<void> {
    return this.delete(id);
  }

  private async read(): Promise<Project | null> {
    if (!(await this.fs.stat(WORKSPACE_JSON))) return null;
    const raw = JSON.parse(await this.fs.readText(WORKSPACE_JSON)) as Partial<Project>;
    if (typeof raw.id !== "string" || typeof raw.name !== "string") return null;
    return {
      id: raw.id,
      name: raw.name,
      ...(typeof raw.color === "string" ? { color: raw.color } : {}),
      createdAt: typeof raw.createdAt === "string" ? raw.createdAt : "",
    };
  }

  /** Merges into the existing file so other keys in workspace.json survive. */
  private async write(project: Project): Promise<void> {
    await this.writeRaw({ ...(await this.readRaw()), ...project });
  }

  private async readRaw(): Promise<Record<string, unknown>> {
    if (!(await this.fs.stat(WORKSPACE_JSON))) return {};
    return JSON.parse(await this.fs.readText(WORKSPACE_JSON)) as Record<string, unknown>;
  }

  /** Temp file then rename, so a crash never leaves a half-written workspace.json. */
  private async writeRaw(data: Record<string, unknown>): Promise<void> {
    await this.fs.mkdirp(".weaveforge");
    const tmp = `${WORKSPACE_JSON}.tmp`;
    await this.fs.writeFile(tmp, JSON.stringify(data, null, 2) + "\n");
    await this.fs.rename(tmp, WORKSPACE_JSON);
  }
}
