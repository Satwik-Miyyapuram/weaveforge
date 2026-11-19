#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    missing_docs,
    unused_results,
    clippy::result_large_err
)]

//! Co-editing socket tests (files-first L8): handshake, update log replay after a
//! restart, unshare with a final write-back, grant revocation, periodic saves and restore.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use tokio::net::{TcpListener, TcpStream};
use tokio::task::JoinHandle;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::tungstenite::{self, Message};
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream};
use wf_relay_server::collab::hub::{self, Hub};
use wf_relay_server::collab::protocol::update_frame;
use wf_relay_server::collab::store::{
    DocRow, DocStatus, GrantRow, MemoryStore, NewGrant, SharedDocStore,
};
use wf_relay_server::collab::update_log::log_path;
use wf_relay_server::collab::{
    Authenticator, BoxFut, Clock, CollabConfig, CollabState, Permission, routes,
};
use yrs::updates::decoder::Decode;
use yrs::{Doc, GetString, Map, ReadTxn, StateVector, Text, Transact, Update};

const OWNER: &str = "owner-1";
const GUEST: &str = "guest-2";
const OWNER_TOKEN: &str = "tok-owner";
const GUEST_TOKEN: &str = "tok-guest";
const ITEM: &str = "doc-item";
const Q1: &str = "?epoch=1&format=1";
const RECV: Duration = Duration::from_secs(5);
const PERSIST: Duration = Duration::from_millis(50);
const LEASE_MS: i64 = 90_000;
const START_MS: i64 = 1_000_000;

type Ws = WebSocketStream<MaybeTlsStream<TcpStream>>;

/// A fresh log directory, removed on drop (best effort).
struct TempDir(PathBuf);

impl TempDir {
    fn new(name: &str) -> Self {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |elapsed| elapsed.as_nanos());
        let dir = std::env::temp_dir().join(format!(
            "wf-collab-ws-{name}-{}-{nanos}",
            std::process::id()
        ));
        std::fs::create_dir_all(&dir).expect("create log dir");
        Self(dir)
    }

    fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// Maps the two test tokens to their users.
struct Tokens(HashMap<String, String>);

impl Authenticator for Tokens {
    fn user_for<'a>(&'a self, token: &'a str) -> BoxFut<'a, Option<String>> {
        Box::pin(async move { self.0.get(token).cloned() })
    }
}

/// A clock the test owns: it only moves when the test says so.
struct ManualClock(Arc<AtomicI64>);

impl Clock for ManualClock {
    fn now_ms(&self) -> i64 {
        self.0.load(Ordering::SeqCst)
    }
}

/// The shared state for a relay over `store`, logging under `dir`.
fn build_state(
    dir: &Path,
    store: Arc<dyn SharedDocStore>,
    persist_every: Duration,
) -> Arc<CollabState> {
    Arc::new(CollabState {
        config: CollabConfig {
            log_dir: dir.to_path_buf(),
            persist_every,
            lease_ms: LEASE_MS,
            grant_cache_ms: 0,
        },
        store,
        auth: Arc::new(Tokens(HashMap::from([
            (OWNER_TOKEN.to_owned(), OWNER.to_owned()),
            (GUEST_TOKEN.to_owned(), GUEST.to_owned()),
        ]))),
        clock: Arc::new(ManualClock(Arc::new(AtomicI64::new(START_MS)))),
        hub: Hub::new(),
    })
}

/// A running relay on 127.0.0.1 with a random port.
struct Relay {
    state: Arc<CollabState>,
    port: u16,
    server: JoinHandle<()>,
}

impl Relay {
    async fn start(dir: &Path, store: Arc<dyn SharedDocStore>, persist_every: Duration) -> Self {
        let state = build_state(dir, store, persist_every);
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let port = listener.local_addr().expect("local addr").port();
        let app = routes::router(state.clone());
        let server = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        Self {
            state,
            port,
            server,
        }
    }

    /// Stops accepting requests, as a crash would; nothing is saved.
    fn stop(self) {
        self.server.abort();
    }

    fn url(&self, path: &str) -> String {
        format!("http://127.0.0.1:{}{path}", self.port)
    }
}

