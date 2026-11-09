//! Who else is in a shared document (TS apps/web collab/domain/presence.ts).

use std::collections::HashSet;

use serde_json::Value;

/// Someone else in a document, as the presence avatars show them (TS `Peer`).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
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
}
