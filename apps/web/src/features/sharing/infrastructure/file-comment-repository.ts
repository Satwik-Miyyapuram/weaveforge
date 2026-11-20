import type { Comment, ICommentRepository, NewCommentInput } from "@weaveforge/core";
import { typedCore } from "@/lib/rust-core";

const ANNOTATIONS_SUFFIX = ".annotations.json";
const COMMENTS_SUFFIX = ".comments.json";
const MAX_ATTEMPTS = 5;

/** File operations this repository needs; `readFile` gives null when missing. */
export interface CommentFilePort {
  readFile(path: string): Promise<string | null>;
  writeFile(path: string, text: string): Promise<void>;
  /** Writes only while the file still holds `expected` (null = absent); false when it changed. */
  writeIf(path: string, text: string, expected: string | null): Promise<boolean>;
  /** Ids of the papers that have a `<stem>.comments.json` sidecar. */
  listPaperIds(): Promise<string[]>;
}

/**
 * A paper comment as it is stored. `id` lives in the row, so it never shifts when another
 * row is removed. Rows written before ids existed have none; they get `<paper>:<index>`
 * on read and a real id the next time the file is written.
 */
interface PaperRow {
  id: string;
  body: string;
  created_at: string;
}

/** An unmapped comment as `.weaveforge/comments-unmapped.json` holds it. */
interface UnmappedRow {
  id: string;
  resource_type: string;
  resource_id: string;
  author_id: string;
  body: string;
  created_at: string;
  anchor_quote: string | null;
  anchor_prefix: string | null;
  anchor_suffix: string | null;
  parent_id: string | null;
  resolved_at: string | null;
}

const UNMAPPED_VERSION = 1;

/** Comments as workspace files: paper comments in the sidecar, others in the unmapped file. No database. */
export class FileCommentRepository implements ICommentRepository {
  constructor(private readonly port: CommentFilePort, private readonly projectRoot: string) {}

  async list(resourceType: string, resourceId: string): Promise<Comment[]> {
    if (resourceType === "paper") {
      const rows = await this.readPaper(resourceId);
      return rows.map((row) => paperComment(resourceId, row)).sort(byCreated);
    }
    const rows = (await this.readUnmapped()).filter((r) => r.resource_type === resourceType && r.resource_id === resourceId);
    return rows.map(toComment).sort(byCreated);
  }

  async add(input: NewCommentInput): Promise<Comment> {
    const now = new Date().toISOString();
    if (input.resourceType === "paper") {
      // The sidecar has no parent or anchor fields; refuse rather than drop them.
      if (input.parentId || input.anchor) throw new Error("paper comments hold no reply or anchor");
      const row: PaperRow = { id: crypto.randomUUID(), body: input.body, created_at: now };
      await this.mutatePaper(input.resourceId, (rows) => [...rows, row]);
      return paperComment(input.resourceId, row);
    }
    const row: UnmappedRow = {
      id: crypto.randomUUID(),
      resource_type: input.resourceType,
      resource_id: input.resourceId,
      author_id: "",
      body: input.body,
      created_at: now,
      anchor_quote: input.anchor?.quote ?? null,
      anchor_prefix: input.anchor?.prefix ?? null,
      anchor_suffix: input.anchor?.suffix ?? null,
      parent_id: input.parentId ?? null,
      resolved_at: null,
    };
    await this.mutateUnmapped((rows) => {
      if (input.parentId) {
        const parent = rows.find((r) => r.id === input.parentId);
        const sameResource = parent?.resource_type === input.resourceType && parent.resource_id === input.resourceId;
        if (!parent || parent.parent_id || !sameResource) {
          throw new Error("a reply answers a comment on the same resource");
        }
      }
      return [...rows, row];
    });
    return toComment(row);
  }

  async remove(id: string): Promise<void> {
    await this.mutateUnmapped((rows) => {
      const kept = rows.filter((row) => row.id !== id && row.parent_id !== id);
      return kept.length === rows.length ? null : kept;
    });
    for (const paperId of await this.port.listPaperIds()) {
      await this.mutatePaper(paperId, (rows) => {
        const left = rows.filter((row) => row.id !== id);
        return left.length === rows.length ? null : left;
      });
    }
  }

  async setResolved(id: string, resolved: boolean): Promise<string | null> {
    const state = { found: false, reply: false, resolvedAt: null as string | null };
    await this.mutateUnmapped((rows) => {
      const target = rows.find((row) => row.id === id);
      state.found = target !== undefined;
      if (!target) return null;
      if (target.parent_id) {
        state.reply = true;
        return null;
      }
      target.resolved_at = resolved ? new Date().toISOString() : null;
      state.resolvedAt = target.resolved_at;
      return rows;
    });
    if (!state.found) {
      if (await this.isPaperComment(id)) throw new Error("paper comments cannot be resolved");
      throw new Error(`comment ${id} not found`);
    }
    if (state.reply) throw new Error("resolve the thread, not a reply");
    return state.resolvedAt;
  }

