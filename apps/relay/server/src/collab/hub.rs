//! Open shared documents ("rooms"): each holds its Yjs doc, lease and update log in memory.
//! The hub map lock is only held for a quick lookup, insert or remove, never across an await.

use std::collections::HashMap;
use std::io;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use yrs::updates::decoder::Decode;
use yrs::{Doc, ReadTxn, StateVector, Transact, Update};

use crate::collab::CollabState;
use crate::collab::lease::LeaseBook;
use crate::collab::protocol::{event_json, rejoin_json};
use crate::collab::store::{DocRow, DocStatus};
use crate::collab::update_log::{UpdateLog, list_logs, log_path};

/// Broadcast queue length per room. Each queued frame may be a full-size message, so this
/// bounds what one room can hold; a peer that falls behind gets the whole doc instead.
const BROADCAST_CAPACITY: usize = 64;

/// Most bytes one room's broadcast queue may hold (F97-P2-2).
const BROADCAST_BYTE_CAP: usize = 128 * 1024 * 1024;

const _: () =
    assert!(BROADCAST_CAPACITY * crate::collab::ws::MAX_MESSAGE_BYTES <= BROADCAST_BYTE_CAP);

/// What a room broadcasts to its clients.
#[derive(Clone, Debug)]
pub enum Event {
    /// A y-sync frame from client `from` (others forward it; the sender skips it).
    Binary {
        /// The sending client.
        from: u64,
        /// The y-sync frame.
        bytes: Vec<u8>,
    },
    /// A text frame for every client.
    Text(String),
    /// Send this text frame, then close the socket.
    Close(String),
    /// Every client re-checks its access now (a grant was revoked).
    Recheck,
}

/// The mutable part of a room, behind the room's lock.
pub struct RoomInner {
    /// The live Yjs document.
    pub doc: Doc,
    /// The document epoch; bumped on restore.
    pub epoch: i64,
    /// The document format version.
    pub format_version: i64,
    /// `annotations`, `canvas`, `feed` or `note`.
    pub kind: String,
    /// The user who shared the document.
    pub owner: String,
    /// Open or closing.
    pub status: DocStatus,
    /// True when updates are in the log but not yet saved.
    pub dirty: bool,
    /// Bumped on every applied update, so a save can tell whether updates arrived while it ran.
    pub version: u64,
    /// The write-back lease.
    pub lease: LeaseBook,
    /// The update log on disk.
    pub log: UpdateLog,
    /// How many clients are connected.
    pub clients: usize,
    /// Set when a restore replaced this room: it takes no more updates (its log is the new room's).
    pub retired: bool,
}

/// One open shared document, shared by every client that joined it.
pub struct Room {
    /// The item the document belongs to.
    pub item_id: String,
    /// The project the item belongs to, when it has one (project grants target it).
    ///
    /// Copied from the row when the room opens and not refreshed after that. The relay sets it at
    /// seed and never changes it, so this only matters if the row's project is changed directly in
    /// the database while the room is open: a revoke on the new project then does not push a
    /// recheck to this room until it closes and reopens (update checks still read the row).
    /// Item-level grants still reach it.
    pub project_id: Option<String>,
    /// Held by one save at a time, so an older snapshot cannot land after a newer one.
    pub saving: tokio::sync::Mutex<()>,
    /// The mutable state.
    pub inner: tokio::sync::Mutex<RoomInner>,
    /// Fan-out to the clients.
    pub tx: tokio::sync::broadcast::Sender<Event>,
}

impl Room {
    /// Sends `event` to every client; having no clients is fine.
    pub fn send(&self, event: Event) {
        let _ = self.tx.send(event);
    }
}

/// All open rooms, keyed by item id.
#[derive(Default)]
pub struct Hub {
    rooms: Mutex<HashMap<String, Arc<Room>>>,
    next_client: AtomicU64,
    /// Held for a whole `open_room`, so two opens of one item cannot both cut and replay its log.
    open_gate: Mutex<()>,
}

