//! Builds a forest from a flat list of items that name their parent. Port of
//! `buildTree` in `packages/core/src/shared/parts.ts`. Pure.

use std::cmp::Ordering;
use std::collections::HashMap;

/// One item with its children, already sorted.
#[derive(Debug, Clone, PartialEq)]
pub struct TreeNode<T> {
    /// The item at this node.
    pub item: T,
    /// Child nodes, sorted by the caller's comparison.
    pub children: Vec<TreeNode<T>>,
}

/// Arena of slots: one per distinct id, in first-seen order.
struct Arena<T> {
    items: Vec<Option<T>>,
    parents: Vec<Option<usize>>,
    children: Vec<Vec<usize>>,
    roots: Vec<usize>,
}

/// Build a forest. An item whose parent is missing (or empty) is a root. A later
/// item with an id already seen replaces the earlier one in its place. A parent
/// loop is cut at one node, which becomes a root, so nothing vanishes. Every
/// level is sorted with `compare` (stable).
pub fn build_tree<T>(
    items: Vec<T>,
    id: impl Fn(&T) -> &str,
    parent_id: impl Fn(&T) -> Option<&str>,
    compare: impl Fn(&T, &T) -> Ordering,
) -> Vec<TreeNode<T>> {
    let mut arena = link(items, &id, &parent_id);
    cut_loops(&mut arena);
    let Arena {
        mut items,
        mut children,
        mut roots,
        ..
    } = arena;
    sort_level(&mut roots, &items, &mut children, &compare);
    roots
        .into_iter()
        .map(|slot| assemble(slot, &mut items, &mut children))
        .collect()
}

fn link<T>(
    items: Vec<T>,
    id: &impl Fn(&T) -> &str,
    parent_id: &impl Fn(&T) -> Option<&str>,
) -> Arena<T> {
    let mut slot_of: HashMap<String, usize> = HashMap::new();
    let mut slots: Vec<Option<T>> = Vec::new();
    for item in items {
        let key = id(&item).to_owned();
        if let Some(&slot) = slot_of.get(&key) {
            slots[slot] = Some(item);
        } else {
            let _ = slot_of.insert(key, slots.len());
            slots.push(Some(item));
        }
    }
    let parents: Vec<Option<usize>> = slots
        .iter()
        .map(|item| {
            item.as_ref()
                .and_then(parent_id)
                .filter(|parent| !parent.is_empty())
                .and_then(|parent| slot_of.get(parent).copied())
        })
        .collect();
    let mut children = vec![Vec::new(); slots.len()];
    let mut roots = Vec::new();
    for (slot, parent) in parents.iter().enumerate() {
        match parent {
            Some(parent) => children[*parent].push(slot),
            None => roots.push(slot),
        }
    }
    Arena {
        items: slots,
        parents,
        children,
        roots,
    }
}

fn reach(start: usize, children: &[Vec<usize>], reached: &mut [bool]) {
    let mut stack = vec![start];
    while let Some(slot) = stack.pop() {
        if reached[slot] {
            continue;
        }
        reached[slot] = true;
        stack.extend(children[slot].iter().copied());
    }
}

fn cut_loops<T>(arena: &mut Arena<T>) {
    let mut reached = vec![false; arena.items.len()];
    for &root in &arena.roots {
        reach(root, &arena.children, &mut reached);
    }
    for start in 0..arena.items.len() {
        if reached[start] {
            continue;
        }
        // Unreached means every ancestor exists, so walking up must repeat.
        let mut seen = vec![false; arena.items.len()];
        let mut on_loop = start;
        while !seen[on_loop] {
            seen[on_loop] = true;
            let Some(parent) = arena.parents[on_loop] else {
                break;
            };
            on_loop = parent;
        }
        if let Some(parent) = arena.parents[on_loop] {
            arena.children[parent].retain(|&slot| slot != on_loop);
        }
        arena.roots.push(on_loop);
        reach(on_loop, &arena.children, &mut reached);
    }
}

fn sort_level<T>(
    level: &mut [usize],
    items: &[Option<T>],
    children: &mut [Vec<usize>],
    compare: &impl Fn(&T, &T) -> Ordering,
) {
    level.sort_by(|&a, &b| match (&items[a], &items[b]) {
        (Some(a), Some(b)) => compare(a, b),
        _ => Ordering::Equal,
    });
    for &slot in level.iter() {
        let mut kids = std::mem::take(&mut children[slot]);
        sort_level(&mut kids, items, children, compare);
        children[slot] = kids;
    }
}

fn assemble<T>(slot: usize, items: &mut [Option<T>], children: &mut [Vec<usize>]) -> TreeNode<T> {
    let kids = std::mem::take(&mut children[slot]);
    let item = items[slot].take();
    let children = kids
        .into_iter()
        .map(|kid| assemble(kid, items, children))
        .collect();
    // Every slot holds an item until it is assembled, and each is assembled once.
    TreeNode {
        item: item.unwrap_or_else(|| unreachable!("slot assembled twice")),
        children,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    type Row = (&'static str, Option<&'static str>, i32);

    fn ids(nodes: &[TreeNode<Row>]) -> Vec<String> {
        nodes
            .iter()
            .map(|node| {
                let inner = ids(&node.children);
                if inner.is_empty() {
                    node.item.0.to_owned()
                } else {
                    format!("{}({})", node.item.0, inner.join(","))
                }
            })
            .collect()
    }

    fn tree(rows: Vec<Row>) -> Vec<String> {
        ids(&build_tree(rows, |r| r.0, |r| r.1, |a, b| a.2.cmp(&b.2)))
    }

    #[test]
    fn nests_and_sorts_each_level() {
        let rows = vec![
            ("b", None, 2),
            ("a", None, 1),
            ("a2", Some("a"), 2),
            ("a1", Some("a"), 1),
        ];
        assert_eq!(tree(rows), ["a(a1,a2)", "b"]);
    }

    #[test]
    fn missing_or_empty_parent_is_a_root() {
        let rows = vec![("x", Some("gone"), 0), ("y", Some(""), 0)];
        assert_eq!(tree(rows), ["x", "y"]);
    }

    #[test]
    fn cuts_a_parent_loop_at_one_node() {
        let rows = vec![("a", Some("b"), 0), ("b", Some("a"), 0), ("r", None, 0)];
        // `a` is unreached first; walking up from it meets `a` again, so `a` becomes a root.
        assert_eq!(tree(rows), ["r", "a(b)"]);
    }

    #[test]
    fn later_duplicate_id_replaces_earlier_in_place() {
        let rows = vec![("a", None, 0), ("b", None, 0), ("a", Some("b"), 0)];
        assert_eq!(tree(rows), ["b(a)"]);
    }

    #[test]
    fn sort_is_stable() {
        let rows = vec![("p", None, 0), ("q", None, 0), ("r", None, 0)];
        assert_eq!(tree(rows), ["p", "q", "r"]);
    }

    #[test]
    fn self_parent_becomes_a_root() {
        assert_eq!(tree(vec![("s", Some("s"), 0)]), ["s"]);
    }
}