/// Inserts a doc row owned by `OWNER`.
async fn seed(store: &MemoryStore, item: &str, state: Vec<u8>) {
    let row = DocRow {
        item_id: item.to_owned(),
        owner: OWNER.to_owned(),
        kind: "canvas".to_owned(),
        project_id: None,
        workspace_id: None,
        epoch: 1,
        format_version: 1,
        state,
        status: DocStatus::Open,
    };
    store.seed(&row).await.expect("seed doc");
}

/// Gives `GUEST` edit access to `item`; returns the grant id.
async fn grant_edit(store: &MemoryStore, item: &str) -> String {
    let grant = NewGrant {
        owner: OWNER.to_owned(),
        scope: "item".to_owned(),
        target_id: item.to_owned(),
        grantee_user: GUEST.to_owned(),
        permission: Permission::Edit,
        expires_at: None,
    };
    store.create_grant(&grant).await.expect("create grant").id
}

/// A v1 update that inserts `text` into the document's `t` text.
fn text_update(text: &str) -> Vec<u8> {
    let doc = Doc::new();
    let body = doc.get_or_insert_text("t");
    let mut txn = doc.transact_mut();
    body.insert(&mut txn, 0, text);
    txn.encode_state_as_update_v1(&StateVector::default())
}

/// A v1 update that sets `key` to `value` in the `saves` map.
fn map_update(key: &str, value: &str) -> Vec<u8> {
    let doc = Doc::new();
    let saves = doc.get_or_insert_map("saves");
    let mut txn = doc.transact_mut();
    let _ = saves.insert(&mut txn, key, value);
    txn.encode_state_as_update_v1(&StateVector::default())
}

/// The document a saved state decodes to (an empty state is an empty document).
fn decode(state: &[u8]) -> Doc {
    let doc = Doc::new();
    if !state.is_empty() {
        let update = Update::decode_v1(state).expect("decode state");
        doc.transact_mut()
            .apply_update(update)
            .expect("apply state");
    }
    doc
}

/// The `t` text of a saved state.
fn text_of(state: &[u8]) -> String {
    let doc = decode(state);
    let txn = doc.transact();
    txn.get_text("t")
        .map(|text| text.get_string(&txn))
        .unwrap_or_default()
}

/// Whether the `saves` map of a saved state has `key`.
fn map_has(state: &[u8], key: &str) -> bool {
    let doc = decode(state);
    let txn = doc.transact();
    txn.get_map("saves")
        .is_some_and(|saves| saves.get(&txn, key).is_some())
}

/// The `t` text of the open room for `item`, if one is open.
async fn room_text(state: &CollabState, item: &str) -> Option<String> {
    let room = state.hub.get(item)?;
    let inner = room.inner.lock().await;
    let txn = inner.doc.transact();
    txn.get_text("t").map(|text| text.get_string(&txn))
}

