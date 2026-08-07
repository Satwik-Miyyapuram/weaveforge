import type { SharedItem } from "@/features/sharing/domain/shared-reader";

import type { ShareableType } from "@weaveforge/core";

export function sharedResourceHref(resourceType: ShareableType, resourceId: string): string {
  return sharedItemHref({
    id: resourceId,
    kind: resourceType,
    title: "",
    status: "",
    ownerId: "",
  });
}

/** Deep-link routes for shared items (read-only detail shells). */
export function sharedItemHref(item: SharedItem): string {
  switch (item.kind) {
    case "paper":
      return `/papers?paper=${encodeURIComponent(item.id)}&shared=1`;
    case "experiment":
      return `/experiments?experiment=${encodeURIComponent(item.id)}&shared=1`;
    case "report_section":
      return `/report?section=${encodeURIComponent(item.id)}&shared=1`;
    case "reading_list":
      return `/lists?list=${encodeURIComponent(item.id)}&shared=1`;
    case "milestone":
      return `/plan?milestone=${encodeURIComponent(item.id)}&shared=1`;
    case "vault_page":
      return `/notes?page=${encodeURIComponent(item.id)}&shared=1`;
    default:
      return "/shared";
  }
}

export function sharedItemTypeLabel(kind: SharedItem["kind"]): string {
  if (kind === "vault_page") return "note";
  return kind.replace(/_/g, " ");
}
