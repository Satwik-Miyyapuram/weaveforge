import type { Comment, ICommentRepository, NewCommentInput } from "@weaveforge/core";
import { typedCore } from "@/lib/rust-core";

const ANNOTATIONS_SUFFIX = ".annotations.json";
const COMMENTS_SUFFIX = ".comments.json";

/** File operations this repository needs; `readFile` gives null when missing. */
export interface CommentFilePort {
  readFile(path: string): Promise<string | null>;
  writeFile(path: string, text: string): Promise<void>;
  /** Ids of the papers that have a `<stem>.comments.json` sidecar. */
  listPaperIds(): Promise<string[]>;
}

/** A paper comment as the Rust exporter writes it (no anchor, reply or resolve). */
interface PaperRow {
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
      return rows.map((row, index) => paperComment(resourceId, row, index)).sort(byCreated);
    }
    const rows = (await this.readUnmapped()).filter((r) => r.resource_type === resourceType && r.resource_id === resourceId);
    return rows.map(toComment).sort(byCreated);
  }

  async add(input: NewCommentInput): Promise<Comment> {
    const now = new Date().toISOString();
    if (input.resourceType === "paper") {
      // The sidecar has no parent or anchor fields; refuse rather than drop them.
      if (input.parentId || input.anchor) throw new Error("paper comments hold no reply or anchor");
      const rows = await this.readPaper(input.resourceId);
      const row: PaperRow = { body: input.body, created_at: now };
      await this.writePaper(input.resourceId, [...rows, row]);
      return paperComment(input.resourceId, row, rows.length);
    }
    const rows = await this.readUnmapped();
    if (input.parentId) {
      const parent = rows.find((r) => r.id === input.parentId);
      const sameResource = parent?.resource_type === input.resourceType && parent.resource_id === input.resourceId;
      if (!parent || parent.parent_id || !sameResource) {
        throw new Error("a reply answers a comment on the same resource");
      }
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
    await this.writeUnmapped([...rows, row]);
    return toComment(row);
  }

  async remove(id: string): Promise<void> {
    const rows = await this.readUnmapped();
    const kept = rows.filter((row) => row.id !== id && row.parent_id !== id);
    if (kept.length !== rows.length) await this.writeUnmapped(kept);
    for (const paperId of await this.port.listPaperIds()) {
      const paper = await this.readPaper(paperId);
      const left = paper.filter((_, index) => `${paperId}:${index}` !== id);
      if (left.length !== paper.length) await this.writePaper(paperId, left);
    }
  }

  async setResolved(id: string, resolved: boolean): Promise<string | null> {
    const rows = await this.readUnmapped();
    const target = rows.find((row) => row.id === id);
    if (!target) {
      if (await this.isPaperComment(id)) throw new Error("paper comments cannot be resolved");
      throw new Error(`comment ${id} not found`);
    }
    if (target.parent_id) throw new Error("resolve the thread, not a reply");
    target.resolved_at = resolved ? new Date().toISOString() : null;
    await this.writeUnmapped(rows);
    return target.resolved_at;
  }

  private async isPaperComment(id: string): Promise<boolean> {
    for (const paperId of await this.port.listPaperIds()) {
      const paper = await this.readPaper(paperId);
      if (paper.some((_, index) => `${paperId}:${index}` === id)) return true;
    }
    return false;
  }

  /** `x.annotations.json` next to the PDF becomes `x.comments.json`. */
  private paperPath(paperId: string): string {
    const annotations = typedCore().annotationsFilePath(paperId, this.projectRoot);
    return annotations.slice(0, -ANNOTATIONS_SUFFIX.length) + COMMENTS_SUFFIX;
  }

  private unmappedPath(): string {
    return `${this.projectRoot}/.weaveforge/comments-unmapped.json`;
  }

  private async readPaper(paperId: string): Promise<PaperRow[]> {
    const path = this.paperPath(paperId);
    const text = await this.port.readFile(path);
    if (text === null) return [];
    const parsed: unknown = parseJson(text, path);
    if (!Array.isArray(parsed) || !parsed.every(isPaperRow)) throw invalid(path);
    return parsed;
  }

  private async writePaper(paperId: string, rows: PaperRow[]): Promise<void> {
    await this.port.writeFile(this.paperPath(paperId), JSON.stringify(rows, null, 2));
  }

  private async readUnmapped(): Promise<UnmappedRow[]> {
    const path = this.unmappedPath();
    const text = await this.port.readFile(path);
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

  private async writeUnmapped(rows: UnmappedRow[]): Promise<void> {
    await this.port.writeFile(this.unmappedPath(), JSON.stringify({ version: UNMAPPED_VERSION, rows }, null, 2));
  }
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

function isPaperRow(value: unknown): value is PaperRow {
  return isRecord(value) && typeof value.body === "string" && typeof value.created_at === "string";
}

function isUnmappedRow(value: unknown): value is UnmappedRow {
  if (!isRecord(value)) return false;
  const strings = ["id", "resource_type", "resource_id", "author_id", "body", "created_at"];
  const nullable = ["anchor_quote", "anchor_prefix", "anchor_suffix", "parent_id", "resolved_at"];
  return strings.every((k) => typeof value[k] === "string") && nullable.every((k) => value[k] === null || typeof value[k] === "string");
}

function paperComment(resourceId: string, row: PaperRow, index: number): Comment {
  const none = { anchor: null, parentId: null, resolvedAt: null };
  return { id: `${resourceId}:${index}`, authorId: "", resourceType: "paper", resourceId, body: row.body, createdAt: row.created_at, ...none };
}

function toComment(row: UnmappedRow): Comment {
  const anchor = row.anchor_quote === null ? null : { quote: row.anchor_quote, prefix: row.anchor_prefix ?? "", suffix: row.anchor_suffix ?? "" };
  return { id: row.id, authorId: row.author_id, resourceType: row.resource_type, resourceId: row.resource_id, body: row.body, createdAt: row.created_at, anchor, parentId: row.parent_id, resolvedAt: row.resolved_at };
}

function byCreated(a: Comment, b: Comment): number {
  return a.createdAt.localeCompare(b.createdAt);
}
