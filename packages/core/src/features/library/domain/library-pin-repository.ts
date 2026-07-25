import type { ShareableType } from "../../sharing/domain/share.js";
import type { LibraryPin, NewLibraryPinInput } from "./library-pin.js";

export interface ILibraryPinRepository {
  pin(input: NewLibraryPinInput): Promise<LibraryPin>;
  unpin(resourceType: ShareableType, resourceId: string): Promise<void>;
  listForProject(): Promise<LibraryPin[]>;
  isPinned(resourceType: ShareableType, resourceId: string): Promise<boolean>;
}
