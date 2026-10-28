import { RowButton } from "./controls";
/**
 * The palette's last resort: a search that finds nothing is often a note that
 * should exist. A blank query names no note, so it offers nothing.
 */
export function JumpToCreateRow({ query, onCreate }: { query: string; onCreate: () => void }) {
  const title = query.trim();
  if (!title) return null;
  return (
    <li>
      <RowButton className="jump-to-create" onClick={onCreate}>
        Create note “{title}”
      </RowButton>
    </li>
  );
}
