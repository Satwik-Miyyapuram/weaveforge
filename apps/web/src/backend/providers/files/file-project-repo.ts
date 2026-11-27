/**
 * Project repository for the files mode (0.9.8): projects are folders.
 *
 * Every top-level folder of the workspace whose name does not start with "." is
 * a project, named after the folder; the name is its id too, so a rename changes
 * the id. Dot folders (`.weaveforge`, `.git`) are the workspace's own. Optional
 * extras (colour, created date) sit in `<folder>/.weaveforge/project.json`;
 * without it the defaults stand. A new project gets the standard subfolders.
 *
 * 0.9.7 named folders `<slug>--<id6>`, and its files mode kept one project in
 * the workspace root itself. The first list moves a root project into a folder
 * named after it, then renames each `--<id6>` folder that holds the project
 * layout to its plain name, so the folder reads as the project the user sees.
 */
import {
  NotFoundError,
  ProjectValidationError,
  type IProjectManager,
  type IProjectRepository,
  type IWorkspaceFs,
  type NewProjectInput,
  type Project,
} from "@weaveforge/core";
import { typedCore } from "@/lib/rust-core";

/** The subfolders a new project starts with; the Rust `ENTITY_DIRS`. */
export const PROJECT_FOLDERS = ["notes", "papers", "reading-lists", "report", "experiments", "plan", "logbook"] as const;

const EXTRAS = ".weaveforge/project.json";
const WORKSPACE_JSON = ".weaveforge/workspace.json";
const SUFFIXED = /^(.+)--([A-Za-z0-9]{1,6})$/;
/** What a 0.9.7 root project kept in the root, besides the entity folders. */
const ROOT_PROJECT_FOLDERS = [...PROJECT_FOLDERS, "assets"];
const ROOT_PROJECT_FILES = [".weaveforge/annotation-pins.json", ".overleaf.json"];
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

