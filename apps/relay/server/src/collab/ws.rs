//! The co-editing socket: checks the caller, then relays and stores Yjs updates.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::{IntoResponse, Response};
use serde_json::json;
use tokio::sync::broadcast;
use yrs::updates::decoder::Decode;
use yrs::{ReadTxn, StateVector, Transact, Update};

use crate::collab::hub::{self, Event, Room, RoomInner};
use crate::collab::lease::LeaseReply;
use crate::collab::protocol::{self, Control, Incoming};
use crate::collab::store::{DocRow, DocStatus};
use crate::collab::update_log::is_safe_item_id;
use crate::collab::{CollabState, Permission};

const STORAGE_FAILED: &str = "Storage failed.";
/// Largest client message the socket accepts; a larger one closes the socket.
pub(crate) const MAX_MESSAGE_BYTES: usize = 2 * 1024 * 1024;
/// Largest awareness (presence) frame relayed to the others; larger ones are dropped.
const MAX_RELAY_BYTES: usize = 64 * 1024;
/// Awareness frames one client may relay per second; the rest are dropped.
const MAX_RELAYS_PER_SEC: u32 = 100;
/// SyncStep1 replies one client may get back to back; one more comes back each second.
const SYNC_STEP1_BURST: i64 = 3;

/// What the socket loop woke up for.
enum Next {
    /// A frame from the client (`None` or an error: the socket is gone).
    Frame(Option<Result<Message, axum::Error>>),
    /// An event from the room.
    Event(Result<Event, broadcast::error::RecvError>),
    /// The grant timer fired: the client's access is re-read even if it sent nothing.
    GrantCheck,
}

/// One connected client's view of the document.
struct Client {
    id: u64,
    user: String,
    permission: Permission,
    read_only: bool,
    client_format: i64,
    format_version: i64,
    /// When the grant was last checked (Unix ms).
    last_check: i64,
    /// Start of the current one-second relay window (Unix ms).
    relay_window: i64,
    /// Awareness frames relayed in the current window.
    relay_count: u32,
    /// How far the SyncStep1 tokens are spent (Unix ms); see `take_sync_slot`.
    sync_spent_to: i64,
}

impl Client {
    fn new(
        id: u64,
        user: String,
        permission: Permission,
        client_format: i64,
        format_version: i64,
        now: i64,
    ) -> Self {
        Self {
            id,
            user,
            permission,
            read_only: read_only_for(permission, client_format, format_version),
            client_format,
            format_version,
            last_check: now,
            relay_window: now,
            relay_count: 0,
            sync_spent_to: now.saturating_sub(SYNC_STEP1_BURST * 1_000),
        }
    }

    /// Takes one SyncStep1 token (burst `SYNC_STEP1_BURST`, one back per second).
    /// Each reply encodes a diff under the room lock, so a flood would stall the room.
    fn take_sync_slot(&mut self, now: i64) -> bool {
        // One token per unspent second, at most the burst.
        let spent_to = self
            .sync_spent_to
            .max(now.saturating_sub(SYNC_STEP1_BURST * 1_000));
        if now.saturating_sub(spent_to) < 1_000 {
            return false;
        }
        self.sync_spent_to = spent_to + 1_000;
        true
    }

    /// Counts one relayed frame against this client's per-second budget.
    fn take_relay_slot(&mut self, now: i64) -> bool {
        if now.saturating_sub(self.relay_window) >= 1_000 {
            self.relay_window = now;
            self.relay_count = 0;
        }
        self.relay_count += 1;
        self.relay_count <= MAX_RELAYS_PER_SEC
    }

    /// Takes a fresh grant check result.
    fn grant(&mut self, permission: Permission, now: i64) {
        self.permission = permission;
        self.read_only = read_only_for(permission, self.client_format, self.format_version);
        self.last_check = now;
    }
}

/// Read-only when the caller may not write, or is on an older format than the doc.
fn read_only_for(permission: Permission, client_format: i64, format_version: i64) -> bool {
    !permission.can_write() || client_format < format_version
}

/// A JSON error reply sent before the socket upgrade.
fn refuse(status: StatusCode, message: &str) -> Response {
    (
        status,
        [(header::CONTENT_TYPE, "text/plain; charset=utf-8")],
        json!({ "error": message }).to_string(),
    )
        .into_response()
}

