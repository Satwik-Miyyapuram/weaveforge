//! Groups the AI review queue's pending proposals, ported from
//! `apps/web/src/features/ai-assistant/application/proposal-groups.ts`. Pure: no I/O.
//!
//! Groups come back as indices into the input, so the caller keeps its own item objects.

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

/// Key prefix for a document group whose target is unknown.
pub const KIND_GROUP_PREFIX: &str = "kind:";

/// How the review queue groups pending proposals.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProposalGrouping {
    /// By the resource the proposal changes.
    Document,
    /// By the proposal's kind.
    Kind,
}

/// The fields grouping reads from a pending proposal.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ProposalRef {
    /// The proposal kind, such as `append_paper_note`.
    pub kind: String,
    /// The resource the proposal targets.
    pub resource_id: String,
}

/// One group: its key and the input indices it holds, in queue order.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ProposalGroup {
    /// The resource id or `kind:<kind>` (document), or the kind (kind).
    pub key: String,
    /// Indices into the input list, in queue order.
    #[cfg_attr(feature = "specta", specta(type = Vec<u32>))]
    pub indices: Vec<usize>,
}

/// Groups in the order their first proposal appears; members keep queue order.
///
/// By document, a resource id not in `known_ids` (a "create" suggestion's fresh id, or a
/// target not in the catalog) is grouped under `kind:<kind>` instead. With no `known_ids`,
/// every resource id keeps its own group.
#[must_use]
pub fn group_proposals(
    items: &[ProposalRef],
    by: ProposalGrouping,
    known_ids: Option<&[String]>,
) -> Vec<ProposalGroup> {
    let known: Option<HashSet<&str>> =
        known_ids.map(|ids| ids.iter().map(String::as_str).collect());
    let mut groups: Vec<ProposalGroup> = Vec::new();
    let mut slot: HashMap<String, usize> = HashMap::new();
    for (index, item) in items.iter().enumerate() {
        let key = match by {
            ProposalGrouping::Kind => item.kind.clone(),
            ProposalGrouping::Document => match &known {
                Some(set) if !set.contains(item.resource_id.as_str()) => {
                    format!("{KIND_GROUP_PREFIX}{}", item.kind)
                }
                _ => item.resource_id.clone(),
            },
        };
        match slot.get(&key) {
            Some(&at) => groups[at].indices.push(index),
            None => {
                let _ = slot.insert(key.clone(), groups.len());
                groups.push(ProposalGroup {
                    key,
                    indices: vec![index],
                });
            }
        }
    }
    groups
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(kind: &str, resource_id: &str) -> ProposalRef {
        ProposalRef {
            kind: kind.to_owned(),
            resource_id: resource_id.to_owned(),
        }
    }

    #[test]
    fn unknown_targets_group_under_their_kind() {
        let items = [
            item("create_log_entry", "rand-1"),
            item("append_paper_note", "paper-1"),
            item("create_log_entry", "rand-2"),
        ];
        let known = vec!["paper-1".to_owned()];
        let groups = group_proposals(&items, ProposalGrouping::Document, Some(&known));
        let shape: Vec<(&str, Vec<usize>)> = groups
            .iter()
            .map(|g| (g.key.as_str(), g.indices.clone()))
            .collect();
        assert_eq!(
            shape,
            vec![("kind:create_log_entry", vec![0, 2]), ("paper-1", vec![1])]
        );
    }

    #[test]
    fn by_kind_ignores_known_ids() {
        let items = [item("relation", "paper-2"), item("relation", "paper-9")];
        let groups = group_proposals(&items, ProposalGrouping::Kind, None);
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].key, "relation");
        assert_eq!(groups[0].indices, vec![0, 1]);
    }

    #[test]
    fn no_lookup_keeps_resource_ids() {
        let items = [
            item("a", "paper-1"),
            item("b", "paper-2"),
            item("c", "paper-1"),
        ];
        let keys: Vec<String> = group_proposals(&items, ProposalGrouping::Document, None)
            .into_iter()
            .map(|g| g.key)
            .collect();
        assert_eq!(keys, vec!["paper-1", "paper-2"]);
    }
}