/** The trimmed name as a folder name, or ProjectValidationError saying why it cannot be one. */
export function projectFolderName(raw: string): string {
  const name = typedCore().projectName(raw);
  if (!name) throw new ProjectValidationError("Project name is required.");
  if (/[/\\:*?"<>|]/.test(name)) throw new ProjectValidationError('A project name cannot hold / \\ : * ? " < > |.');
  if (name.startsWith(".")) throw new ProjectValidationError("A project name cannot start with a dot.");
  if (/[. ]$/.test(name)) throw new ProjectValidationError("A project name cannot end with a dot or a space.");
  if (RESERVED.test(name)) throw new ProjectValidationError(`"${name}" is a name Windows keeps for itself.`);
  return name;
}

export class FileProjectRepository implements IProjectRepository, IProjectManager {
  private renamed: Promise<void> | null = null;

  /** `onFolderMoved` re-keys records kept by folder (paper field definitions) when a 0.9.7 folder is renamed. */
  constructor(
    private readonly fs: IWorkspaceFs,
    private readonly onFolderMoved: (from: string, to: string) => Promise<void> = async () => {},
  ) {}

  async getById(id: string): Promise<Project | null> {
    return (await this.list()).find((p) => p.id === id) ?? null;
  }

  async list(): Promise<Project[]> {
    this.renamed ??= this.moveRootProject()
      .then(() => this.renameSuffixedFolders())
      .catch((e) => console.warn("0.9.7 project folders not renamed", e));
    await this.renamed;
    const folders = (await this.folders()).sort((a, b) => a.localeCompare(b));
    return Promise.all(folders.map((folder) => this.read(folder)));
  }

  async create(input: NewProjectInput): Promise<Project> {
    const name = projectFolderName(input.name ?? "");
    if (await this.fs.stat(name)) throw new ProjectValidationError(`"${name}" is already in the workspace folder.`);
    for (const dir of PROJECT_FOLDERS) await this.fs.mkdirp(`${name}/${dir}`);
    const project: Project = { id: name, name, ...(input.color ? { color: input.color } : {}), createdAt: new Date().toISOString() };
    await this.writeExtras(name, { color: input.color, createdAt: project.createdAt });
    return project;
  }

  /** Writes the extras; the name is the folder's, so a new one goes through `rename`. */
  async save(project: Project): Promise<void> {
    if ((await this.fs.stat(project.id))?.kind !== "dir") throw new NotFoundError(`Project ${project.id} not found.`);
    await this.writeExtras(project.id, { color: project.color });
  }

  /**
   * Move the project's folder to `name`. A taken name is refused before anything
   * moves; a file that cannot move stays in the old folder, which is then kept.
   */
  async rename(project: Project, name: string): Promise<Project> {
    const target = projectFolderName(name);
    if (target === project.id) return project;
    if (await this.fs.stat(target)) throw new ProjectValidationError(`"${target}" is already in the workspace folder.`);
    await moveFolder(this.fs, project.id, target);
    return { ...project, id: target, name: target };
  }

  /** The folder itself goes to the trash in `removeProjectFolder`; nothing else holds the project. */
  async delete(_id: string): Promise<void> {}

  remove(id: string): Promise<void> {
    return this.delete(id);
  }

  private async folders(): Promise<string[]> {
    return (await this.fs.list(""))
      .filter((entry) => entry.kind === "dir")
      .map((entry) => entry.path.split("/").pop() ?? "")
      .filter((name) => name !== "" && !name.startsWith("."));
  }

  private async read(folder: string): Promise<Project> {
    const extras = await this.readJson(`${folder}/${EXTRAS}`);
    return {
      id: folder,
      name: folder,
      ...(typeof extras.color === "string" ? { color: extras.color } : {}),
      createdAt: typeof extras.createdAt === "string" ? extras.createdAt : "",
    };
  }

  private async readJson(path: string): Promise<Record<string, unknown>> {
    try {
      if (!(await this.fs.stat(path))) return {};
      const raw = JSON.parse(await this.fs.readText(path)) as unknown;
      return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }

  /** Merges into the existing file, so keys this app does not know survive; temp file then rename. */
  private async writeExtras(folder: string, extras: Record<string, unknown>): Promise<void> {
    const path = `${folder}/${EXTRAS}`;
    const next = { ...(await this.readJson(path)) };
    for (const [key, value] of Object.entries(extras)) {
      if (value === undefined) delete next[key];
      else next[key] = value;
    }
    await this.fs.mkdirp(`${folder}/.weaveforge`);
    await this.fs.writeFile(`${path}.tmp`, JSON.stringify(next, null, 2) + "\n");
    await this.fs.rename(`${path}.tmp`, path);
  }

  /**
   * A 0.9.7 root project (entity folders in the workspace root) moves into a
   * folder named after workspace.json's name ("Project" without one). It runs
   * before the `--<id6>` renames, so its name wins over an older copy of the same
   * project. A name already there leaves the root as it is.
   */
  private async moveRootProject(): Promise<void> {
    const present = new Set(await this.folders());
    const dirs = ROOT_PROJECT_FOLDERS.filter((dir) => present.has(dir));
    if (!dirs.some((dir) => dir !== "assets")) return;
    const workspace = await this.readJson(WORKSPACE_JSON);
    let target = "Project";
    if (typeof workspace.name === "string") {
      try {
        target = projectFolderName(workspace.name);
      } catch {
        // "Project" stands.
      }
    }
    if (present.has(target) || (await this.fs.stat(target))) return;
    for (const dir of dirs) await moveFolder(this.fs, dir, `${target}/${dir}`);
    for (const file of ROOT_PROJECT_FILES) {
      if (!(await this.fs.stat(file)) || (await this.fs.stat(`${target}/${file}`))) continue;
      await this.fs.mkdirp(`${target}/${file}`.split("/").slice(0, -1).join("/"));
      await this.fs.rename(file, `${target}/${file}`);
    }
    await this.writeExtras(target, {
      color: typeof workspace.color === "string" ? workspace.color : undefined,
      createdAt: typeof workspace.createdAt === "string" ? workspace.createdAt : undefined,
    });
    await this.onFolderMoved("", target);
  }

  /**
   * 0.9.7 `<slug>--<id6>` folders to `<name>`: the workspace.json name when its id
   * ends the folder, else the slug. Only folders with the project layout move, and
   * never onto a name already there.
   */
  private async renameSuffixedFolders(): Promise<void> {
    const core = typedCore();
    const workspace = await this.readJson(WORKSPACE_JSON);
    for (const folder of await this.folders()) {
      const match = SUFFIXED.exec(folder);
      if (!match) continue;
      const children = (await this.fs.list(folder)).map((entry) => entry.path.split("/").pop() ?? "");
      if (!core.holdsProjectLayout(children)) continue;
      const own = typeof workspace.id === "string" && core.idSuffix(workspace.id) === match[2];
      let target = match[1] ?? "";
      if (own && typeof workspace.name === "string") {
        try {
          target = projectFolderName(workspace.name);
        } catch {
          // The slug stands.
        }
      }
      if (!target || (await this.fs.stat(target))) continue;
      await moveFolder(this.fs, folder, target);
      if (own) {
        await this.writeExtras(target, {
          color: typeof workspace.color === "string" ? workspace.color : undefined,
          createdAt: typeof workspace.createdAt === "string" ? workspace.createdAt : undefined,
        });
      }
      await this.onFolderMoved(folder, target);
    }
  }
}

/**
 * Move every file and folder under `from` to `to`, one file at a time (the
 * browser's file system cannot rename a folder), never onto a file already
 * there. Emptied folders are removed deepest first; one still holding a file
 * that would not move is kept.
 */
async function moveFolder(fs: IWorkspaceFs, from: string, to: string): Promise<void> {
  const files: string[] = [];
  const dirs: string[] = [];
  const pending = [from];
  while (pending.length > 0) {
    for (const entry of await fs.list(pending.pop()!)) {
      if (entry.kind === "dir") {
        dirs.push(entry.path);
        pending.push(entry.path);
      } else {
        files.push(entry.path);
      }
    }
  }
  const moved = (path: string) => to + path.slice(from.length);
  await fs.mkdirp(to);
  for (const dir of dirs) await fs.mkdirp(moved(dir));
  for (const path of files) {
    if (await fs.stat(moved(path))) continue;
    await fs.rename(path, moved(path));
  }
  for (const dir of [...dirs, from].sort((a, b) => b.length - a.length)) {
    if ((await fs.list(dir)).length > 0) continue;
    await fs.remove(dir).catch(() => {});
  }
}
