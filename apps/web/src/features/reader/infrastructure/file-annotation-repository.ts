import type {
  IReaderAnnotationSink,
  IReaderAnnotationSource,
  IWorkspaceFs,
  NewReaderAnnotation,
  ReaderAnnotation,
  ReaderAnnotationPatch,
} from "@weaveforge/core";
import { ConflictError, NotFoundError } from "@weaveforge/core";
import { typedCore } from "@/lib/rust-core";

/** How often a write re-reads and re-applies when the file changed under it. */
const WRITE_ATTEMPTS = 5;
const SUFFIX = ".annotations.json";
const DEFAULT_COLOR = "#ffd400";

type Row = Record<string, unknown>;

/**
 * A paper's reader annotations as one workspace file (files-first L2): the sidecar
 * next to the paper file, under its name (`x.paper.md` -> `x.annotations.json`).
 * No database, and no id in the path: `paperFileOf` gives the paper's file, so a
 * paper renamed in another editor keeps its annotations when the sidecar moves with it.
 *
 * Every change reads the file, applies itself to what is there and writes only if
 * the file is still what it read (`writeTextIf`); otherwise it reads again and
 * re-applies. So an annotation added or edited outside the app between a read and
 * a write is kept. Parsing and rendering are the Rust `parseAnnotationsFile` /
 * `renderAnnotationsFile` (rows sorted by id, keys the app does not know kept).
 */
export class FileReaderAnnotationRepository implements IReaderAnnotationSource, IReaderAnnotationSink {
  constructor(
    private readonly fs: IWorkspaceFs,
    private readonly projectRoot: string,
    private readonly paperFileOf: (paperId: string) => Promise<string | null>,
  ) {}

  async list(paperId: string): Promise<ReaderAnnotation[]> {
    const path = await this.path(paperId);
    if (!path) return [];
    const { rows } = await this.read(path);
    return (rows as unknown as ReaderAnnotation[]).sort((a, b) =>
      String(a.sortIndex).localeCompare(String(b.sortIndex)),
    );
  }

  async create(paperId: string, draft: NewReaderAnnotation): Promise<ReaderAnnotation> {
    const core = typedCore();
    if (!core.isReaderAnnotationType(draft.type)) {
      throw new Error(`Invalid annotation type: ${draft.type}`);
    }
    const now = new Date().toISOString();
    const annotation: ReaderAnnotation = {
      id: draft.id ?? `local-ann-${crypto.randomUUID()}`,
      origin: "local",
      zoteroKey: null,
      type: draft.type,
      color: draft.color.trim() || DEFAULT_COLOR,
      text: draft.text?.trim() ?? "",
      comment: draft.comment?.trim() ?? "",
      tags: [...(draft.tags ?? [])],
      anchor: structuredClone(draft.anchor),
      sortIndex: draft.sortIndex?.trim() || core.buildAnnotationSortIndex(draft.pageIndex, 0, 0),
      createdAt: now,
      updatedAt: now,
      syncState: "local",
    };
    const path = await this.path(paperId);
    if (!path) throw new NotFoundError(`Paper ${paperId} not found`);
    await this.change(path, (rows) => {
      if (rows.some((row) => row.id === annotation.id)) {
        throw new ConflictError(`Annotation ${annotation.id} already exists`);
      }
      return [...rows, toRow(annotation)];
    });
    return annotation;
  }

  async update(id: string, patch: ReaderAnnotationPatch): Promise<ReaderAnnotation> {
    const path = await this.pathOf(id);
    if (!path) throw new NotFoundError("Annotation not found");
    let updated = null as ReaderAnnotation | null;
    await this.change(path, (rows) =>
      rows.map((row) => {
        if (row.id !== id) return row;
        const existing = row as unknown as ReaderAnnotation;
        updated = {
          ...existing,
          color: patch.color !== undefined ? patch.color.trim() || DEFAULT_COLOR : existing.color,
          text: patch.text !== undefined ? patch.text.trim() : existing.text,
          comment: patch.comment !== undefined ? patch.comment.trim() : existing.comment,
          tags: patch.tags ? [...patch.tags] : existing.tags,
          anchor: patch.anchor ? structuredClone(patch.anchor) : existing.anchor,
          sortIndex: patch.sortIndex?.trim() || existing.sortIndex,
          syncState: "pending",
          updatedAt: new Date().toISOString(),
        };
        return toRow(updated);
      }),
    );
    if (!updated) throw new NotFoundError("Annotation not found");
    return updated;
  }

  async remove(id: string): Promise<void> {
    const path = await this.pathOf(id);
    if (path) await this.change(path, (rows) => rows.filter((row) => row.id !== id));
  }

  /** The sidecar of the paper's file, or null when no file holds that paper. */
  private async path(paperId: string): Promise<string | null> {
    const paperPath = await this.paperFileOf(paperId);
    return paperPath ? typedCore().annotationsFilePath(paperPath) : null;
  }

  /**
   * Applies `edit` to the rows on disk and writes them only if the file is still
   * the text it read; otherwise reads the newer file and applies `edit` again.
   */
  private async change(path: string, edit: (rows: Row[]) => Row[]): Promise<void> {
    for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt += 1) {
      const { text, rows } = await this.read(path);
      const next = typedCore().renderAnnotationsFile(edit(rows));
      if (await this.writeIf(path, next, text)) return;
    }
    throw new ConflictError(`${path} kept changing on disk; not saved.`);
  }

  private async read(path: string): Promise<{ text: string | null; rows: Row[] }> {
    if (!(await this.fs.stat(path))) return { text: null, rows: [] };
    const text = await this.fs.readText(path);
    return { text, rows: typedCore().parseAnnotationsFile(text) };
  }

  /** Writes only if the file is still `expected`; without `writeTextIf` it refuses. */
  private async writeIf(path: string, text: string, expected: string | null): Promise<boolean> {
    if (!this.fs.writeTextIf) {
      throw new Error(`${path}: this workspace has no conditional write; not saved.`);
    }
    if (expected === null) await this.fs.mkdirp(path.slice(0, path.lastIndexOf("/")));
    return this.fs.writeTextIf(path, text, expected);
  }

  /** The annotations file that holds `id`, if any; refuses when more than one does. */
  private async pathOf(id: string): Promise<string | null> {
    const dir = typedCore().entityDir("paper", this.projectRoot);
    if (!(await this.fs.stat(dir))) return null;
    const paths: string[] = [];
    for await (const entry of this.fs.walk(dir)) {
      if (!entry.path.endsWith(SUFFIX)) continue;
      try {
        const { rows } = await this.read(entry.path);
        if (rows.some((row) => row.id === id)) paths.push(entry.path);
      } catch {
        // A broken file holds nothing this repository can change.
      }
    }
    if (paths.length > 1) {
      throw new ConflictError(`Annotation ${id} is in more than one file (${paths.join(", ")}); not saved.`);
    }
    return paths[0] ?? null;
  }
}

/** An annotation as a file row: absent optional fields are left out. */
function toRow(annotation: ReaderAnnotation): Row {
  return JSON.parse(JSON.stringify(annotation)) as Row;
}
