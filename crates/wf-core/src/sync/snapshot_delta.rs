//! Ports `packages/core/src/workspace/snapshot-delta.ts`: `planDelta` and
//! `applyDelta` only. The async `readWithDelta` is I/O and stays in the shell.
//! Ids are compared, not timestamps, so a deleted row is noticed.

use std::collections::{HashMap, HashSet};

/// A row's id and the stamp that changes whenever the row does.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EntityStamp {
    /// Row id.
    pub id: String,
    /// Any value that changes when the row does; compared, never parsed.
    pub updated_at: String,
}

/// What to fetch and what to forget, from comparing held rows with the database.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeltaPlan {
    /// Ids whose rows have to be fetched: new or changed.
    pub fetch: Vec<String>,
    /// Ids held locally that the database no longer has.
    pub drop: Vec<String>,
    /// True when nothing changed and the held rows can be reused as they are.
    pub unchanged: bool,
}

/// Compare what is held against what the database reports.
///
/// `held` is `(id, stamp)` pairs in the order the TypeScript `Map` would hold
/// them: a repeated id keeps its first position and its last stamp.
#[must_use]
pub fn plan_delta(remote: &[EntityStamp], held: &[(String, String)]) -> DeltaPlan {
    let current: HashMap<&str, &str> = held
        .iter()
        .map(|(id, at)| (id.as_str(), at.as_str()))
        .collect();

    let mut fetch = Vec::new();
    let mut seen: HashSet<&str> = HashSet::new();
    for stamp in remote {
        let _ = seen.insert(stamp.id.as_str());
        if current.get(stamp.id.as_str()).copied() != Some(stamp.updated_at.as_str()) {
            fetch.push(stamp.id.clone());
        }
    }

    let mut drop = Vec::new();
    let mut dropped: HashSet<&str> = HashSet::new();
    for (id, _) in held {
        if !seen.contains(id.as_str()) && dropped.insert(id.as_str()) {
            drop.push(id.clone());
        }
    }

    let unchanged = fetch.is_empty() && drop.is_empty();
    DeltaPlan {
        fetch,
        drop,
        unchanged,
    }
}

/// Apply a plan to the rows already held.
///
/// Output follows `order` as the database reported it, not the merge order, so
/// a snapshot does not reshuffle between loads. A fetched row replaces a held
/// one with the same id.
#[must_use]
pub fn apply_delta<T: Clone>(
    held: &[T],
    fetched: &[T],
    order: &[EntityStamp],
    id_of: impl Fn(&T) -> &str,
) -> Vec<T> {
    let mut by_id: HashMap<&str, &T> = HashMap::new();
    by_id.extend(held.iter().chain(fetched).map(|row| (id_of(row), row)));

    order
        .iter()
        .filter_map(|stamp| by_id.get(stamp.id.as_str()).map(|row| (*row).clone()))
        .collect()
}
