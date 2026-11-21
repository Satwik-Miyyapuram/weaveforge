import type { Comment, ICommentRepository, IWorkspaceFs, NewCommentInput } from "@weaveforge/core";
import { ConflictError, NotFoundError } from "@weaveforge/core";
import { changeJsonRows, readJsonRows, type JsonRow } from "@/lib/json-rows-file";
import { typedCore } from "@/lib/rust-core";

/** The file that holds item (`resourceType`, `resourceId`), or null when there is none. */
export type ItemFileOf = (resourceType: string, resourceId: string) => Promise<string | null>;

const COMMENTS_SUFFIX = ".comments.json";

/**
 * Comments as workspace files (files-first L1/L2): one `<item>.comments.json` next
 * to the item's file, under its name (`x.paper.md` -> `x.comments.json`), so a
 * comment follows its item by path and never by id. No database.
 *
 * A row holds the comment without `resourceType`/`resourceId`: the file it sits
 * next to is the resource. Every change is a conditional write that re-applies on
 * a newer file, so a comment added outside the app is kept.
 */
export class FileCommentRepository implements ICommentRepository {
  /**
   * @param itemFileOf finds the item a comment is on.
   * @param searchRoot the folder `remove` and `setResolved` search for the comment.
   */
  constructor(
    private readonly fs: IWorkspaceFs,
    private readonly itemFileOf: ItemFileOf,
    private readonly searchRoot: string,
  ) {}

  async list(resourceType: string, resourceId: string): Promise<Comment[]> {
    const path = await this.sidecarOf(resourceType, resourceId);
    if (!path) return [];
    const { rows } = await readJsonRows(this.fs, path);
    return rows
      .map((row) => ({ ...row, resourceType, resourceId }) as unknown as Comment)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async add(input: NewCommentInput): Promise<Comment> {
    const path = await this.sidecarOf(input.resourceType, input.resourceId);
    if (!path) throw new NotFoundError(`${input.resourceType} ${input.resourceId} not found`);
    const row: JsonRow = {
      id: `comment-${crypto.randomUUID()}`,
      authorId: "",
      body: input.body,
      createdAt: new Date().toISOString(),
      ...(input.anchor ? { anchor: input.anchor } : {}),
      ...(input.parentId ? { parentId: input.parentId } : {}),
    };
    await changeJsonRows(this.fs, path, (rows) => [...rows, row]);
    return { ...row, resourceType: input.resourceType, resourceId: input.resourceId } as unknown as Comment;
  }

  async remove(id: string): Promise<void> {
    const path = await this.fileOfComment(id);
    if (path) await changeJsonRows(this.fs, path, (rows) => rows.filter((row) => row.id !== id));
  }

  async setResolved(id: string, resolved: boolean): Promise<string | null> {
    const path = await this.fileOfComment(id);
    if (!path) return null;
    const resolvedAt = resolved ? new Date().toISOString() : null;
    await changeJsonRows(this.fs, path, (rows) =>
      rows.map((row) => (row.id === id ? { ...row, resolvedAt } : row)),
    );
    return resolvedAt;
  }

  private async sidecarOf(resourceType: string, resourceId: string): Promise<string | null> {
    const item = await this.itemFileOf(resourceType, resourceId);
    return item ? typedCore().commentsFilePath(item) : null;
  }

  /**
   * The comments file that holds comment `id`, or null. A file that is not a JSON
   * array of objects is skipped; refuses when the id is in more than one file.
   */
  private async fileOfComment(id: string): Promise<string | null> {
    if (!(await this.fs.stat(this.searchRoot))) return null;
    const found: string[] = [];
    for await (const entry of this.fs.walk(this.searchRoot)) {
      if (!entry.path.endsWith(COMMENTS_SUFFIX)) continue;
      let rows: JsonRow[];
      try {
        rows = (await readJsonRows(this.fs, entry.path)).rows;
      } catch {
        continue;
      }
      if (rows.some((row) => row.id === id)) found.push(entry.path);
    }
    if (found.length > 1) {
      throw new ConflictError(`Comment ${id} is in more than one file (${found.join(", ")}); not changed.`);
    }
    return found[0] ?? null;
  }
}
