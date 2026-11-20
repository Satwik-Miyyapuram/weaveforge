//! Who else is in a shared document (TS apps/web collab/domain/presence.ts).

use std::collections::HashSet;

use serde_json::Value;

use crate::sync::text_diff::{DiffOp, diff_body};

/// Someone else in a document, as the presence avatars show them (TS `Peer`).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct Peer {
    /// Account id, or `client:<n>` for a client that sent none.
    pub key: String,
    /// Display name.
    pub name: String,
    /// CSS colour.
    pub color: String,
}

/// JS truthiness for a JSON value.
fn truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().is_some_and(|f| f != 0.0),
        Value::String(s) => !s.is_empty(),
        Value::Array(_) | Value::Object(_) => true,
    }
}

/// A non-empty string field of `user`.
fn text<'a>(user: &'a Value, key: &str) -> Option<&'a str> {
    user.get(key)
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
}

/// Awareness users (`[clientId, state.user]`, in map order) → one entry per other person.
/// Your own client and your other sessions are left out; one person in two windows shows once.
#[must_use]
#[allow(clippy::float_cmp)]
pub fn peers_from_states(
    users: &[(f64, Value)],
    self_client_id: f64,
    self_author_id: &str,
) -> Vec<Peer> {
    let mut seen = HashSet::new();
    let mut peers = Vec::new();
    for (client_id, user) in users {
        if *client_id == self_client_id || !truthy(user) {
            continue;
        }
        let id = text(user, "id");
        if id == Some(self_author_id) {
            continue;
        }
        let key = id.map_or_else(|| format!("client:{client_id}"), str::to_owned);
        if !seen.insert(key.clone()) {
            continue;
        }
        peers.push(Peer {
            key,
            name: text(user, "name").unwrap_or("Someone").to_owned(),
            color: text(user, "color").unwrap_or("var(--accent)").to_owned(),
        });
    }
    peers
}

/// True when both lists show the same people the same way.
#[must_use]
pub fn same_peers(a: &[Peer], b: &[Peer]) -> bool {
    a == b
}

/// When a collaborative editor may write its document back over the saved body (TS `shouldPersistBody`).
///
/// Never before the CRDT log is replayed and the seed has run, because an empty
/// document would overwrite a real body. Never when the text is the saved text,
/// because that would re-save what the server already has.
#[must_use]
pub fn should_persist_body(ready: bool, next: &str, last_saved: &str) -> bool {
    ready && next != last_saved
}

/// One line step of a plan that turns one text into another.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(tag = "op", rename_all = "lowercase")]
pub enum TextOp {
    /// A line both texts have, at this point.
    Keep {
        /// The line, without its line break.
        text: String,
    },
    /// A line only the base text has.
    Delete {
        /// The line, without its line break.
        text: String,
    },
    /// A line only the new text has.
    Insert {
        /// The line, without its line break.
        text: String,
    },
}

/// The line steps that turn a base text into the theirs text.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct DiffPlan {
    /// The steps, in document order.
    pub ops: Vec<TextOp>,
}

