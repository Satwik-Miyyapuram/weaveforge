/**
 * The page an approved `create_vault_note` made, so the card can link to it
 * (E27). Found by title and parent, since the executor returns no id.
 */
export function createdPageOf<P extends { id: string; title: string; parentId?: string | null }>(
  item: { kind: string; payload?: Record<string, unknown> | null },
  pages: readonly P[],
): P | null {
  if (item.kind !== "create_vault_note") return null;
  const title = typeof item.payload?.title === "string" ? item.payload.title.trim() : "";
  if (!title) return null;
  const parent = typeof item.payload?.parentId === "string" ? item.payload.parentId : null;
  return pages.find((page) => page.title === title && (page.parentId ?? null) === parent) ?? null;
}
