import type { ShareableType } from "../../../shared/core-contract.js";
import { PermissionError } from "../../../shared/errors.js";
import type { Identifiable } from "../../../shared/parts.js";

// --- library-pin ---
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

// --- library-pin-repository ---
export interface ILibraryPinRepository {
  pin(input: NewLibraryPinInput): Promise<LibraryPin>;
  unpin(resourceType: ShareableType, resourceId: string): Promise<void>;
  listForProject(): Promise<LibraryPin[]>;
  isPinned(resourceType: ShareableType, resourceId: string): Promise<boolean>;
}
