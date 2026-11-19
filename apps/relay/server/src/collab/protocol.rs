//! Wire format helpers: the subprotocol token, JSON control frames and y-sync frames.

use serde_json::json;
use yrs::sync::{Message, SyncMessage};
use yrs::updates::decoder::Decode;
use yrs::updates::encoder::Encode;

use crate::collab::Permission;
use crate::collab::lease::LeaseReply;

/// The WebSocket subprotocol name.
pub const SUBPROTOCOL: &str = "wf.v1";

/// The session token from `Sec-WebSocket-Protocol: wf.v1, <token>`.
#[must_use]
pub fn token_from_protocols(header: &str) -> Option<&str> {
    let mut parts = header.split(',').map(str::trim);
    if parts.next()? != SUBPROTOCOL {
        return None;
    }
    parts.next().filter(|token| !token.is_empty())
}

/// A lease text frame from a client.
#[derive(Debug, PartialEq, Eq)]
pub enum Control {
    /// Ask for the write-back lease.
    Acquire {
        /// The asking device.
        device: String,
    },
    /// Extend the write-back lease.
    Renew {
        /// The holding device.
        device: String,
    },
    /// Give the lease up.
    Release {
        /// The holding device.
        device: String,
    },
    /// Final write-back before a closing doc is deleted.
    Final {
        /// The holding device.
        device: String,
    },
}

/// Parses a `lease.*` JSON frame; anything else is `None`.
#[must_use]
pub fn parse_control(text: &str) -> Option<Control> {
    let value: serde_json::Value = serde_json::from_str(text).ok()?;
    let kind = value.get("type")?.as_str()?;
    let device = value.get("device")?.as_str()?;
    if device.is_empty() {
        return None;
    }
    let device = device.to_owned();
    match kind {
        "lease.acquire" => Some(Control::Acquire { device }),
        "lease.renew" => Some(Control::Renew { device }),
        "lease.release" => Some(Control::Release { device }),
        "lease.final" => Some(Control::Final { device }),
        _ => None,
    }
}

/// The JSON text frame for a lease reply.
#[must_use]
pub fn lease_reply_json(reply: &LeaseReply) -> String {
    match reply {
        LeaseReply::Granted { until_ms } => {
            json!({"type": "lease.granted", "until": until_ms}).to_string()
        }
        LeaseReply::Denied { holder, until_ms } => {
            json!({"type": "lease.denied", "holder": holder, "until": until_ms}).to_string()
        }
        LeaseReply::Lost => json!({"type": "lease.lost"}).to_string(),
    }
}

/// The first frame a client gets on join.
#[must_use]
pub fn hello_json(
    epoch: i64,
    format_version: i64,
    permission: Permission,
    read_only: bool,
) -> String {
    json!({
        "type": "hello",
        "epoch": epoch,
        "format_version": format_version,
        "permission": permission.as_str(),
        "read_only": read_only,
    })
    .to_string()
}

/// Tells a client to rejoin at a new epoch.
#[must_use]
pub fn rejoin_json(epoch: i64) -> String {
    json!({"type": "rejoin", "epoch": epoch}).to_string()
}

/// Refuses an update with a reason.
#[must_use]
pub fn denied_json(reason: &str) -> String {
    json!({"type": "denied", "reason": reason}).to_string()
}

/// A bare event frame such as `closing` or `lease.handover`.
#[must_use]
pub fn event_json(kind: &str) -> String {
    json!({"type": kind}).to_string()
}

/// What the server does with a binary y-sync frame.
#[derive(Debug)]
pub enum Incoming {
    /// The peer asks for what we are missing.
    SyncStep1(yrs::StateVector),
    /// Document changes to check, log and apply.
    Update(Vec<u8>),
    /// Awareness: relay to the others, never store.
    Relay,
    /// Auth and custom frames: nothing to do.
    Ignore,
}

/// Decodes one y-sync v1 binary frame; `None` if it does not decode.
#[must_use]
pub fn classify(bytes: &[u8]) -> Option<Incoming> {
    let message = Message::decode_v1(bytes).ok()?;
    Some(match message {
        Message::Sync(SyncMessage::SyncStep1(sv)) => Incoming::SyncStep1(sv),
        Message::Sync(SyncMessage::SyncStep2(update))
        | Message::Sync(SyncMessage::Update(update)) => Incoming::Update(update),
        Message::Awareness(_) | Message::AwarenessQuery => Incoming::Relay,
        Message::Auth(_) | Message::Custom(..) => Incoming::Ignore,
    })
}

/// A y-sync SyncStep1 frame carrying our state vector.
#[must_use]
pub fn sync_step1(sv: &yrs::StateVector) -> Vec<u8> {
    Message::Sync(SyncMessage::SyncStep1(sv.clone())).encode_v1()
}

/// A y-sync SyncStep2 frame carrying the diff the peer is missing.
#[must_use]
pub fn sync_step2(diff: Vec<u8>) -> Vec<u8> {
    Message::Sync(SyncMessage::SyncStep2(diff)).encode_v1()
}

/// A y-sync Update frame carrying one document update.
#[must_use]
pub fn update_frame(update: Vec<u8>) -> Vec<u8> {
    Message::Sync(SyncMessage::Update(update)).encode_v1()
}