/// GET /collab/ws/{item_id}?epoch=N&format=F
pub async fn ws_handler(
    State(state): State<Arc<CollabState>>,
    Path(item_id): Path<String>,
    Query(query): Query<HashMap<String, String>>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> Response {
    let token = headers
        .get(header::SEC_WEBSOCKET_PROTOCOL)
        .and_then(|value| value.to_str().ok())
        .and_then(protocol::token_from_protocols);
    let Some(token) = token else {
        return refuse(StatusCode::UNAUTHORIZED, "Not signed in.");
    };
    let Some(user) = state.auth.user_for(token).await else {
        return refuse(StatusCode::UNAUTHORIZED, "Invalid session.");
    };
    // An id that cannot name a log file cannot be a document, so refuse it before any work.
    if !is_safe_item_id(&item_id) {
        return refuse(StatusCode::NOT_FOUND, "No such document.");
    }
    let row = match state.store.load(&item_id).await {
        Ok(Some(row)) => row,
        Ok(None) => return refuse(StatusCode::NOT_FOUND, "No such document."),
        Err(error) => {
            eprintln!("collab load {item_id}: {error}");
            return refuse(StatusCode::INTERNAL_SERVER_ERROR, STORAGE_FAILED);
        }
    };
    if row.kind == "feed" {
        return refuse(StatusCode::CONFLICT, "Feeds are not co-edited.");
    }
    // A closing doc is being deleted: only its owner may still connect (to finish the close).
    if row.status == DocStatus::Closing && row.owner != user {
        return refuse(StatusCode::FORBIDDEN, "No access.");
    }
    let permission = match state.store.access(&item_id, &user).await {
        Ok(Some(permission)) => permission,
        Ok(None) => return refuse(StatusCode::FORBIDDEN, "No access."),
        Err(error) => {
            eprintln!("collab access {item_id}: {error}");
            return refuse(StatusCode::INTERNAL_SERVER_ERROR, STORAGE_FAILED);
        }
    };
    let query_epoch = query
        .get("epoch")
        .and_then(|value| value.parse::<i64>().ok());
    let query_format = query
        .get("format")
        .and_then(|value| value.parse::<i64>().ok());
    ws.protocols([protocol::SUBPROTOCOL])
        .max_message_size(MAX_MESSAGE_BYTES)
        .on_upgrade(move |socket| {
            run_client(
                state,
                row,
                user,
                permission,
                query_epoch,
                query_format,
                socket,
            )
        })
}

/// Joins the room, greets the client, runs the loop, then leaves.
async fn run_client(
    state: Arc<CollabState>,
    row: DocRow,
    user: String,
    permission: Permission,
    query_epoch: Option<i64>,
    query_format: Option<i64>,
    mut socket: WebSocket,
) {
    let item_id = row.item_id.clone();
    let room = match hub::open_room(&state, row).await {
        Ok(room) => room,
        Err(error) => {
            eprintln!("collab open {item_id}: {error}");
            close(&mut socket).await;
            return;
        }
    };
    let id = state.hub.next_client_id();
    let now = state.clock.now_ms();
    // A room evicted since it was opened is refused: the client reconnects and gets a fresh one.
    let Some((mut rx, epoch, format_version)) = hub::admit(&state.hub, &room).await else {
        close(&mut socket).await;
        return;
    };
    let mut client = Client::new(
        id,
        user,
        permission,
        query_format.unwrap_or(format_version),
        format_version,
        now,
    );
    if greet(&mut socket, &client, epoch, query_epoch).await {
        pump(&state, &room, &mut client, &mut socket, &mut rx).await;
    }
    close(&mut socket).await;
    leave(&state, &room).await;
}

/// Sends `rejoin` (stale epoch: false) or `hello` (true).
async fn greet(
    socket: &mut WebSocket,
    client: &Client,
    epoch: i64,
    query_epoch: Option<i64>,
) -> bool {
    if query_epoch.is_some_and(|wanted| wanted != epoch) {
        let _ = send_text(socket, protocol::rejoin_json(epoch)).await;
        return false;
    }
    let hello = protocol::hello_json(
        epoch,
        client.format_version,
        client.permission,
        client.read_only,
    );
    send_text(socket, hello).await
}

/// Relays frames until the client or the room says stop.
async fn pump(
    state: &CollabState,
    room: &Room,
    client: &mut Client,
    socket: &mut WebSocket,
    rx: &mut broadcast::Receiver<Event>,
) {
    // A zero period would panic in `interval`; the floor only guards a misconfiguration.
    let period = state.config.grant_check_every.max(Duration::from_millis(1));
    let mut grant_timer = tokio::time::interval(period);
    // The first tick is immediate, and the grant was just checked at join: skip it.
    let _ = grant_timer.tick().await;
    loop {
        let next = tokio::select! {
            frame = socket.recv() => Next::Frame(frame),
            event = rx.recv() => Next::Event(event),
            _ = grant_timer.tick() => Next::GrantCheck,
        };
        let keep_going = match next {
            Next::Frame(Some(Ok(message))) => {
                on_message(state, room, client, socket, message).await
            }
            Next::Frame(_) => false,
            Next::Event(Ok(event)) => on_event(state, room, client, socket, event).await,
            // A lag can drop the Recheck event a revoke sent, so re-read access now.
            // It also dropped updates, so send the whole document again (F97-P1-2).
            Next::Event(Err(broadcast::error::RecvError::Lagged(_))) => {
                recheck(state, room, client, socket).await && resync(room, socket).await
            }
            Next::Event(Err(broadcast::error::RecvError::Closed)) => false,
            Next::GrantCheck => recheck(state, room, client, socket).await,
        };
        if !keep_going {
            break;
        }
    }
}

/// Handles one frame from the client; false to leave.
async fn on_message(
    state: &CollabState,
    room: &Room,
    client: &mut Client,
    socket: &mut WebSocket,
    message: Message,
) -> bool {
    match message {
        Message::Binary(bytes) => on_binary(state, room, client, socket, bytes.to_vec()).await,
        Message::Text(text) => on_text(state, room, client, socket, text.as_str()).await,
        Message::Close(_) => false,
        Message::Ping(_) | Message::Pong(_) => true,
    }
}

/// Handles one y-sync frame from the client.
async fn on_binary(
    state: &CollabState,
    room: &Room,
    client: &mut Client,
    socket: &mut WebSocket,
    bytes: Vec<u8>,
) -> bool {
    match protocol::classify(&bytes) {
        None | Some(Incoming::Ignore) => true,
        Some(Incoming::SyncStep1(sv)) => {
            if !client.take_sync_slot(state.clock.now_ms()) {
                return true;
            }
            let diff = diff_for(room, &sv).await;
            send(socket, Message::Binary(protocol::sync_step2(diff).into())).await
        }
        Some(Incoming::Relay) => {
            // Presence is not stored, so an oversized or flooding client only costs the others.
            if bytes.len() > MAX_RELAY_BYTES || !client.take_relay_slot(state.clock.now_ms()) {
                return true;
            }
            room.send(Event::Binary {
                from: client.id,
                bytes,
            });
            true
        }
        Some(Incoming::Update(update)) => on_update(state, room, client, socket, update).await,
    }
}

/// Sends the whole document as a sync step 2, for a client whose updates were
/// dropped; y-sync merges it, so what it already had is not doubled.
async fn resync(room: &Room, socket: &mut WebSocket) -> bool {
    let whole = diff_for(room, &StateVector::default()).await;
    send(socket, Message::Binary(protocol::sync_step2(whole).into())).await
}

/// The part of the document the peer is missing.
async fn diff_for(room: &Room, sv: &StateVector) -> Vec<u8> {
    let inner = room.inner.lock().await;
    let txn = inner.doc.transact();
    txn.encode_diff_v1(sv)
}

/// Checks the grant, then logs, applies and broadcasts one document update.
async fn on_update(
    state: &CollabState,
    room: &Room,
    client: &mut Client,
    socket: &mut WebSocket,
    update: Vec<u8>,
) -> bool {
    if !state.hub.is_current(room) {
        // Evicted or replaced (restore): the update would be logged to a room nobody saves.
        let _ = send_text(socket, protocol::denied_json("stale")).await;
        return false;
    }
    let now = state.clock.now_ms();
    if now.saturating_sub(client.last_check) >= state.config.grant_cache_ms {
        match state.store.access(&room.item_id, &client.user).await {
            Ok(Some(permission)) => apply_grant(state, room, client, permission, now).await,
            Ok(None) => {
                let _ = send_text(socket, protocol::denied_json("revoked")).await;
                return false;
            }
            Err(error) => {
                // Fail closed: without a fresh grant check the update is not applied.
                eprintln!("collab access {}: {error}", room.item_id);
                let _ = send_text(socket, protocol::denied_json("storage")).await;
                return false;
            }
        }
    }
    if client.read_only || !client.permission.can_write() {
        return send_text(socket, protocol::denied_json("read-only")).await;
    }
    let outcome = {
        let mut inner = room.inner.lock().await;
        apply_locked(&mut inner, &update)
    };
    match outcome {
        Ok(()) => {
            room.send(Event::Binary {
                from: client.id,
                bytes: protocol::update_frame(update),
            });
            true
        }
        // A restore replaced the room while the grant was checked: leave, as the check above does.
        Err("stale") => {
            let _ = send_text(socket, protocol::denied_json("stale")).await;
            false
        }
        Err(reason) => send_text(socket, protocol::denied_json(reason)).await,
    }
}

/// Decodes, logs and applies one update; the reason string is what the client is told.
fn apply_locked(inner: &mut RoomInner, update: &[u8]) -> Result<(), &'static str> {
    if inner.retired {
        return Err("stale");
    }
    if inner.status == DocStatus::Closing {
        return Err("closing");
    }
    let decoded = Update::decode_v1(update).map_err(|_| "bad-update")?;
    // Applied before logging, so a record that cannot apply never reaches the log
    // (a bad record there would make the doc unrecoverable on restart).
    inner
        .doc
        .transact_mut()
        .apply_update(decoded)
        .map_err(|_| "bad-update")?;
    inner.dirty = true;
    inner.version = inner.version.wrapping_add(1);
    // A failed log write does not stop the broadcast: the doc is dirty, so the
    // full state is saved on the next persist and the change is not lost.
    if let Err(error) = inner.log.append(update) {
        eprintln!("collab log append: {error}");
    }
    Ok(())
}

