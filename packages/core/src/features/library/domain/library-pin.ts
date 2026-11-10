import type { Identifiable } from "../../../shared/repository.js";
import type { ShareableType } from "../../../shared/core-contract.js";
import { PermissionError } from "../../../shared/errors.js";

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

export class LibraryPinError extends PermissionError {
  constructor(message: string) {
    super(message);
    this.name = "LibraryPinError";
  }
}