/// Polls the open room until its text contains `needle`.
async fn wait_for_room(state: &CollabState, item: &str, needle: &str) {
    for _ in 0..400 {
        if room_text(state, item)
            .await
            .is_some_and(|text| text.contains(needle))
        {
            return;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("open room never showed `{needle}`");
}

/// Polls the store (up to 2 s) until the saved text contains `needle`.
async fn wait_for_saved(store: &MemoryStore, item: &str, needle: &str) {
    for _ in 0..200 {
        if store
            .doc(item)
            .is_some_and(|row| text_of(&row.state).contains(needle))
        {
            return;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("store never saved `{needle}`");
}

/// Polls the store (up to 2 s) until the doc row is gone.
async fn wait_for_deleted(store: &MemoryStore, item: &str) {
    for _ in 0..200 {
        if store.doc(item).is_none() {
            return;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("doc row was never deleted");
}

/// Polls (up to 2 s) until the update log for `item` has bytes in it.
async fn wait_for_log(dir: &Path, item: &str) {
    let path = log_path(dir, item);
    for _ in 0..200 {
        if std::fs::metadata(&path).is_ok_and(|meta| meta.len() > 0) {
            return;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("update log never written");
}

/// Opens a socket at `path`, with an optional `Sec-WebSocket-Protocol` value.
async fn connect(
    port: u16,
    path: &str,
    protocol: Option<String>,
) -> Result<Ws, tungstenite::Error> {
    let mut request = format!("ws://127.0.0.1:{port}{path}").into_client_request()?;
    if let Some(value) = protocol {
        let _ = request.headers_mut().insert(
            "sec-websocket-protocol",
            HeaderValue::from_str(&value).expect("protocol header"),
        );
    }
    let (ws, _) = tokio_tungstenite::connect_async(request).await?;
    Ok(ws)
}

/// Joins the socket for `item` as `token`, with the query string `query`.
async fn join(port: u16, item: &str, token: &str, query: &str) -> Result<Ws, tungstenite::Error> {
    connect(
        port,
        &format!("/collab/ws/{item}{query}"),
        Some(format!("wf.v1, {token}")),
    )
    .await
}

/// A JSON API call with a bearer token; returns the status and the JSON body.
async fn http(
    method: reqwest::Method,
    url: &str,
    token: &str,
    body: Option<Value>,
) -> (u16, Value) {
    let client = reqwest::Client::new();
    let mut request = client.request(method, url).bearer_auth(token);
    if let Some(body) = body {
        request = request
            .header("content-type", "application/json")
            .body(body.to_string());
    }
    let response = request.send().await.expect("http call");
    let status = response.status().as_u16();
    let text = response.text().await.expect("http body");
    (status, serde_json::from_str(&text).unwrap_or(Value::Null))
}

/// Next frame, or `None` if the socket closed. Panics after 5 s of silence.
async fn recv(ws: &mut Ws) -> Option<Message> {
    tokio::time::timeout(RECV, ws.next())
        .await
        .expect("no frame within 5 s")
        .and_then(Result::ok)
}

/// Next text frame (binary frames skipped); `None` if the socket closed.
async fn recv_text(ws: &mut Ws) -> Option<String> {
    loop {
        match recv(ws).await? {
            Message::Text(text) => return Some(text.as_str().to_owned()),
            Message::Close(_) => return None,
            _ => {}
        }
    }
}

/// The next text frame, parsed as JSON.
async fn next_json(ws: &mut Ws) -> Value {
    let text = recv_text(ws).await.expect("a text frame");
    serde_json::from_str(&text).expect("json frame")
}

/// Reads text frames until one has `"type": kind`, and returns it.
async fn expect_json(ws: &mut Ws, kind: &str) -> Value {
    loop {
        let value = next_json(ws).await;
        if value["type"] == kind {
            return value;
        }
    }
}

/// Reads until the socket closes.
async fn expect_close(ws: &mut Ws) {
    while let Some(message) = recv(ws).await {
        if let Message::Close(_) = message {
            return;
        }
    }
}

async fn send_text(ws: &mut Ws, text: &str) {
    ws.send(Message::Text(text.to_owned().into()))
        .await
        .expect("send text");
}

async fn send_frame(ws: &mut Ws, frame: Vec<u8>) {
    ws.send(Message::Binary(frame.into()))
        .await
        .expect("send frame");
}

/// Asserts a failed handshake was an HTTP `status`.
fn assert_http_status<T>(result: Result<T, tungstenite::Error>, status: u16) {
    match result {
        Err(tungstenite::Error::Http(response)) => {
            assert_eq!(response.status().as_u16(), status);
        }
        Err(other) => panic!("expected HTTP {status}, got {other}"),
        Ok(_) => panic!("expected HTTP {status}, but the socket opened"),
    }
}

#[tokio::test]
async fn ws_handshake_bearer_in_protocol_header() {
    let dir = TempDir::new("handshake");
    let store = Arc::new(MemoryStore::new());
    seed(&store, ITEM, text_update("seed")).await;
    let _grant = grant_edit(&store, ITEM).await;
    let relay = Relay::start(dir.path(), store.clone(), PERSIST).await;

    let mut ws = join(relay.port, ITEM, GUEST_TOKEN, Q1)
        .await
        .expect("guest joins");
    let hello = next_json(&mut ws).await;
    assert_eq!(hello["type"], "hello");
    assert_eq!(hello["epoch"], 1);
    assert_eq!(hello["permission"], "edit");

    let no_token = connect(relay.port, &format!("/collab/ws/{ITEM}{Q1}"), None).await;
    assert_http_status(no_token, 401);
    let unknown = join(relay.port, ITEM, "tok-nobody", Q1).await;
    assert_http_status(unknown, 401);
}

#[tokio::test]
async fn update_log_replayed_after_restart() {
    let dir = TempDir::new("replay");
    let store = Arc::new(MemoryStore::new());
    seed(&store, ITEM, Vec::new()).await;
    let relay = Relay::start(dir.path(), store.clone(), PERSIST).await;

    let mut owner = join(relay.port, ITEM, OWNER_TOKEN, Q1)
        .await
        .expect("owner joins");
    let _hello = next_json(&mut owner).await;
    send_frame(&mut owner, update_frame(text_update("hello"))).await;
    wait_for_log(dir.path(), ITEM).await;
    drop(owner);
    relay.stop();

    // A restart: same log dir and store, no save happened before the crash.
    let restarted = build_state(dir.path(), store.clone(), PERSIST);
    assert_eq!(hub::recover(&restarted).await, 1);
    let row = store.doc(ITEM).expect("doc row");
    assert_eq!(text_of(&row.state), "hello");
}

#[tokio::test]
async fn digest_log_survives_restart() {
    let dir = TempDir::new("digest");
    let store = Arc::new(MemoryStore::new());
    seed(&store, ITEM, Vec::new()).await;
    let relay = Relay::start(dir.path(), store.clone(), PERSIST).await;

    let mut owner = join(relay.port, ITEM, OWNER_TOKEN, Q1)
        .await
        .expect("owner joins");
    let _hello = next_json(&mut owner).await;
    send_frame(&mut owner, update_frame(map_update("digest-1", "sent"))).await;
    wait_for_log(dir.path(), ITEM).await;
    drop(owner);
    relay.stop();

    let restarted = build_state(dir.path(), store.clone(), PERSIST);
    assert_eq!(hub::recover(&restarted).await, 1);
    let row = store.doc(ITEM).expect("doc row");
    assert!(map_has(&row.state, "digest-1"));
}

#[tokio::test]
async fn unshare_waits_for_final_writeback() {
    let dir = TempDir::new("unshare");
    let store = Arc::new(MemoryStore::new());
    seed(&store, ITEM, text_update("doc")).await;
    let relay = Relay::start(dir.path(), store.clone(), PERSIST).await;

    let mut owner = join(relay.port, ITEM, OWNER_TOKEN, Q1)
        .await
        .expect("owner joins");
    let _hello = next_json(&mut owner).await;
    send_text(&mut owner, r#"{"type":"lease.acquire","device":"d1"}"#).await;
    let _granted = expect_json(&mut owner, "lease.granted").await;

    let url = relay.url(&format!("/shared-docs/{ITEM}"));
    let (status, body) = http(reqwest::Method::DELETE, &url, OWNER_TOKEN, None).await;
    assert_eq!(status, 202);
    assert_eq!(body["status"], "closing");
    assert_eq!(
        store.doc(ITEM).map(|row| row.status),
        Some(DocStatus::Closing)
    );
    let _closing = expect_json(&mut owner, "closing").await;

    send_text(&mut owner, r#"{"type":"lease.final","device":"d1"}"#).await;
    let _closed = expect_json(&mut owner, "closed").await;
    expect_close(&mut owner).await;
    wait_for_deleted(&store, ITEM).await;
}

#[tokio::test]
async fn ws_grant_checked_on_update() {
    let dir = TempDir::new("revoke");
    let store = Arc::new(MemoryStore::new());
    seed(&store, ITEM, Vec::new()).await;
    let grant_id = grant_edit(&store, ITEM).await;
    let relay = Relay::start(dir.path(), store.clone(), PERSIST).await;

    let mut guest = join(relay.port, ITEM, GUEST_TOKEN, Q1)
        .await
        .expect("guest joins");
    let _hello = next_json(&mut guest).await;
    send_frame(&mut guest, update_frame(text_update("before"))).await;
    wait_for_room(&relay.state, ITEM, "before").await;

    let url = relay.url(&format!("/grants/{grant_id}"));
    let (status, _) = http(reqwest::Method::DELETE, &url, OWNER_TOKEN, None).await;
    assert_eq!(status, 200);

    // The revoke makes every socket in the affected room re-check, so `denied` comes first.
    // (Read before sending: on Windows a reset from the closed socket can drop unread frames.)
    let denied = expect_json(&mut guest, "denied").await;
    assert_eq!(denied["reason"], "revoked");
    // Sent after the revoke: the server must not apply it.
    let _ = guest
        .send(Message::Binary(update_frame(text_update("after")).into()))
        .await;

    hub::persist_all(&relay.state).await;
    let saved = text_of(&store.doc(ITEM).expect("doc row").state);
    assert!(saved.contains("before"), "pre-revoke update was lost");
    assert!(!saved.contains("after"), "post-revoke update was saved");
}

#[tokio::test]
async fn persist_every_2s() {
    let production = CollabConfig::production(PathBuf::from("unused"));
    assert_eq!(production.persist_every, Duration::from_secs(2));

    let dir = TempDir::new("persist");
    let store = Arc::new(MemoryStore::new());
    seed(&store, ITEM, Vec::new()).await;
    let relay = Relay::start(dir.path(), store.clone(), PERSIST).await;
    let persist = hub::spawn_persist_loop(relay.state.clone());

    let mut owner = join(relay.port, ITEM, OWNER_TOKEN, Q1)
        .await
        .expect("owner joins");
    let _hello = next_json(&mut owner).await;
    send_frame(&mut owner, update_frame(text_update("one"))).await;
    wait_for_saved(&store, ITEM, "one").await;
    assert!(store.saves() >= 1);

    // The socket must still be open after a save: a second update is applied and saved.
    send_frame(&mut owner, update_frame(text_update("two"))).await;
    wait_for_saved(&store, ITEM, "two").await;
    persist.abort();
}

#[tokio::test]
async fn shared_state_post_requires_owner() {
    let dir = TempDir::new("restore-auth");
    let store = Arc::new(MemoryStore::new());
    seed(&store, ITEM, Vec::new()).await;
    let _grant = grant_edit(&store, ITEM).await;
    let relay = Relay::start(dir.path(), store.clone(), PERSIST).await;

    let url = relay.url(&format!("/shared-docs/{ITEM}/state"));
    let body = json!({"kind": "canvas", "encoding": "json", "state": {"n": 1}});
    let (guest_status, _) =
        http(reqwest::Method::POST, &url, GUEST_TOKEN, Some(body.clone())).await;
    assert_eq!(guest_status, 403);

    let (owner_status, reply) = http(reqwest::Method::POST, &url, OWNER_TOKEN, Some(body)).await;
    assert_eq!(owner_status, 200);
    assert_eq!(reply["epoch"], 2);
}

#[tokio::test]
async fn epoch_bumped_after_restore() {
    let dir = TempDir::new("epoch");
    let store = Arc::new(MemoryStore::new());
    seed(&store, ITEM, text_update("v1")).await;
    let relay = Relay::start(dir.path(), store.clone(), PERSIST).await;

    let mut owner = join(relay.port, ITEM, OWNER_TOKEN, Q1)
        .await
        .expect("owner joins");
    let hello = next_json(&mut owner).await;
    assert_eq!(hello["epoch"], 1);

    let encoded = STANDARD.encode(text_update("restored"));
    let url = relay.url(&format!("/shared-docs/{ITEM}/state"));
    let body = json!({"kind": "canvas", "encoding": "yjs-state", "state": encoded});
    let (status, reply) = http(reqwest::Method::POST, &url, OWNER_TOKEN, Some(body)).await;
    assert_eq!(status, 200);
    assert_eq!(reply["epoch"], 2);

    let rejoin = expect_json(&mut owner, "rejoin").await;
    assert_eq!(rejoin["epoch"], 2);
    expect_close(&mut owner).await;

    // A client still on epoch 1 is told to rejoin at 2.
    let mut stale = join(relay.port, ITEM, OWNER_TOKEN, "?epoch=1&format=1")
        .await
        .expect("stale client connects");
    let stale_reply = next_json(&mut stale).await;
    assert_eq!(stale_reply["type"], "rejoin");
    assert_eq!(stale_reply["epoch"], 2);

    let mut fresh = join(relay.port, ITEM, OWNER_TOKEN, "?epoch=2&format=1")
        .await
        .expect("fresh client connects");
    let fresh_hello = next_json(&mut fresh).await;
    assert_eq!(fresh_hello["type"], "hello");
    assert_eq!(fresh_hello["epoch"], 2);
}

/// Delegates to a `MemoryStore`; `access` fails while `fail` is set.
struct AccessFails {
    inner: Arc<MemoryStore>,
    fail: AtomicBool,
}

impl SharedDocStore for AccessFails {
    fn load<'a>(&'a self, item_id: &'a str) -> BoxFut<'a, Result<Option<DocRow>, String>> {
        self.inner.load(item_id)
    }
    fn seed<'a>(&'a self, row: &'a DocRow) -> BoxFut<'a, Result<(), String>> {
        self.inner.seed(row)
    }
    fn save_state<'a>(
        &'a self,
        item_id: &'a str,
        epoch: i64,
        state: &'a [u8],
    ) -> BoxFut<'a, Result<(), String>> {
        self.inner.save_state(item_id, epoch, state)
    }
    fn replace_state<'a>(
        &'a self,
        item_id: &'a str,
        kind: &'a str,
        state: &'a [u8],
    ) -> BoxFut<'a, Result<i64, String>> {
        self.inner.replace_state(item_id, kind, state)
    }
    fn set_status<'a>(
        &'a self,
        item_id: &'a str,
        status: DocStatus,
    ) -> BoxFut<'a, Result<(), String>> {
        self.inner.set_status(item_id, status)
    }
    fn set_writer<'a>(
        &'a self,
        item_id: &'a str,
        device: Option<&'a str>,
        until_ms: Option<i64>,
    ) -> BoxFut<'a, Result<(), String>> {
        self.inner.set_writer(item_id, device, until_ms)
    }
    fn delete<'a>(&'a self, item_id: &'a str) -> BoxFut<'a, Result<(), String>> {
        self.inner.delete(item_id)
    }
    fn access<'a>(
        &'a self,
        item_id: &'a str,
        user: &'a str,
    ) -> BoxFut<'a, Result<Option<Permission>, String>> {
        Box::pin(async move {
            if self.fail.load(Ordering::SeqCst) {
                return Err("access store down".to_owned());
            }
            self.inner.access(item_id, user).await
        })
    }
    fn create_grant<'a>(&'a self, grant: &'a NewGrant) -> BoxFut<'a, Result<GrantRow, String>> {
        self.inner.create_grant(grant)
    }
    fn list_grants<'a>(
        &'a self,
        owner: &'a str,
        target_id: Option<&'a str>,
    ) -> BoxFut<'a, Result<Vec<GrantRow>, String>> {
        self.inner.list_grants(owner, target_id)
    }
    fn revoke_grant<'a>(
        &'a self,
        owner: &'a str,
        id: &'a str,
    ) -> BoxFut<'a, Result<Option<String>, String>> {
        self.inner.revoke_grant(owner, id)
    }
}