/// Plans the line edits that turn `base` into `theirs`. Pure planning on the body line diff
/// (`sync::text_diff`); the caller applies the plan and writes the result.
#[must_use]
pub fn collab_diff_plan(base: &str, theirs: &str) -> DiffPlan {
    let ops = diff_body(base, theirs)
        .lines
        .into_iter()
        .map(|line| match line.op {
            DiffOp::Same => TextOp::Keep { text: line.text },
            DiffOp::Ours => TextOp::Delete { text: line.text },
            DiffOp::Theirs => TextOp::Insert { text: line.text },
        })
        .collect();
    DiffPlan { ops }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn skips_self_own_sessions_and_duplicates() {
        let users = vec![
            (1.0, json!({ "id": "x", "name": "Self client" })),
            (2.0, json!({ "id": "me", "name": "Me elsewhere" })),
            (3.0, json!({ "id": "ann", "name": "Ann", "color": "#f00" })),
            (4.0, json!({ "id": "ann", "name": "Ann again" })),
            (5.0, json!({ "name": "" })),
            (6.0, Value::Null),
        ];
        let peers = peers_from_states(&users, 1.0, "me");
        assert_eq!(
            peers,
            vec![
                Peer {
                    key: "ann".into(),
                    name: "Ann".into(),
                    color: "#f00".into()
                },
                Peer {
                    key: "client:5".into(),
                    name: "Someone".into(),
                    color: "var(--accent)".into()
                },
            ]
        );
    }

    #[test]
    fn same_peers_compares_every_field() {
        let a = vec![Peer {
            key: "k".into(),
            name: "n".into(),
            color: "c".into(),
        }];
        assert!(same_peers(&a, &a.clone()));
        assert!(!same_peers(&a, &[]));
    }

    /// Joins the texts a plan keeps or deletes, which must rebuild `base`.
    fn base_of(plan: &DiffPlan) -> String {
        plan.ops
            .iter()
            .filter_map(|op| match op {
                TextOp::Keep { text } | TextOp::Delete { text } => Some(text.as_str()),
                TextOp::Insert { .. } => None,
            })
            .collect::<Vec<_>>()
            .join("\n")
    }

    /// Joins the texts a plan keeps or inserts, which must rebuild `theirs`.
    fn theirs_of(plan: &DiffPlan) -> String {
        plan.ops
            .iter()
            .filter_map(|op| match op {
                TextOp::Keep { text } | TextOp::Insert { text } => Some(text.as_str()),
                TextOp::Delete { .. } => None,
            })
            .collect::<Vec<_>>()
            .join("\n")
    }

    #[test]
    fn identical_texts_plan_only_keeps() {
        let plan = collab_diff_plan("a\nb\n", "a\nb\n");
        assert!(plan.ops.iter().all(|op| matches!(op, TextOp::Keep { .. })));
    }

    #[test]
    fn insertion_and_deletion_are_planned() {
        let plan = collab_diff_plan("one\ntwo\n", "one\nthree\n");
        assert!(plan.ops.contains(&TextOp::Delete { text: "two".into() }));
        assert!(plan.ops.contains(&TextOp::Insert {
            text: "three".into()
        }));
        assert!(plan.ops.contains(&TextOp::Keep { text: "one".into() }));
    }

    #[test]
    fn empty_base_plans_only_inserts() {
        let plan = collab_diff_plan("", "x\ny");
        assert_eq!(theirs_of(&plan), "x\ny");
        assert!(
            !plan
                .ops
                .iter()
                .any(|op| matches!(op, TextOp::Insert { text } if text.is_empty()))
        );
    }

    #[test]
    fn plan_rebuilds_both_texts_on_generated_inputs() {
        // Deterministic LCG, so the property run is the same every time.
        let mut seed: u64 = 0x9e37_79b9_7f4a_7c15;
        let mut next = move |n: u64| {
            seed = seed
                .wrapping_mul(6_364_136_223_846_793_005)
                .wrapping_add(1_442_695_040_888_963_407);
            (seed >> 33) % n
        };
        let words = ["alpha", "beta", "", "gamma", "delta"];
        for _ in 0..200 {
            let make = |next: &mut dyn FnMut(u64) -> u64| {
                let len = next(8);
                (0..len)
                    .map(|_| words[usize::try_from(next(5)).unwrap_or(0)])
                    .collect::<Vec<_>>()
                    .join("\n")
            };
            let base = make(&mut next);
            let theirs = make(&mut next);
            let plan = collab_diff_plan(&base, &theirs);
            assert_eq!(
                base_of(&plan),
                base.replace("\r\n", "\n").replace('\r', "\n")
            );
            assert_eq!(
                theirs_of(&plan),
                theirs.replace("\r\n", "\n").replace('\r', "\n")
            );
        }
    }
}
