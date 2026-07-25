import type { IShareRepository } from "../../sharing/domain/share-repository.js";
import { shareCoversResource } from "../../sharing/domain/share.js";
import type { ILibraryPinRepository } from "../domain/library-pin-repository.js";
import {
  LibraryPinError,
  type LibraryPin,
  type NewLibraryPinInput,
} from "../domain/library-pin.js";

export interface PinSharedResourceDeps {
  pins: ILibraryPinRepository;
  shares: IShareRepository;
}

export class PinSharedResourceUseCase {
  constructor(private readonly deps: PinSharedResourceDeps) {}

  async execute(input: NewLibraryPinInput): Promise<LibraryPin> {
    const shares = await this.deps.shares.listSharedWithMe(input.resourceType);
    const allowed = shares.some((s) =>
      shareCoversResource(s, input.resourceType, input.resourceId, input.ownerId),
    );
    if (!allowed) {
      throw new LibraryPinError("This item is not shared with you.");
    }
    return this.deps.pins.pin(input);
  }
}