#[tokio::test]
async fn ws_grant_check_failure_closes_socket() {
    let dir = TempDir::new("fail-closed");
    let store = Arc::new(MemoryStore::new());
    seed(&store, ITEM, Vec::new()).await;
    let _grant = grant_edit(&store, ITEM).await;
    let failing = Arc::new(AccessFails {
        inner: store.clone(),
        fail: AtomicBool::new(false),
    });
    let relay = Relay::start(dir.path(), failing.clone(), PERSIST).await;

    let mut guest = join(relay.port, ITEM, GUEST_TOKEN, Q1)
        .await
        .expect("guest joins");
    let _hello = next_json(&mut guest).await;
    failing.fail.store(true, Ordering::SeqCst);
    send_frame(&mut guest, update_frame(text_update("after"))).await;

    // Fail closed: the socket gets `denied` with reason storage, then closes.
    let denied = expect_json(&mut guest, "denied").await;
    assert_eq!(denied["reason"], "storage");
    expect_close(&mut guest).await;
    hub::persist_all(&relay.state).await;
    let saved = text_of(&store.doc(ITEM).expect("doc row").state);
    assert!(
        !saved.contains("after"),
        "update applied while access unknown"
    );
}

#[tokio::test]
async fn ws_revoke_rechecks_only_affected_rooms() {
    const OTHER: &str = "other-item";
    let dir = TempDir::new("revoke-scope");
    let store = Arc::new(MemoryStore::new());
    seed(&store, ITEM, Vec::new()).await;
    seed(&store, OTHER, Vec::new()).await;
    let grant = grant_edit(&store, ITEM).await;
    let _other_grant = grant_edit(&store, OTHER).await;
    let failing = Arc::new(AccessFails {
        inner: store.clone(),
        fail: AtomicBool::new(false),
    });
    let relay = Relay::start(dir.path(), failing.clone(), PERSIST).await;

    let mut guest = join(relay.port, ITEM, GUEST_TOKEN, Q1)
        .await
        .expect("guest joins");
    let _hello = next_json(&mut guest).await;
    let mut other = join(relay.port, OTHER, GUEST_TOKEN, Q1)
        .await
        .expect("other item joins");
    let _other_hello = next_json(&mut other).await;

    // Every access check now fails, so a recheck of an open room shows as `denied`.
    failing.fail.store(true, Ordering::SeqCst);
    let url = relay.url(&format!("/grants/{grant}"));
    let (status, _) = http(reqwest::Method::DELETE, &url, OWNER_TOKEN, None).await;
    assert_eq!(status, 200);

    let denied = expect_json(&mut guest, "denied").await;
    assert_eq!(denied["reason"], "storage");
    // A grant on ITEM does not touch OTHER's room: it must not be rechecked.
    let quiet = tokio::time::timeout(Duration::from_millis(500), recv_text(&mut other)).await;
    assert!(quiet.is_err(), "unrelated room was rechecked: {quiet:?}");
}