  private async isPaperComment(id: string): Promise<boolean> {
    for (const paperId of await this.port.listPaperIds()) {
      if ((await this.readPaper(paperId)).some((row) => row.id === id)) return true;
    }
    return false;
  }

  /** `x.annotations.json` next to the PDF becomes `x.comments.json`. */
  private paperPath(paperId: string): string {
    // The id becomes a file name; same rule as the Rust is_safe_id in reader/github_repo_path.rs (letters, digits, `_`, `-`).
    if (!/^[A-Za-z0-9_-]+$/.test(paperId)) throw new Error(`not a valid paper id: ${paperId}`);
    const annotations = typedCore().annotationsFilePath(paperId, this.projectRoot);
    return annotations.slice(0, -ANNOTATIONS_SUFFIX.length) + COMMENTS_SUFFIX;
  }

  private unmappedPath(): string {
    return `${this.projectRoot}/.weaveforge/comments-unmapped.json`;
  }

  private async readPaper(paperId: string): Promise<PaperRow[]> {
    const path = this.paperPath(paperId);
    return parsePaper(paperId, path, await this.port.readFile(path));
  }

  private async readUnmapped(): Promise<UnmappedRow[]> {
    const path = this.unmappedPath();
    return parseUnmapped(path, await this.port.readFile(path));
  }

  /** Read, change, compare-and-write; a change that lost the race is re-read and re-applied. */
  private async mutatePaper(paperId: string, change: (rows: PaperRow[]) => PaperRow[] | null): Promise<void> {
    const path = this.paperPath(paperId);
    await this.mutate(path, (text) => {
      const next = change(parsePaper(paperId, path, text));
      return next === null ? null : JSON.stringify(next, null, 2);
    });
  }

  private async mutateUnmapped(change: (rows: UnmappedRow[]) => UnmappedRow[] | null): Promise<void> {
    const path = this.unmappedPath();
    await this.mutate(path, (text) => {
      const next = change(parseUnmapped(path, text));
      return next === null ? null : JSON.stringify({ version: UNMAPPED_VERSION, rows: next }, null, 2);
    });
  }

  private async mutate(path: string, change: (text: string | null) => string | null): Promise<void> {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const current = await this.port.readFile(path);
      const next = change(current);
      if (next === null || (await this.port.writeIf(path, next, current))) return;
    }
    throw new Error(`comments file changed while writing; not saved: ${path}`);
  }
}

function parsePaper(paperId: string, path: string, text: string | null): PaperRow[] {
  if (text === null) return [];
  const parsed = parseJson(text, path);
  if (!Array.isArray(parsed) || !parsed.every(isPaperRow)) throw invalid(path);
  return parsed.map((row, index) => ({ ...row, id: row.id ?? `${paperId}:${index}` }));
}

function parseUnmapped(path: string, text: string | null): UnmappedRow[] {
  if (text === null) return [];
  const file = parseJson(text, path);
  if (!isRecord(file) || !Array.isArray(file.rows)) throw invalid(path);
  if (file.version !== UNMAPPED_VERSION) {
    if (typeof file.version === "number") {
      throw new Error(`comments-unmapped version ${file.version} is not supported`);
    }
    throw invalid(path);
  }
  if (!file.rows.every(isUnmappedRow)) throw invalid(path);
  return file.rows;
}

function parseJson(text: string, path: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw invalid(path);
  }
}

function invalid(path: string): Error {
  return new Error(`comments file is not valid: ${path}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPaperRow(value: unknown): value is Omit<PaperRow, "id"> & { id?: string } {
  return (
    isRecord(value) &&
    (value.id === undefined || typeof value.id === "string") &&
    typeof value.body === "string" &&
    typeof value.created_at === "string"
  );
}

function isUnmappedRow(value: unknown): value is UnmappedRow {
  if (!isRecord(value)) return false;
  const strings = ["id", "resource_type", "resource_id", "author_id", "body", "created_at"];
  const nullable = ["anchor_quote", "anchor_prefix", "anchor_suffix", "parent_id", "resolved_at"];
  return strings.every((k) => typeof value[k] === "string") && nullable.every((k) => value[k] === null || typeof value[k] === "string");
}

function paperComment(resourceId: string, row: PaperRow): Comment {
  const none = { anchor: null, parentId: null, resolvedAt: null };
  return { id: row.id, authorId: "", resourceType: "paper", resourceId, body: row.body, createdAt: row.created_at, ...none };
}

function toComment(row: UnmappedRow): Comment {
  const anchor = row.anchor_quote === null ? null : { quote: row.anchor_quote, prefix: row.anchor_prefix ?? "", suffix: row.anchor_suffix ?? "" };
  return { id: row.id, authorId: row.author_id, resourceType: row.resource_type, resourceId: row.resource_id, body: row.body, createdAt: row.created_at, anchor, parentId: row.parent_id, resolvedAt: row.resolved_at };
}

function byCreated(a: Comment, b: Comment): number {
  return a.createdAt.localeCompare(b.createdAt);
}
