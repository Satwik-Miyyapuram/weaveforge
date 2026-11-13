import { readyCore } from "@/lib/rust-core";
import type { SharedItem } from "@/features/sharing/domain/shared-reader";

import type { ShareableType } from "@weaveforge/core";

export function sharedResourceHref(resourceType: ShareableType, resourceId: string): string {
  return readyCore().sharedResourceHref(resourceType, resourceId);
}

/** Deep-link routes for shared items (read-only detail shells). */
export function sharedItemHref(item: SharedItem): string {
  return readyCore().sharedItemHref(item);
}

export function sharedItemTypeLabel(kind: SharedItem["kind"]): string {
  return readyCore().sharedItemTypeLabel(kind);
}
