"use client";

import { Chip } from "./controls";

/**
 * The chips a note's #hashtags render as, with a delete on each.
 *
 * Papers and vault pages both show this, and both mean the same thing by it:
 * the tags come from the body, so deleting a chip edits the body rather than
 * some separate list. What differs is only which body — so that is the prop.
 */
export function TagChips({
  tags,
  busy,
  onRemove,
}: {
  tags: readonly string[];
  busy: boolean;
  onRemove: (tag: string) => void;
}) {
  if (tags.length === 0) return null;
  return (
    <div className="tag-editor">
      <div className="tag-chips">
        {tags.map((t) => (
          <Chip key={t} onRemove={busy ? undefined : () => onRemove(t)} removeLabel={`Remove #${t}`}>
            #{t}
          </Chip>
        ))}
      </div>
    </div>
  );
}
