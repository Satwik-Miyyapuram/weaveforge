/**
 * Library pins from files (0.9.7). A pin is the paper's `pinned: true`
 * frontmatter property, so it follows the paper through renames and needs no ids.
 * Only papers can be pinned here; other shareable types are refused until they
 * have their own file form.
 */
import {
  LibraryPinError,
  NotFoundError,
  type ILibraryPinRepository,
  type LibraryPin,
  type NewLibraryPinInput,
  type ShareableType,
} from "@weaveforge/core";
import type { FilePaperRepository } from "@/features/papers/infrastructure/file-paper-repository";

/** The slice of `FilePaperRepository` this needs. */
export type PinnablePapers = Pick<FilePaperRepository, "listPinnedIds" | "setPinned">;

/** Files mode has one local user and one workspace-project, so these stay empty. */
const LOCAL = "";

export class FileLibraryPinRepository implements ILibraryPinRepository {
  constructor(private readonly papers: PinnablePapers) {}

  async pin(input: NewLibraryPinInput): Promise<LibraryPin> {
    assertPaper(input.resourceType);
    const { ownerId, resourceId } = input;
    if (!(await this.papers.setPinned(resourceId, true))) {
      throw new NotFoundError(`Paper ${resourceId} not found; not pinned.`);
    }
    return { id: resourceId, userId: LOCAL, projectId: LOCAL, resourceType: "paper", resourceId, ownerId, createdAt: "" };
  }

  async unpin(resourceType: ShareableType, resourceId: string): Promise<void> {
    assertPaper(resourceType);
    await this.papers.setPinned(resourceId, false);
  }

  async listForProject(): Promise<LibraryPin[]> {
    return (await this.papers.listPinnedIds()).map((id) => ({
      id,
      userId: LOCAL,
      projectId: LOCAL,
      resourceType: "paper",
      resourceId: id,
      ownerId: LOCAL,
      createdAt: "",
    }));
  }

  async isPinned(resourceType: ShareableType, resourceId: string): Promise<boolean> {
    if (resourceType !== "paper") return false;
    return (await this.papers.listPinnedIds()).includes(resourceId);
  }
}

function assertPaper(resourceType: ShareableType): void {
  if (resourceType !== "paper") {
    throw new LibraryPinError(`Only papers can be pinned in files mode, not ${resourceType}.`);
  }
}