impl Hub {
    /// An empty hub.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// The open room for `item_id`.
    #[must_use]
    pub fn get(&self, item_id: &str) -> Option<Arc<Room>> {
        self.map().get(item_id).cloned()
    }

    /// Takes the room for `item_id` out of the hub.
    #[must_use]
    pub fn remove(&self, item_id: &str) -> Option<Arc<Room>> {
        self.map().remove(item_id)
    }

    /// Every open room.
    #[must_use]
    pub fn rooms(&self) -> Vec<Arc<Room>> {
        self.map().values().cloned().collect()
    }

    /// A fresh client id, unique for this process.
    #[must_use]
    pub fn next_client_id(&self) -> u64 {
        self.next_client.fetch_add(1, Ordering::Relaxed)
    }

    /// Sends a clone of `event` to every open room.
    pub fn broadcast_all(&self, event: &Event) {
        for room in self.rooms() {
            room.send(event.clone());
        }
    }

    /// Sends `event` to the open rooms that a grant on `target_id` covers: the item
    /// with that id, or the rooms of the project with that id.
    pub fn broadcast_affected(&self, target_id: &str, event: &Event) {
        for room in self.rooms() {
            if room.item_id == target_id || room.project_id.as_deref() == Some(target_id) {
                room.send(event.clone());
            }
        }
    }

    /// The room map, even when a panic poisoned its lock.
    fn map(&self) -> MutexGuard<'_, HashMap<String, Arc<Room>>> {
        self.rooms.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Serialises room opening: the guard is held without an await, so it never crosses one.
    fn open_gate(&self) -> MutexGuard<'_, ()> {
        self.open_gate
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
    }

    /// Inserts `room` unless one is already open for its item; returns the one in the map.
    fn insert_if_absent(&self, room: Arc<Room>) -> Arc<Room> {
        let mut map = self.map();
        map.entry(room.item_id.clone()).or_insert(room).clone()
    }

    /// Whether `room` is still the open room for its item (not evicted or replaced).
    #[must_use]
    pub fn is_current(&self, room: &Room) -> bool {
        self.map()
            .get(&room.item_id)
            .is_some_and(|open| std::ptr::eq(&**open, room))
    }

    /// Removes the hub entry only if it is still `room` (not a newer room for the item).
    pub fn remove_if_same(&self, room: &Room) {
        let mut map = self.map();
        if map
            .get(&room.item_id)
            .is_some_and(|open| std::ptr::eq(&**open, room))
        {
            let _ = map.remove(&room.item_id);
        }
    }
}

/// Applies one v1 update to `doc`; the transaction ends before returning.
fn apply_bytes(doc: &Doc, bytes: &[u8]) -> Result<(), String> {
    let update = Update::decode_v1(bytes).map_err(|err| err.to_string())?;
    let mut txn = doc.transact_mut();
    txn.apply_update(update).map_err(|err| err.to_string())
}

/// The whole document as one v1 update.
fn encode_full(doc: &Doc) -> Vec<u8> {
    doc.transact()
        .encode_state_as_update_v1(&StateVector::default())
}

/// Deletes the item's log file; a missing file is fine. An id that cannot name a log file
/// never had one, so there is nothing to delete.
fn remove_log(dir: &Path, item_id: &str) -> Result<(), String> {
    let Some(path) = log_path(dir, item_id) else {
        return Ok(());
    };
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(err.to_string()),
    }
}

