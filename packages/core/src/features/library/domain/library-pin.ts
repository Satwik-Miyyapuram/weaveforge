import type { Identifiable } from "../../../shared/repository.js";
import type { ShareableType } from "../../sharing/domain/share.js";

export interface LibraryPin extends Identifiable {
  id: string;
  userId: string;
  projectId: string;
  resourceType: ShareableType;
  resourceId: string;
  ownerId: string;
  createdAt: string;
}

export interface NewLibraryPinInput {
  resourceType: ShareableType;
  resourceId: string;
  ownerId: string;
}

export class LibraryPinError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LibraryPinError";
  }
}
