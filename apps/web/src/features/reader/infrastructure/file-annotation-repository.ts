import type {
  IReaderAnnotationProjectSource,
  IReaderAnnotationSink,
  IReaderAnnotationSource,
  IReaderAnnotationSyncRecorder,
  IWorkspaceFs,
  NewReaderAnnotation,
  ReaderAnnotation,
  ReaderAnnotationPatch,
  ReaderAnnotationSyncRecord,
  WorkspaceAnnotation,
} from "@weaveforge/core";
import { ConflictError, NotFoundError } from "@weaveforge/core";
import { warnOnce } from "@/lib/error-report/parts";
import { formatError } from "@/lib/format-error";
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
export class FileReaderAnnotationRepository
  implements IReaderAnnotationSource, IReaderAnnotationSink, IReaderAnnotationSyncRecorder, IReaderAnnotationProjectSource
{
  /** `paperFiles` lists every paper file with its id; only `listForProject` needs it. */
  constructor(
    private readonly fs: IWorkspaceFs,
    private readonly projectRoot: string,
    private readonly paperFileOf: (paperId: string) => Promise<string | null>,
    private readonly paperFiles: () => Promise<{ paperId: string; path: string }[]> = async () => [],
  ) {}

  async list(paperId: string): Promise<ReaderAnnotation[]> {
    const path = await this.path(paperId);
    if (!path) return [];
    const { rows } = await this.read(path);
    return (rows as unknown as ReaderAnnotation[]).sort((a, b) =>
      String(a.sortIndex).localeCompare(String(b.sortIndex)),
    );
  }

  /** `createdAt`/`updatedAt` are optional: an import passes the source times; otherwise both are now. */
  async create(
    paperId: string,
    draft: NewReaderAnnotation & { createdAt?: string; updatedAt?: string },
  ): Promise<ReaderAnnotation> {
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
      createdAt: draft.createdAt ?? now,
      updatedAt: draft.updatedAt ?? now,
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
    const { path, unreadable } = await this.pathOf(id);
    if (!path) throw notFound(unreadable);
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
    const { path } = await this.pathOf(id);
    if (path) await this.change(path, (rows) => rows.filter((row) => row.id !== id));
  }

  /**
   * Keeps the Zotero key and version a write-back learned. `syncState` is set only
   * when the row is still the one sent (`ifUpdatedAt`), so a later edit stays owed.
   * `updatedAt` is not bumped: this is bookkeeping, not an edit.
   */
  async recordZoteroSync(id: string, record: ReaderAnnotationSyncRecord): Promise<void> {
    // With the paper id, go straight to its sidecar instead of reading every one.
    const { path, unreadable } =
      record.paperId !== undefined ? { path: await this.path(record.paperId), unreadable: [] } : await this.pathOf(id);
    if (!path) throw notFound(unreadable);
    await this.change(path, (rows) => {
      if (!rows.some((row) => row.id === id)) throw new NotFoundError("Annotation not found");
      return rows.map((row) => {
        if (row.id !== id) return row;
        const unchanged = record.ifUpdatedAt === undefined || row.updatedAt === record.ifUpdatedAt;
        return {
          ...row,
          zoteroKey: record.zoteroKey,
          zoteroVersion: record.zoteroVersion,
          ...(unchanged ? { syncState: record.syncState } : {}),
        };
      });
    });
  }

  /** Every paper's annotations, each with its paper id and page; a sidecar that does not parse is skipped. */
  async listForProject(): Promise<WorkspaceAnnotation[]> {
    const out: WorkspaceAnnotation[] = [];
    for (const { paperId, path } of await this.paperFiles()) {
      let rows: Row[];
      const sidecar = typedCore().annotationsFilePath(path);
      try {
        rows = (await this.read(sidecar)).rows;
      } catch (error) {
        warnOnce("reader", `Skipped ${sidecar}: it could not be read.`, error);
        continue;
      }
      for (const row of rows as unknown as ReaderAnnotation[]) {
        out.push({ ...row, paperId, pageIndex: pageOf(row) });
      }
    }
    return out;
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

  /**
   * The annotations file that holds `id`, if any; refuses when more than one does.
   * `unreadable` names each sidecar that could not be read, with its error, so a
   * caller that finds nothing can say why.
   */
  private async pathOf(id: string): Promise<{ path: string | null; unreadable: string[] }> {
    const dir = typedCore().entityDir("paper", this.projectRoot);
    if (!(await this.fs.stat(dir))) return { path: null, unreadable: [] };
    const paths: string[] = [];
    const unreadable: string[] = [];
    for await (const entry of this.fs.walk(dir)) {
      if (!entry.path.endsWith(SUFFIX)) continue;
      try {
        const { rows } = await this.read(entry.path);
        if (rows.some((row) => row.id === id)) paths.push(entry.path);
      } catch (error) {
        // A broken file holds nothing this repository can change.
        unreadable.push(`${entry.path} (${formatError(error)})`);
      }
    }
    if (paths.length > 1) {
      throw new ConflictError(`Annotation ${id} is in more than one file (${paths.join(", ")}); not saved.`);
    }
    return { path: paths[0] ?? null, unreadable };
  }
}

/** Not found; names the sidecars that could not be read, since the annotation may be in one. */
function notFound(unreadable: readonly string[]): NotFoundError {
  if (unreadable.length === 0) return new NotFoundError("Annotation not found");
  return new NotFoundError(`Annotation not found; these files could not be read: ${unreadable.join(", ")}`);
}

/** The Zotero position's page, else the page the sort index starts with (`00004|…`), else 0. */
function pageOf(annotation: ReaderAnnotation): number {
  const position = annotation.anchor?.zoteroPosition?.pageIndex;
  if (typeof position === "number" && Number.isFinite(position)) return position;
  const fromSort = Number.parseInt(String(annotation.sortIndex ?? ""), 10);
  return Number.isFinite(fromSort) ? fromSort : 0;
}

/** An annotation as a file row: absent optional fields are left out. */
function toRow(annotation: ReaderAnnotation): Row {
  return JSON.parse(JSON.stringify(annotation)) as Row;
}
