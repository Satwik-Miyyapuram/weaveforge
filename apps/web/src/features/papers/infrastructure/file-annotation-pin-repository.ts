import type {
  AnnotationPin,
  IAnnotationPinRepository,
  IWorkspaceFs,
  SaveAnnotationPinInput,
} from "@weaveforge/core";
import { changeJsonRows, readJsonRows } from "@/lib/json-rows-file";

/**
 * A project's annotation pins as one workspace file (files-first L1):
 * `<project>/.weaveforge/annotation-pins.json`, next to `relations.json`. No database.
 *
 * One row per (paperId, annotationKey); saving that pair again moves it to the new
 * section and keeps its id and createdAt. Every change is a conditional write that
 * re-applies on a newer file, so a pin added outside the app is kept.
 */
export class FileAnnotationPinRepository implements IAnnotationPinRepository {
  private readonly path: string;

  constructor(
    private readonly fs: IWorkspaceFs,
    projectRoot: string,
  ) {
    this.path = `${projectRoot}/.weaveforge/annotation-pins.json`;
  }

  async save(input: SaveAnnotationPinInput): Promise<AnnotationPin> {
    let saved = null as AnnotationPin | null;
    await changeJsonRows(this.fs, this.path, (rows) => {
      const previous = rows.find((row) => samePin(row, input.paperId, input.annotationKey));
      saved = {
        id: typeof previous?.id === "string" ? previous.id : `annotation-pin-${crypto.randomUUID()}`,
        paperId: input.paperId,
        annotationKey: input.annotationKey,
        reportSectionId: input.reportSectionId,
        createdAt: typeof previous?.createdAt === "string" ? previous.createdAt : new Date().toISOString(),
      };
      const next = { ...previous, ...saved };
      return previous ? rows.map((row) => (row === previous ? next : row)) : [...rows, next];
    });
    return saved!;
  }

  async remove(paperId: string, annotationKey: string): Promise<void> {
    await changeJsonRows(this.fs, this.path, (rows) => rows.filter((row) => !samePin(row, paperId, annotationKey)));
  }

  async listForProject(): Promise<AnnotationPin[]> {
    const { rows } = await readJsonRows(this.fs, this.path);
    return rows as unknown as AnnotationPin[];
  }

  async listForPaper(paperId: string): Promise<AnnotationPin[]> {
    return (await this.listForProject()).filter((pin) => pin.paperId === paperId);
  }

  async listForSection(reportSectionId: string): Promise<AnnotationPin[]> {
    return (await this.listForProject()).filter((pin) => pin.reportSectionId === reportSectionId);
  }
}

function samePin(row: Record<string, unknown>, paperId: string, annotationKey: string): boolean {
  return row.paperId === paperId && row.annotationKey === annotationKey;
}
