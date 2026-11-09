/**
 * The move guard report sections and vault pages share. Building a tree from
 * a flat list is in the Rust core (wf-core `tree::build_tree`).
 */

/**
 * Refuse to move `id` under `newParent` when `newParent` is `id` itself or one
 * of its descendants: the parent chain would loop and the tree would drop the
 * whole branch.
 *
 * Walks up from `newParent` with `parentOf`, which answers a node's parent id
 * and throws its own error when the node does not exist. A loop already in
 * the data ends the walk quietly: it is not this move's doing.
 */
export async function assertNotUnder(
  id: string,
  newParent: string,
  parentOf: (id: string) => Promise<string | undefined | null>,
  cycleError: () => Error,
): Promise<void> {
  let cursor: string | undefined | null = newParent;
  const seen = new Set<string>();
  while (cursor) {
    if (cursor === id) throw cycleError();
    if (seen.has(cursor)) return;
    seen.add(cursor);
    cursor = await parentOf(cursor);
  }
}
