/**
 * Flat list -> nested tree, once.
 *
 * Reading lists, report sections and vault pages each carry a `parentId` and a
 * `sortOrder`, and each had its own copy of the same twenty lines: index by id,
 * attach children to parents, collect the orphans as roots, then sort every
 * level recursively. The shapes of the nodes differ; the algorithm does not.
 */
export interface TreeShape<T, N> {
  /** The id of an item, used to resolve `parentId` references. */
  id(item: T): string;
  /** The parent this item hangs under, or undefined/null for a root. */
  parentId(item: T): string | undefined | null;
  /** Wrap an item in its (initially childless) node. */
  node(item: T): N;
  /** Sibling order within one level. */
  compare(a: N, b: N): number;
}

export function buildTree<T, N extends { children: N[] }>(
  items: readonly T[],
  shape: TreeShape<T, N>,
): N[] {
  const nodes = new Map<string, N>();
  const parents = new Map<N, string | undefined | null>();
  for (const item of items) {
    const node = shape.node(item);
    nodes.set(shape.id(item), node);
    parents.set(node, shape.parentId(item));
  }
  const roots: N[] = [];
  for (const node of nodes.values()) {
    const parentId = parents.get(node);
    const parent = parentId ? nodes.get(parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  // A parent loop in the data leaves its nodes unreachable from any root. Cut
  // each loop at one node, which becomes a root, so nothing silently vanishes.
  const reached = new Set<N>();
  const reach = (node: N) => {
    if (reached.has(node)) return;
    reached.add(node);
    for (const child of node.children) reach(child);
  };
  for (const root of roots) reach(root);
  const parentOf = (node: N) => nodes.get(parents.get(node) as string)!;
  for (const start of nodes.values()) {
    if (reached.has(start)) continue;
    // Unreached means every ancestor exists, so walking up must repeat.
    const seen = new Set<N>();
    let onLoop = start;
    while (!seen.has(onLoop)) {
      seen.add(onLoop);
      onLoop = parentOf(onLoop);
    }
    const siblings = parentOf(onLoop).children;
    siblings.splice(siblings.indexOf(onLoop), 1);
    roots.push(onLoop);
    reach(onLoop);
  }
  const sortLevel = (level: N[]) => {
    level.sort(shape.compare);
    for (const child of level) sortLevel(child.children);
  };
  sortLevel(roots);
  return roots;
}

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