/// Handles one lease or other text frame from the client.
async fn on_text(
    state: &CollabState,
    room: &Room,
    client: &mut Client,
    socket: &mut WebSocket,
    text: &str,
) -> bool {
    let Some(control) = protocol::parse_control(text) else {
        return true;
    };
    match control {
        Control::Acquire { device } => acquire(state, room, client, socket, &device).await,
        Control::Renew { device } => {
            // A demoted holder cannot extend the lease it no longer may hold.
            if !client.permission.can_hold_lease() {
                return send_text(socket, protocol::lease_reply_json(&LeaseReply::Lost)).await;
            }
            let reply = {
                let mut inner = room.inner.lock().await;
                inner
                    .lease
                    .renew(&device, &client.user, state.clock.now_ms())
            };
            send_text(socket, protocol::lease_reply_json(&reply)).await
        }
        Control::Release { device } => {
            let _ = release_lease(state, room, &device, &client.user).await;
            true
        }
        Control::Final { device } => {
            let (released, closing) = release_lease(state, room, &device, &client.user).await;
            if released
                && closing
                && let Err(error) = hub::close_doc(state, &room.item_id).await
            {
                eprintln!("collab close {}: {error}", room.item_id);
            }
            true
        }
    }
}

/// Applies a fresh grant check. A holder that may no longer hold the lease gives it up here, so
/// its renew is refused and the other clients see the handover.
async fn apply_grant(
    state: &CollabState,
    room: &Room,
    client: &mut Client,
    permission: Permission,
    now: i64,
) {
    client.grant(permission, now);
    if permission.can_hold_lease() {
        return;
    }
    let released = room.inner.lock().await.lease.release_user(&client.user);
    if released {
        if let Err(error) = state.store.set_writer(&room.item_id, None, None).await {
            eprintln!("collab writer {}: {error}", room.item_id);
        }
        room.send(Event::Text(protocol::event_json("lease.handover")));
    }
}

