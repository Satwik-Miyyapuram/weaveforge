import type { ShareableType } from "../../../shared/core-contract.js";
import { rust } from "../../../shared/rust.js";
import type { IShareRepository } from "../../sharing/domain/parts.js";
import type { ILibraryPinRepository } from "../domain/parts.js";
import {
  type LibraryPin,
  LibraryPinError,
  type NewLibraryPinInput,
} from "../domain/parts.js";
import { mergePinnedScreenData, type PinnedScreenMerge } from "./merge-pinned-screen-data.js";

// --- load-pinned-screen-data ---
/**
 * The two reads every pinned screen makes before merging, and the merge itself.
 *
 * Six screens each wrote the same preamble — fetch this project's pins, fetch
 * the shares addressed to me of `resourceType`, fall back to an empty list when
 * either repository is absent — and then passed the same resource type to
 * `mergePinnedScreenData` one line later. The resource type appearing twice is
 * the part worth removing: a screen that spells it differently in the two places
 * merges against another type's shares, and both calls succeed, so the symptom
 * is a screen whose comment and edit rights are quietly wrong rather than an
 * error.
 *
 * The optional repositories stay optional: papers are pinned and shared, and a
 * deployment with no sharing at all is a supported configuration, not a broken
 * one.
 */
export interface PinnedScreenSources {
  pins?: Pick<ILibraryPinRepository, "listForProject">;
  shares?: Pick<IShareRepository, "listSharedWithMe">;
}

export async function loadPinnedScreenData<
  TSummary extends { id: string },
  TFull extends TSummary,
>(
  sources: PinnedScreenSources,
  input: {
    resourceType: ShareableType;
    owned: readonly TSummary[];
    loadById: (id: string) => Promise<TFull | null>;
  },
): Promise<PinnedScreenMerge<TSummary>> {
  const [pins, shares] = await Promise.all([
    sources.pins?.listForProject() ?? Promise.resolve([]),
    sources.shares?.listSharedWithMe(input.resourceType) ?? Promise.resolve([]),
  ]);

  return mergePinnedScreenData({ ...input, pins, shares });
}

// --- pin-shared-resource.use-case ---
export interface PinSharedResourceDeps {
  pins: ILibraryPinRepository;
  shares: IShareRepository;
}

export class PinSharedResourceUseCase {
  constructor(private readonly deps: PinSharedResourceDeps) {}

  async execute(input: NewLibraryPinInput): Promise<LibraryPin> {
    const shares = await this.deps.shares.listSharedWithMe(input.resourceType);
    const allowed = shares.some((s) =>
      rust().shareCoversResource(s, input.resourceType, input.resourceId, input.ownerId),
    );
    if (!allowed) {
      throw new LibraryPinError("This item is not shared with you.");
    }
    return this.deps.pins.pin(input);
  }
}
