/**
 * The open-thread count beside every comments entry, the same on a card's
 * sheet toggle and a record page's inline section (D-25). Nothing at zero:
 * "None" read as a broken label.
 */
export function CommentsBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="comments-badge" aria-label={`${count} open`}>
      {count}
    </span>
  );
}