/// Grants or denies the write-back lease to a device.
async fn acquire(
    state: &CollabState,
    room: &Room,
    client: &Client,
    socket: &mut WebSocket,
    device: &str,
) -> bool {
    if !client.permission.can_hold_lease() {
        return send_text(socket, protocol::denied_json("read-only")).await;
    }
    let reply = {
        let mut inner = room.inner.lock().await;
        inner
            .lease
            .acquire(device, &client.user, state.clock.now_ms())
    };
    // Record the holder before telling the client it has the lease. If the record fails, the
    // grant is rolled back so no unrecorded holder blocks other devices.
    if let LeaseReply::Granted { until_ms } = reply
        && let Err(error) = state
            .store
            .set_writer(&room.item_id, Some(device), Some(until_ms))
            .await
    {
        eprintln!("collab writer {}: {error}", room.item_id);
        let _rolled_back = room.inner.lock().await.lease.release(device, &client.user);
        return send_text(socket, protocol::denied_json("storage")).await;
    }
    send_text(socket, protocol::lease_reply_json(&reply)).await
}

/// Clears the lease when `device` and `user` hold it; returns (released, doc is closing).
async fn release_lease(state: &CollabState, room: &Room, device: &str, user: &str) -> (bool, bool) {
    let (released, closing) = {
        let mut inner = room.inner.lock().await;
        let released = inner.lease.release(device, user);
        (released, inner.status == DocStatus::Closing)
    };
    if released {
        if let Err(error) = state.store.set_writer(&room.item_id, None, None).await {
            eprintln!("collab writer {}: {error}", room.item_id);
        }
        room.send(Event::Text(protocol::event_json("lease.handover")));
    }
    (released, closing)
}

