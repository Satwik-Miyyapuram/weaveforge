import type {
  AnnotationPin,
  IAnnotationPinRepository,
  IWorkspaceFs,
  SaveAnnotationPinInput,
} from "@weaveforge/core";
import { typedCore } from "@/lib/rust-core";

const ANNOTATIONS_SUFFIX = ".annotations.json";
const PINS_SUFFIX = ".pins.json";
const MAX_EDIT_ATTEMPTS = 5;

/** One row of `<stem>.pins.json`, as the Rust exporter writes it (`PinRow`). */
interface PinRow {
  annotation_key: string;
  report_section_id: string | null;
  created_at: string;
}

/** The papers that have a pins file; the repository never walks the disk itself. */
export interface IPinPaperSource {
  listPaperIds(): Promise<string[]>;
}

/**
 * Annotation pins as one sidecar per paper (files-first 0.9.3): the sidecar of the
 * paper's PDF (`x.pdf` -> `x.pins.json`), a bare array of rows. No database.
 */
export class FileAnnotationPinRepository implements IAnnotationPinRepository {
  /** The last queued edit per pins file path. */
  private readonly tails = new Map<string, Promise<unknown>>();

  constructor(
    private readonly fs: IWorkspaceFs,
    private readonly projectRoot: string,
    private readonly papers: IPinPaperSource,
  ) {}

  async save({ paperId, annotationKey, reportSectionId }: SaveAnnotationPinInput): Promise<AnnotationPin> {
    return this.edit(paperId, (rows) => {
      let row = rows.find((r) => r.annotation_key === annotationKey);
      if (row) {
        row.report_section_id = reportSectionId;
      } else {
        row = { annotation_key: annotationKey, report_section_id: reportSectionId, created_at: new Date().toISOString() };
        rows.push(row);
      }
      return { rows, result: toPin(paperId, row) };
    });
  }

  async remove(paperId: string, annotationKey: string): Promise<void> {
    await this.edit(paperId, (rows) => {
      const kept = rows.filter((row) => row.annotation_key !== annotationKey);
      return { rows: kept.length === rows.length ? null : kept, result: undefined };
    });
  }

  async listForProject(): Promise<AnnotationPin[]> {
    const perPaper = await Promise.all((await this.papers.listPaperIds()).map((id) => this.listForPaper(id)));
    return perPaper.flat();
  }

  async listForPaper(paperId: string): Promise<AnnotationPin[]> {
    const rows = await this.read(this.path(paperId));
    return rows.map((row) => toPin(paperId, row));
  }

  async listForSection(reportSectionId: string): Promise<AnnotationPin[]> {
    const pins = await this.listForProject();
    return pins.filter((pin) => pin.reportSectionId === reportSectionId);
  }

  /** `x.annotations.json` next to the PDF becomes `x.pins.json`. */
  private path(paperId: string): string {
    const annotations = typedCore().annotationsFilePath(paperId, this.projectRoot);
    return annotations.slice(0, -ANNOTATIONS_SUFFIX.length) + PINS_SUFFIX;
  }

  private async read(path: string): Promise<PinRow[]> {
    if (!(await this.fs.stat(path))) return [];
    return parsePins(path, await this.fs.readText(path));
  }

  /**
   * One read-modify-write of a paper's pins. Edits to the same file run one after another
   * (a save read before another save wrote would drop that save's row), and each write is
   * conditional on the text it was based on, so a change from outside is retried, not lost.
   * `change` returns `rows: null` when nothing needs writing.
   */
  private edit<T>(paperId: string, change: (rows: PinRow[]) => { rows: PinRow[] | null; result: T }): Promise<T> {
    const path = this.path(paperId);
    const run = (this.tails.get(path) ?? Promise.resolve()).then(() => this.editFile(path, change));
    this.tails.set(path, run.catch(() => undefined));
    return run;
  }

  private async editFile<T>(path: string, change: (rows: PinRow[]) => { rows: PinRow[] | null; result: T }): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      const text = (await this.fs.stat(path)) ? await this.fs.readText(path) : null;
      const { rows, result } = change(text === null ? [] : parsePins(path, text));
      if (rows === null) return result;
      if (await this.writeIfUnchanged(path, JSON.stringify(rows, null, 2), text)) return result;
      if (attempt >= MAX_EDIT_ATTEMPTS) throw new Error(`pins file kept changing during the save (${path})`);
    }
  }

  private async writeIfUnchanged(path: string, text: string, expected: string | null): Promise<boolean> {
    await this.fs.mkdirp(path.slice(0, path.lastIndexOf("/")));
    if (this.fs.writeTextIf) return this.fs.writeTextIf(path, text, expected);
    await this.fs.writeFile(path, text);
    return true;
  }
}

/** Throws rather than dropping rows: a silently skipped row would be lost on the next write. */
function parsePins(path: string, text: string): PinRow[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`pins file is not valid (${path}): not JSON`);
  }
  if (!Array.isArray(parsed) || !parsed.every(isPinRow)) {
    throw new Error(`pins file is not valid (${path}): expected an array of pin rows`);
  }
  return parsed;
}

function isPinRow(value: unknown): value is PinRow {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.annotation_key === "string" &&
    (row.report_section_id === null || typeof row.report_section_id === "string") &&
    typeof row.created_at === "string"
  );
}

/**
 * A file row as a pin. 0.9.2 `annotation_pins.report_section_id` is NOT NULL, so a null
 * here means a damaged file: refuse it rather than pass a null through as a string.
 */
function toPin(paperId: string, row: PinRow): AnnotationPin {
  if (row.report_section_id === null) {
    throw new Error(`pins file is not valid: pin ${row.annotation_key} has no report section`);
  }
  return {
    id: `${paperId}:${row.annotation_key}`,
    paperId,
    annotationKey: row.annotation_key,
    reportSectionId: row.report_section_id,
    createdAt: row.created_at,
  };
}
