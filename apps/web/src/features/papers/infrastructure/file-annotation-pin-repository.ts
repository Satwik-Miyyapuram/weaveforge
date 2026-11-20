import type {
  AnnotationPin,
  IAnnotationPinRepository,
  IWorkspaceFs,
  SaveAnnotationPinInput,
} from "@weaveforge/core";
import { typedCore } from "@/lib/rust-core";

const ANNOTATIONS_SUFFIX = ".annotations.json";
const PINS_SUFFIX = ".pins.json";

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
  constructor(
    private readonly fs: IWorkspaceFs,
    private readonly projectRoot: string,
    private readonly papers: IPinPaperSource,
  ) {}

  async save({ paperId, annotationKey, reportSectionId }: SaveAnnotationPinInput): Promise<AnnotationPin> {
    const path = this.path(paperId);
    const rows = await this.read(path);
    let row = rows.find((r) => r.annotation_key === annotationKey);
    if (row) {
      row.report_section_id = reportSectionId;
    } else {
      row = { annotation_key: annotationKey, report_section_id: reportSectionId, created_at: new Date().toISOString() };
      rows.push(row);
    }
    await this.write(path, rows);
    return toPin(paperId, row);
  }

  async remove(paperId: string, annotationKey: string): Promise<void> {
    const path = this.path(paperId);
    const rows = await this.read(path);
    const kept = rows.filter((row) => row.annotation_key !== annotationKey);
    if (kept.length !== rows.length) await this.write(path, kept);
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

  private async write(path: string, rows: PinRow[]): Promise<void> {
    await this.fs.mkdirp(path.slice(0, path.lastIndexOf("/")));
    await this.fs.writeFile(path, JSON.stringify(rows, null, 2));
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