/// Handles one room event; false to leave.
async fn on_event(
    state: &CollabState,
    room: &Room,
    client: &mut Client,
    socket: &mut WebSocket,
    event: Event,
) -> bool {
    match event {
        Event::Binary { from, bytes } => {
            from == client.id || send(socket, Message::Binary(bytes.into())).await
        }
        Event::Text(text) => send_text(socket, text).await,
        Event::Close(text) => {
            let _ = send_text(socket, text).await;
            false
        }
        Event::Recheck => recheck(state, room, client, socket).await,
    }
}

/// Re-reads the caller's access after a grant was revoked; false when it is gone.
async fn recheck(
    state: &CollabState,
    room: &Room,
    client: &mut Client,
    socket: &mut WebSocket,
) -> bool {
    let now = state.clock.now_ms();
    match state.store.access(&room.item_id, &client.user).await {
        Ok(Some(permission)) => {
            apply_grant(state, room, client, permission, now).await;
            true
        }
        Ok(None) => {
            let _ = send_text(socket, protocol::denied_json("revoked")).await;
            false
        }
        Err(error) => {
            // Fail closed: a revoke that cannot be checked ends the session.
            eprintln!("collab access {}: {error}", room.item_id);
            let _ = send_text(socket, protocol::denied_json("storage")).await;
            false
        }
    }
}

/// Counts the client out; the last one out saves the document and drops the room.
async fn leave(state: &CollabState, room: &Arc<Room>) {
    let (idle, closing) = {
        let mut inner = room.inner.lock().await;
        inner.clients = inner.clients.saturating_sub(1);
        (inner.clients == 0, inner.status == DocStatus::Closing)
    };
    if !idle {
        return;
    }
    // A closing doc is being deleted; saving it again would write to a dead row.
    if !closing && let Err(error) = hub::persist_room(state, room).await {
        eprintln!("collab persist {}: {error}", room.item_id);
    }
    // Only this room is removed: a newer room for the same item must stay open.
    // A closing room stays for `sweep_closing`.
    if !closing {
        hub::remove_if_idle(&state.hub, room).await;
    }
}

/// Sends one frame; false when the socket is gone.
async fn send(socket: &mut WebSocket, message: Message) -> bool {
    socket.send(message).await.is_ok()
}

/// Sends one text frame; false when the socket is gone.
async fn send_text(socket: &mut WebSocket, text: String) -> bool {
    send(socket, Message::Text(text.into())).await
}

/// Sends a close frame; errors mean the socket is already gone.
async fn close(socket: &mut WebSocket) {
    let _ = socket.send(Message::Close(None)).await;
}
