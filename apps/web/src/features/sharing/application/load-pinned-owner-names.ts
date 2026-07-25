import { getContainer } from "@/bootstrap";
import { buildMemberNameMap } from "./member-labels";

/** Resolve display names for pinned/shared resource owners (DRY across screens). */
export async function loadPinnedOwnerNames(
  pinnedSharedBy: Map<string, string>,
): Promise<Map<string, string>> {
  if (pinnedSharedBy.size === 0) return new Map();
  const dir = await getContainer().sharing.listDirectory();
  const names = buildMemberNameMap(dir);
  for (const ownerId of new Set(pinnedSharedBy.values())) {
    if (!names.has(ownerId)) names.set(ownerId, "Member");
  }
  return names;
}
