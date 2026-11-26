/**
 * Library pins from files. A paper in the folder is pinned by its `pinned: true`
 * frontmatter property, so the pin follows the paper through renames. Every other
 * pin is one row of `.weaveforge/library-pins.json`.
 */
import type { ILibraryPinRepository, IWorkspaceFs, LibraryPin, NewLibraryPinInput, ShareableType } from "@weaveforge/core";
import type { FilePaperRepository } from "@/features/papers/infrastructure/file-paper-repository";
import { changeJsonRows, readJsonRows, type JsonRow } from "@/lib/json-rows-file";

/** The slice of `FilePaperRepository` this needs. */
export type PinnablePapers = Pick<FilePaperRepository, "listPinnedIds" | "setPinned">;

export const LIBRARY_PINS_PATH = ".weaveforge/library-pins.json";

/** Files mode has one local user and one project per folder, so these stay empty. */
const LOCAL = "";

const isPin = (row: JsonRow, type: string, id: string) => row.resourceType === type && row.resourceId === id;

export class FileLibraryPinRepository implements ILibraryPinRepository {
  constructor(
    private readonly papers: PinnablePapers,
    private readonly fs: IWorkspaceFs,
  ) {}

  async pin(input: NewLibraryPinInput & { id?: string; createdAt?: string }): Promise<LibraryPin> {
    const { ownerId, resourceId, resourceType } = input;
    if (resourceType === "paper" && (await this.papers.setPinned(resourceId, true))) {
      return { id: resourceId, userId: LOCAL, projectId: LOCAL, resourceType, resourceId, ownerId, createdAt: "" };
    }
    let saved = null as LibraryPin | null;
    await changeJsonRows(this.fs, LIBRARY_PINS_PATH, (rows) => {
      const previous = rows.find((row) => isPin(row, resourceType, resourceId));
      const row = previous ?? {
        id: input.id ?? `library-pin-${crypto.randomUUID()}`,
        resourceType,
        resourceId,
        ownerId,
        createdAt: input.createdAt ?? new Date().toISOString(),
      };
      saved = toPin(row);
      return previous ? rows : [...rows, row];
    });
    return saved!;
  }

  async unpin(resourceType: ShareableType, resourceId: string): Promise<void> {
    if (resourceType === "paper") await this.papers.setPinned(resourceId, false);
    const { rows } = await readJsonRows(this.fs, LIBRARY_PINS_PATH);
    if (!rows.some((row) => isPin(row, resourceType, resourceId))) return;
    await changeJsonRows(this.fs, LIBRARY_PINS_PATH, (all) =>
      all.filter((row) => !isPin(row, resourceType, resourceId)),
    );
  }

  async listForProject(): Promise<LibraryPin[]> {
    const own = (await this.papers.listPinnedIds()).map((id) => toPin({ id, resourceType: "paper", resourceId: id }));
    const { rows } = await readJsonRows(this.fs, LIBRARY_PINS_PATH);
    const ownIds = new Set(own.map((pin) => pin.resourceId));
    return [...own, ...rows.map(toPin).filter((p) => p.resourceType !== "paper" || !ownIds.has(p.resourceId))];
  }

  async isPinned(resourceType: ShareableType, resourceId: string): Promise<boolean> {
    return (await this.listForProject()).some((p) => p.resourceType === resourceType && p.resourceId === resourceId);
  }
}

function toPin(row: JsonRow): LibraryPin {
  return {
    id: String(row.id),
    userId: LOCAL,
    projectId: LOCAL,
    resourceType: row.resourceType as ShareableType,
    resourceId: String(row.resourceId),
    ownerId: typeof row.ownerId === "string" ? row.ownerId : LOCAL,
    createdAt: typeof row.createdAt === "string" ? row.createdAt : "",
  };
}
