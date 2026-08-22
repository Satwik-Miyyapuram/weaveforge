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
  const sortLevel = (level: N[]) => {
    level.sort(shape.compare);
    for (const child of level) sortLevel(child.children);
  };
  sortLevel(roots);
  return roots;
}