#[tokio::test]
async fn ws_refuses_frame_over_two_megabytes() {
    let dir = TempDir::new("max-frame");
    let store = Arc::new(MemoryStore::new());
    seed(&store, ITEM, Vec::new()).await;
    let _grant = grant_edit(&store, ITEM).await;
    let relay = Relay::start(dir.path(), store.clone(), PERSIST).await;

    let mut guest = join(relay.port, ITEM, GUEST_TOKEN, Q1)
        .await
        .expect("guest joins");
    let _hello = next_json(&mut guest).await;
    let oversize = vec![0_u8; 2 * 1024 * 1024 + 1];
    send_frame(&mut guest, oversize).await;
    expect_close(&mut guest).await;
}

#[tokio::test]
async fn seed_refuses_document_owned_by_another_user() {
    let dir = TempDir::new("seed-owner");
    let store = Arc::new(MemoryStore::new());
    seed(&store, ITEM, Vec::new()).await;
    let relay = Relay::start(dir.path(), store.clone(), PERSIST).await;

    let url = relay.url(&format!("/shared-docs/{ITEM}"));
    let body = json!({"kind": "canvas"});
    let (guest_status, _) =
        http(reqwest::Method::POST, &url, GUEST_TOKEN, Some(body.clone())).await;
    assert_eq!(guest_status, 409);
    let (owner_status, _) = http(reqwest::Method::POST, &url, OWNER_TOKEN, Some(body)).await;
    assert_eq!(owner_status, 200);
}

#[tokio::test]
async fn grant_refuses_grantee_that_is_not_a_uuid() {
    let dir = TempDir::new("grant-uuid");
    let store = Arc::new(MemoryStore::new());
    seed(&store, ITEM, Vec::new()).await;
    let relay = Relay::start(dir.path(), store.clone(), PERSIST).await;

    let url = relay.url("/grants");
    let bad = json!({"scope": "item", "target_id": ITEM, "grantee_user": "guest-2", "permission": "edit"});
    let (status, _) = http(reqwest::Method::POST, &url, OWNER_TOKEN, Some(bad)).await;
    assert_eq!(status, 400);
    let good = json!({
        "scope": "item",
        "target_id": ITEM,
        "grantee_user": "6f1c2a3e-4b5d-4e6f-8a7b-9c0d1e2f3a4b",
        "permission": "edit"
    });
    let (status, _) = http(reqwest::Method::POST, &url, OWNER_TOKEN, Some(good)).await;
    assert_eq!(status, 200);
}