/// The open room for `row.item_id`, or a new one built from `row` and its update log.
pub async fn open_room(state: &CollabState, row: DocRow) -> Result<Arc<Room>, String> {
    let item_id = row.item_id;
    let project_id = row.project_id;
    // Held to the end of this fn (no await inside): the check below and the log open/replay
    // cannot interleave with another open of the same item.
    let _gate = state.hub.open_gate();
    if let Some(room) = state.hub.get(&item_id) {
        return Ok(room);
    }
    let doc = Doc::new();
    if !row.state.is_empty() {
        apply_bytes(&doc, &row.state)?;
    }
    let log = UpdateLog::open(&state.config.log_dir, &item_id).map_err(|err| err.to_string())?;
    // Replayed one record at a time, so a long log is not read into memory in full.
    let mut replayed = false;
    log.for_each(|update| {
        apply_bytes(&doc, update).map_err(io::Error::other)?;
        replayed = true;
        Ok(())
    })
    .map_err(|err| err.to_string())?;
    let inner = RoomInner {
        doc,
        epoch: row.epoch,
        format_version: row.format_version,
        kind: row.kind,
        owner: row.owner,
        status: row.status,
        dirty: replayed,
        version: 0,
        lease: LeaseBook::new(state.config.lease_ms),
        log,
        clients: 0,
        retired: false,
    };
    let room = Arc::new(Room {
        item_id,
        project_id,
        saving: tokio::sync::Mutex::new(()),
        inner: tokio::sync::Mutex::new(inner),
        tx: tokio::sync::broadcast::channel(BROADCAST_CAPACITY).0,
    });
    Ok(state.hub.insert_if_absent(room))
}

/// Saves the room's full state and empties its log, when anything changed since the last save.
pub async fn persist_room(state: &CollabState, room: &Room) -> Result<(), String> {
    // One save at a time per room: otherwise an older snapshot could be written after a newer one.
    let _saving = room.saving.lock().await;
    let (bytes, epoch, version) = {
        let inner = room.inner.lock().await;
        if !inner.dirty {
            return Ok(());
        }
        (encode_full(&inner.doc), inner.epoch, inner.version)
    };
    // The room lock is released during the store write, so clients keep sending updates.
    if let Err(err) = state.store.save_state(&room.item_id, epoch, &bytes).await {
        // A room opened from a row read before a restore can never save: retire it so its
        // clients rejoin at the row's epoch, instead of editing a doc that is never kept.
        if let Ok(Some(row)) = state.store.load(&room.item_id).await
            && row.epoch != epoch
        {
            retire(state, room, row.epoch).await?;
        }
        return Err(err);
    }
    let mut inner = room.inner.lock().await;
    // Updates that arrived during the save are not in `bytes`: keep their log and the dirty flag.
    if inner.version != version {
        return Ok(());
    }
    inner.log.truncate().map_err(|err| err.to_string())?;
    inner.dirty = false;
    Ok(())
}

/// Drops the room from the hub when nobody is connected and nothing is unsaved. A closing room
/// stays until `sweep_closing` settles it, or it would never be swept.
async fn evict_if_idle(state: &CollabState, room: &Arc<Room>) {
    let inner = room.inner.lock().await;
    // Checked under the room lock, so a client joining now cannot miss the removal.
    if inner.clients == 0 && !inner.dirty && inner.status != DocStatus::Closing {
        state.hub.remove_if_same(room);
    }
}

/// Counts a client into `room` and returns its subscription, the epoch and the format version.
/// `None` when the room is no longer the open one. Under the room lock, so a removal cannot land
/// between the check and the count.
pub async fn admit(
    hub: &Hub,
    room: &Arc<Room>,
) -> Option<(tokio::sync::broadcast::Receiver<Event>, i64, i64)> {
    let mut inner = room.inner.lock().await;
    if !hub.is_current(room) {
        return None;
    }
    inner.clients += 1;
    Some((room.tx.subscribe(), inner.epoch, inner.format_version))
}

/// Drops `room` from the hub when no client is counted into it. Under the room lock, so a client
/// cannot be admitted between the check and the removal.
pub async fn remove_if_idle(hub: &Hub, room: &Arc<Room>) {
    let inner = room.inner.lock().await;
    if inner.clients == 0 {
        hub.remove_if_same(room);
    }
}

/// Saves every open room, then forgets the idle ones. Errors are logged and skipped.
pub async fn persist_all(state: &CollabState) {
    for room in state.hub.rooms() {
        if let Err(err) = persist_room(state, &room).await {
            eprintln!("persist {}: {err}", room.item_id);
        }
        evict_if_idle(state, &room).await;
    }
}

/// Replays every update log at startup. Returns how many docs were recovered.
pub async fn recover(state: &CollabState) -> usize {
    let ids = match list_logs(&state.config.log_dir) {
        Ok(ids) => ids,
        Err(err) => {
            eprintln!("list update logs: {err}");
            return 0;
        }
    };
    let mut recovered = 0;
    for item_id in ids {
        match recover_one(state, &item_id).await {
            Ok(true) => recovered += 1,
            Ok(false) => {}
            Err(err) => eprintln!("recover {item_id}: {err}"),
        }
    }
    recovered
}

/// Recovers one logged doc; `false` when its row is gone and the log was deleted.
async fn recover_one(state: &CollabState, item_id: &str) -> Result<bool, String> {
    let Some(row) = state.store.load(item_id).await? else {
        remove_log(&state.config.log_dir, item_id)?;
        return Ok(false);
    };
    let closing = row.status == DocStatus::Closing;
    let room = open_room(state, row).await?;
    persist_room(state, &room).await?;
    // A closing room stays open for `sweep_closing` to settle.
    if !closing {
        let _ = state.hub.remove(item_id);
    }
    Ok(true)
}

/// Saves the open rooms every `persist_every`, forever. The first immediate tick is skipped.
#[must_use]
pub fn spawn_persist_loop(state: Arc<CollabState>) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(state.config.persist_every);
        let _ = ticker.tick().await;
        loop {
            let _ = ticker.tick().await;
            persist_all(&state).await;
            sweep_closing(&state).await;
        }
    })
}

/// Deletes a shared doc: its row, its log and its open room. Open clients are told it closed.
pub async fn close_doc(state: &CollabState, item_id: &str) -> Result<(), String> {
    state.store.delete(item_id).await?;
    remove_log(&state.config.log_dir, item_id)?;
    if let Some(room) = state.hub.remove(item_id) {
        room.send(Event::Close(event_json("closed")));
    }
    Ok(())
}

/// Finishes unshares that nothing can complete: a closing room with no live lease (its holder
/// stalled or died before `lease.final`) is closed. Errors are logged and the room is retried.
pub async fn sweep_closing(state: &CollabState) {
    let now = state.clock.now_ms();
    for room in state.hub.rooms() {
        let stranded = {
            let inner = room.inner.lock().await;
            inner.status == DocStatus::Closing && inner.lease.live_holder(now).is_none()
        };
        if stranded && let Err(err) = close_doc(state, &room.item_id).await {
            eprintln!("sweep {}: {err}", room.item_id);
        }
    }
}

/// Replaces a doc's state, bumps its epoch and drops the open room so clients rejoin.
/// Returns the new epoch.
pub async fn restore(
    state: &CollabState,
    item_id: &str,
    kind: &str,
    bytes: &[u8],
) -> Result<i64, String> {
    let new_epoch = state.store.replace_state(item_id, kind, bytes).await?;
    if let Some(room) = state.hub.get(item_id) {
        retire(state, &room, new_epoch).await?;
    }
    Ok(new_epoch)
}

/// Ends `room` for a newer `epoch`: empties its log, drops it from the hub and tells its clients
/// to rejoin. One critical section: an update applied after it sees `retired` and is refused, so
/// nothing reaches the log the next room replays.
async fn retire(state: &CollabState, room: &Room, epoch: i64) -> Result<(), String> {
    let cleared = {
        let mut inner = room.inner.lock().await;
        let cleared = inner.log.truncate().map_err(|err| err.to_string());
        inner.dirty = false;
        inner.retired = true;
        state.hub.remove_if_same(room);
        cleared
    };
    room.send(Event::Close(rejoin_json(epoch)));
    cleared
}
