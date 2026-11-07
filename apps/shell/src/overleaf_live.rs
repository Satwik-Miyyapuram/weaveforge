//! Overleaf live editing at `/api/overleaf/workshop/live/*`. Overleaf's editor talks
//! socket.io 0.9; this speaks it over xhr-polling (plain HTTP, no extra dependency):
//! the handshake joins the project, a background loop long-polls for frames, and the
//! page sends edits as ShareJS text ops, or relays the vendored IDE's own events through
//! `emit`. The page keeps the OT state; this only relays.

use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{Value, json};
use tokio::sync::{Notify, oneshot};

use crate::relay::shared::Answer;

/// How long a reply to one emitted event is awaited.
const ACK_TIMEOUT: Duration = Duration::from_secs(30);
/// How long `open` waits for Overleaf to send the joined project.
const JOIN_TIMEOUT: Duration = Duration::from_secs(20);
/// How long `events` holds a request open with nothing to say.
const EVENTS_WAIT: Duration = Duration::from_secs(25);
/// Failed polls in a row before the connection counts as lost.
const MAX_POLL_FAILURES: u32 = 3;
/// Events kept for the page; past this the page is told to reload the document.
const MAX_EVENTS: usize = 1000;

/// One socket.io 0.9 frame, `type:id:endpoint:data`.
#[derive(Debug, PartialEq)]
pub enum Frame {
    /// `0`: the server closed the connection.
    Disconnect,
    /// `1`: the connection is open.
    Connect,
    /// `2`: a heartbeat, answered with one.
    Heartbeat,
    /// `5`: a named event.
    Event {
        /// The event name.
        name: String,
        /// The event arguments.
        args: Vec<Value>,
    },
    /// `6`: the answer to one of our events.
    Ack {
        /// The id our event carried.
        id: u64,
        /// The answer's arguments.
        args: Vec<Value>,
    },
    /// `7`: an error the server reported.
    Error(String),
    /// Any other frame type, ignored.
    Other,
}

/// Parses one frame; anything unexpected is `Other`.
#[must_use]
pub fn parse_frame(frame: &str) -> Frame {
    let mut parts = frame.splitn(4, ':');
    let kind = parts.next().unwrap_or_default();
    let _id = parts.next();
    let _endpoint = parts.next();
    let data = parts.next().unwrap_or_default();
    match kind {
        "0" => Frame::Disconnect,
        "1" => Frame::Connect,
        "2" => Frame::Heartbeat,
        "5" => {
            let Ok(v) = serde_json::from_str::<Value>(data) else {
                return Frame::Other;
            };
            let name = v.get("name").and_then(Value::as_str).unwrap_or_default();
            let args = v
                .get("args")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            Frame::Event {
                name: name.to_owned(),
                args,
            }
        }
        "6" => {
            // `N+[json]` or `N`.
            let digits = data.chars().take_while(char::is_ascii_digit).count();
            let Ok(id) = data[..digits].parse::<u64>() else {
                return Frame::Other;
            };
            let rest = data[digits..].trim_start_matches('+');
            let args = serde_json::from_str::<Vec<Value>>(rest).unwrap_or_default();
            Frame::Ack { id, args }
        }
        "7" => Frame::Error(data.to_owned()),
        _ => Frame::Other,
    }
}

/// The frames in a poll body: one bare frame, or `\u{fffd}len\u{fffd}frame…`, where
/// `len` counts UTF-16 code units as JavaScript does.
#[must_use]
pub fn split_payload(body: &str) -> Vec<String> {
    const MARK: char = '\u{fffd}';
    if !body.starts_with(MARK) {
        return if body.is_empty() {
            Vec::new()
        } else {
            vec![body.to_owned()]
        };
    }
    let mut frames = Vec::new();
    let mut rest = body;
    while let Some(after) = rest.strip_prefix(MARK) {
        let Some((len, tail)) = after.split_once(MARK) else {
            break;
        };
        let Ok(mut units) = len.parse::<usize>() else {
            break;
        };
        let mut end = 0;
        for ch in tail.chars() {
            if units == 0 {
                break;
            }
            units = units.saturating_sub(ch.len_utf16());
            end += ch.len_utf8();
        }
        frames.push(tail[..end].to_owned());
        rest = &tail[end..];
    }
    frames
}

/// An event that asks for a reply with id `id`.
#[must_use]
pub fn encode_event(id: u64, name: &str, args: &[Value]) -> String {
    format!("5:{id}+::{}", json!({ "name": name, "args": args }))
}

/// The session id from a handshake reply `sid:heartbeat:close:transports`.
///
/// # Errors
/// When the reply is not a handshake or Overleaf does not offer xhr-polling.
pub fn handshake_sid(body: &str) -> Result<String, String> {
    let parts: Vec<&str> = body.trim().split(':').collect();
    let [sid, _, _, transports] = parts.as_slice() else {
        return Err("Overleaf did not open a live connection.".to_owned());
    };
    if sid.is_empty() {
        return Err("Overleaf did not open a live connection.".to_owned());
    }
    if !transports.split(',').any(|t| t == "xhr-polling") {
        return Err(format!(
            "Overleaf offers no polling transport ({transports})."
        ));
    }
    Ok((*sid).to_owned())
}

/// A document line from `joinDoc`: UTF-8 bytes sent as one char per byte.
#[must_use]
pub fn decode_doc_line(line: &str) -> String {
    let bytes: Option<Vec<u8>> = line
        .chars()
        .map(|c| u8::try_from(u32::from(c)).ok())
        .collect();
    bytes
        .and_then(|b| String::from_utf8(b).ok())
        .unwrap_or_else(|| line.to_owned())
}

/// One open project connection.
pub struct Room {
    client: reqwest::Client,
    url: String,
    cookies: String,
    origin: String,
    next_id: AtomicU64,
    acks: Mutex<HashMap<u64, oneshot::Sender<Vec<Value>>>>,
    events: Mutex<VecDeque<Value>>,
    joined: Mutex<Option<Vec<Value>>>,
    doc: Mutex<Option<String>>,
    closed: AtomicBool,
    notify: Notify,
}

impl Room {
    /// Opens a connection to `project` at `base` (ends with `/`) and starts polling.
    ///
    /// # Errors
    /// When the handshake fails.
    pub async fn open(
        client: &reqwest::Client,
        base: &str,
        cookies: &str,
        project: &str,
    ) -> Result<Arc<Self>, String> {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |d| d.as_millis());
        let origin = base.trim_end_matches('/').to_owned();
        let reply = client
            .get(format!("{base}socket.io/1/?projectId={project}&t={stamp}"))
            .header("cookie", cookies)
            .header("origin", &origin)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        let set_cookie = reply
            .headers()
            .get("set-cookie")
            .and_then(|v| v.to_str().ok())
            .map(str::to_owned);
        let status = reply.status().as_u16();
        let body = reply.text().await.map_err(|e| e.to_string())?;
        if status != 200 {
            return Err(format!("Overleaf refused the live connection ({status})."));
        }
        let sid = handshake_sid(&body)?;
        let room = Arc::new(Self {
            client: client.clone(),
            url: format!("{base}socket.io/1/xhr-polling/{sid}"),
            cookies: crate::overleaf_workshop::with_socket_cookie(cookies, set_cookie.as_deref()),
            origin,
            next_id: AtomicU64::new(1),
            acks: Mutex::default(),
            events: Mutex::default(),
            joined: Mutex::default(),
            doc: Mutex::default(),
            closed: AtomicBool::new(false),
            notify: Notify::new(),
        });
        drop(tokio::spawn(Arc::clone(&room).poll()));
        Ok(room)
    }

    fn is_closed(&self) -> bool {
        self.closed.load(Ordering::SeqCst)
    }

    /// Long-polls until closed, routing each frame.
    async fn poll(self: Arc<Self>) {
        let mut failures = 0;
        while !self.is_closed() {
            let reply = self
                .client
                .get(&self.url)
                .header("cookie", &self.cookies)
                .header("origin", &self.origin)
                .send()
                .await;
            let body = match reply {
                Ok(r) if r.status().is_success() => r.text().await.ok(),
                _ => None,
            };
            let Some(body) = body else {
                failures += 1;
                if failures >= MAX_POLL_FAILURES {
                    self.lost();
                }
                tokio::time::sleep(Duration::from_millis(500)).await;
                continue;
            };
            failures = 0;
            for frame in split_payload(&body) {
                self.route(parse_frame(&frame)).await;
            }
        }
    }

    async fn route(&self, frame: Frame) {
        match frame {
            Frame::Heartbeat => {
                let _ = self.post("2::").await;
            }
            Frame::Ack { id, args } => {
                let waiter = self.acks.lock().ok().and_then(|mut m| m.remove(&id));
                if let Some(tx) = waiter {
                    let _ = tx.send(args);
                }
            }
            Frame::Event { name, args } if name == "joinProjectResponse" => {
                if let Ok(mut joined) = self.joined.lock() {
                    *joined = Some(args);
                }
                self.notify.notify_waiters();
            }
            Frame::Event { name, args } => self.push(json!({ "name": name, "args": args })),
            Frame::Disconnect => self.lost(),
            Frame::Error(reason) => self.push(json!({ "name": "error", "args": [reason] })),
            Frame::Connect | Frame::Other => {}
        }
    }

    fn push(&self, event: Value) {
        if let Ok(mut events) = self.events.lock() {
            if events.len() >= MAX_EVENTS {
                events.clear();
                events.push_back(json!({ "name": "resync", "args": [] }));
            } else {
                events.push_back(event);
            }
        }
        self.notify.notify_waiters();
    }

    /// The connection is gone: wake every waiter.
    fn lost(&self) {
        if !self.closed.swap(true, Ordering::SeqCst) {
            self.push(json!({ "name": "disconnect", "args": [] }));
        }
        if let Ok(mut acks) = self.acks.lock() {
            acks.clear();
        }
    }

    async fn post(&self, frame: &str) -> Result<(), String> {
        let reply = self
            .client
            .post(&self.url)
            .header("cookie", &self.cookies)
            .header("origin", &self.origin)
            .header("content-type", "text/plain;charset=UTF-8")
            .body(frame.to_owned())
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if reply.status().is_success() {
            Ok(())
        } else {
            Err(format!("{}: live send failed", reply.status().as_u16()))
        }
    }

    /// Emits `name` and waits for its reply.
    ///
    /// # Errors
    /// When the send fails, the connection closes or no reply comes in time.
    pub async fn emit(&self, name: &str, args: &[Value]) -> Result<Vec<Value>, String> {
        if self.is_closed() {
            return Err("The live connection closed.".to_owned());
        }
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = oneshot::channel();
        if let Ok(mut acks) = self.acks.lock() {
            let _ = acks.insert(id, tx);
        }
        self.post(&encode_event(id, name, args)).await?;
        match tokio::time::timeout(ACK_TIMEOUT, rx).await {
            Ok(Ok(args)) => Ok(args),
            Ok(Err(_)) => Err("The live connection closed.".to_owned()),
            Err(_) => Err("Overleaf did not answer in time.".to_owned()),
        }
    }

    /// The `joinProjectResponse` arguments, waiting up to `limit`.
    pub async fn joined(&self, limit: Duration) -> Option<Vec<Value>> {
        let deadline = tokio::time::Instant::now() + limit;
        loop {
            let notified = self.notify.notified();
            if let Some(args) = self.joined.lock().ok().and_then(|j| j.clone()) {
                return Some(args);
            }
            if self.is_closed() {
                return None;
            }
            if tokio::time::timeout_at(deadline, notified).await.is_err() {
                return None;
            }
        }
    }

    /// The events since the last call, waiting up to `limit` for the first one.
    pub async fn take_events(&self, limit: Duration) -> (Vec<Value>, bool) {
        let deadline = tokio::time::Instant::now() + limit;
        loop {
            let notified = self.notify.notified();
            let drained: Vec<Value> = self
                .events
                .lock()
                .map(|mut e| e.drain(..).collect())
                .unwrap_or_default();
            if !drained.is_empty() || self.is_closed() {
                return (drained, self.is_closed());
            }
            if tokio::time::timeout_at(deadline, notified).await.is_err() {
                return (Vec::new(), self.is_closed());
            }
        }
    }

    /// Joins `doc` (leaving the one open before): its lines and version.
    ///
    /// # Errors
    /// When Overleaf refuses the document.
    pub async fn join_doc(&self, doc: &str) -> Result<(Vec<String>, u64), String> {
        let previous = self
            .doc
            .lock()
            .ok()
            .and_then(|mut d| d.replace(doc.to_owned()));
        if let Some(previous) = previous.filter(|p| p != doc) {
            let _ = self.emit("leaveDoc", &[json!(previous)]).await;
        }
        let reply = self
            .emit("joinDoc", &[json!(doc), json!({ "encodeRanges": true })])
            .await?;
        if let Some(err) = reply.first().filter(|e| !e.is_null()) {
            return Err(error_text(err));
        }
        let lines = reply
            .get(1)
            .and_then(Value::as_array)
            .ok_or("Overleaf sent no document.")?
            .iter()
            .map(|l| decode_doc_line(l.as_str().unwrap_or_default()))
            .collect();
        let version = reply
            .get(2)
            .and_then(Value::as_u64)
            .ok_or("Overleaf sent no version.")?;
        Ok((lines, version))
    }

    /// Sends one text op at `version`; Overleaf confirms it with `otUpdateApplied`.
    ///
    /// # Errors
    /// When Overleaf refuses it.
    pub async fn update(&self, doc: &str, op: &Value, version: u64) -> Result<(), String> {
        let update = json!({ "doc": doc, "op": op, "v": version });
        let reply = self.emit("applyOtUpdate", &[json!(doc), update]).await?;
        match reply.first().filter(|e| !e.is_null()) {
            Some(err) => Err(error_text(err)),
            None => Ok(()),
        }
    }

    /// Closes the connection.
    pub async fn close(&self) {
        if !self.closed.swap(true, Ordering::SeqCst) {
            let _ = self.post("0::").await;
        }
        self.notify.notify_waiters();
    }
}

fn error_text(err: &Value) -> String {
    err.get("message")
        .and_then(Value::as_str)
        .map_or_else(|| err.to_string(), str::to_owned)
}

/// The events the vendored Overleaf IDE may send through `emit`: the ones its
/// editor and collaborator list use, nothing that changes the project tree.
const EMITTABLE: [&str; 5] = [
    "joinDoc",
    "leaveDoc",
    "applyOtUpdate",
    "clientTracking.getConnectedUsers",
    "clientTracking.updatePosition",
];

/// Open rooms by live id.
#[derive(Default)]
pub struct Rooms(Mutex<HashMap<String, Arc<Room>>>);

impl Rooms {
    fn get(&self, id: &str) -> Option<Arc<Room>> {
        self.0.lock().ok()?.get(id).cloned()
    }

    fn insert(&self, id: String, room: Arc<Room>) {
        if let Ok(mut map) = self.0.lock() {
            let _ = map.insert(id, room);
        }
    }

    fn remove(&self, id: &str) -> Option<Arc<Room>> {
        self.0.lock().ok()?.remove(id)
    }
}

/// The project tree and permission from `joinProjectResponse`.
#[must_use]
pub fn joined_project(args: &[Value]) -> Value {
    let first = args.first().cloned().unwrap_or(Value::Null);
    let project = first.get("project").cloned().unwrap_or(Value::Null);
    json!({
        "name": project.get("name"),
        "rootDocId": project.get("rootDoc_id"),
        "rootFolder": project.get("rootFolder"),
        "permissionsLevel": first.get("permissionsLevel"),
    })
}

fn answer(status: u16, body: &Value) -> Answer {
    Answer {
        status,
        headers: vec![
            ("content-type".to_owned(), "application/json".to_owned()),
            ("cache-control".to_owned(), "no-store".to_owned()),
        ],
        body: body.to_string().into_bytes(),
    }
}

fn fail(status: u16, message: &str) -> Answer {
    answer(status, &json!({ "error": message }))
}

fn text_field<'a>(body: &'a Value, key: &str) -> Option<&'a str> {
    body.get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
}

/// Overleaf ids are 24 hex characters.
fn is_overleaf_id(id: &str) -> bool {
    id.len() == 24 && id.bytes().all(|b| b.is_ascii_hexdigit())
}

/// What `open` needs: a signed-in session's cookies, joined to a project.
pub struct Opener<'a> {
    /// The HTTP client the room polls with.
    pub client: &'a reqwest::Client,
    /// Overleaf's base URL, ending in `/`.
    pub base: &'a str,
    /// The open rooms, keyed by live id.
    pub rooms: &'a Rooms,
}

/// POST live/<action> with an already parsed JSON body. `cookies` is the session's
/// signed-in cookie for `open`; other actions name the room by `liveId`.
pub async fn serve(
    opener: &Opener<'_>,
    action: &str,
    body: &Value,
    cookies: Option<String>,
) -> Answer {
    if action == "open" {
        let Some(project) = text_field(body, "projectId").filter(|p| is_overleaf_id(p)) else {
            return fail(400, "A project id is required.");
        };
        let Some(cookies) = cookies else {
            return answer(
                401,
                &json!({ "error": "Overleaf session not found. Sign in again.", "expired": true }),
            );
        };
        return open(opener, &cookies, project).await;
    }
    let Some(room) = text_field(body, "liveId").and_then(|id| opener.rooms.get(id)) else {
        return answer(
            410,
            &json!({ "error": "The live connection closed.", "closed": true }),
        );
    };
    let doc = text_field(body, "docId").filter(|d| is_overleaf_id(d));
    match action {
        "doc" => {
            let Some(doc) = doc else {
                return fail(400, "A document id is required.");
            };
            match room.join_doc(doc).await {
                Ok((lines, version)) => answer(200, &json!({ "lines": lines, "version": version })),
                Err(message) => fail(502, &message),
            }
        }
        "update" => {
            let (Some(doc), Some(op), Some(version)) = (
                doc,
                body.get("op").filter(|o| o.is_array()),
                body.get("version").and_then(Value::as_u64),
            ) else {
                return fail(400, "A document id, op and version are required.");
            };
            match room.update(doc, op, version).await {
                Ok(()) => answer(200, &json!({ "ok": true })),
                Err(message) => fail(409, &message),
            }
        }
        "emit" => {
            let (Some(name), Some(args)) = (
                text_field(body, "name").filter(|n| EMITTABLE.contains(n)),
                body.get("args").and_then(Value::as_array),
            ) else {
                return fail(400, "An allowed event name and args are required.");
            };
            match room.emit(name, args).await {
                Ok(reply) => answer(200, &json!({ "reply": reply })),
                Err(message) => fail(502, &message),
            }
        }
        "events" => {
            let (events, closed) = room.take_events(EVENTS_WAIT).await;
            answer(200, &json!({ "events": events, "closed": closed }))
        }
        "close" => {
            if let Some(id) = text_field(body, "liveId") {
                let _ = opener.rooms.remove(id);
            }
            room.close().await;
            answer(200, &json!({ "ok": true }))
        }
        _ => fail(404, "Not found."),
    }
}

async fn open(opener: &Opener<'_>, cookies: &str, project: &str) -> Answer {
    let room = match Room::open(opener.client, opener.base, cookies, project).await {
        Ok(room) => room,
        Err(message) => return fail(502, &message),
    };
    let joined = match room.joined(JOIN_TIMEOUT).await {
        Some(args) => args,
        // Older servers join only when asked.
        None => match room
            .emit("joinProject", &[json!({ "project_id": project })])
            .await
        {
            Ok(reply) if reply.first().is_some_and(Value::is_null) => {
                vec![json!({ "project": reply.get(1), "permissionsLevel": reply.get(2) })]
            }
            _ => {
                room.close().await;
                return fail(502, "Overleaf did not open the project.");
            }
        },
    };
    let Some(id) = crate::overleaf_workshop::new_live_id() else {
        room.close().await;
        return fail(502, "The live connection could not be stored.");
    };
    opener.rooms.insert(id.clone(), room);
    let mut reply = joined_project(&joined);
    reply["liveId"] = json!(id);
    // As Overleaf sent it, for the vendored IDE's own `joinProjectResponse`.
    reply["join"] = json!(joined);
    answer(200, &reply)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    #[test]
    fn frames_parse() {
        assert_eq!(parse_frame("2::"), Frame::Heartbeat);
        assert_eq!(parse_frame("1::"), Frame::Connect);
        assert_eq!(parse_frame("0::"), Frame::Disconnect);
        assert_eq!(
            parse_frame(r#"5:::{"name":"otUpdateApplied","args":[{"v":3}]}"#),
            Frame::Event {
                name: "otUpdateApplied".into(),
                args: vec![json!({ "v": 3 })]
            }
        );
        assert_eq!(
            parse_frame("6:::12+[null,1]"),
            Frame::Ack {
                id: 12,
                args: vec![Value::Null, json!(1)]
            }
        );
        assert_eq!(
            parse_frame("6:::4"),
            Frame::Ack {
                id: 4,
                args: vec![]
            }
        );
        assert_eq!(parse_frame("7:::bad"), Frame::Error("bad".into()));
        assert_eq!(parse_frame("5:::not json"), Frame::Other);
    }

    #[test]
    fn event_data_with_colons_survives() {
        let Frame::Event { args, .. } = parse_frame(r#"5:::{"name":"x","args":["a:b:c"]}"#) else {
            panic!("not an event");
        };
        assert_eq!(args, vec![json!("a:b:c")]);
    }

    #[test]
    fn payloads_split_by_utf16_length() {
        assert_eq!(split_payload("1::"), vec!["1::"]);
        assert!(split_payload("").is_empty());
        // "😀" is two UTF-16 units.
        let one = r#"5:::{"name":"x","args":["😀"]}"#;
        let units: usize = one.chars().map(char::len_utf16).sum();
        let body = format!("\u{fffd}{units}\u{fffd}{one}\u{fffd}3\u{fffd}2::");
        assert_eq!(split_payload(&body), vec![one.to_owned(), "2::".to_owned()]);
    }

    #[test]
    fn events_encode_with_an_ack_id() {
        let frame = encode_event(3, "joinDoc", &[json!("d")]);
        let data = frame.strip_prefix("5:3+::").expect("ack id prefix");
        let parsed: Value = serde_json::from_str(data).expect("json");
        assert_eq!(parsed, json!({ "name": "joinDoc", "args": ["d"] }));
    }

    #[test]
    fn handshake_needs_polling() {
        assert_eq!(
            handshake_sid("abc:60:60:websocket,xhr-polling"),
            Ok("abc".into())
        );
        assert!(handshake_sid("abc:60:60:websocket").is_err());
        assert!(handshake_sid("<html>").is_err());
    }

    #[test]
    fn doc_lines_decode_utf8_bytes() {
        assert_eq!(decode_doc_line("h\u{c3}\u{a9}llo"), "héllo");
        assert_eq!(decode_doc_line("plain"), "plain");
        // Not bytes: left as is.
        assert_eq!(decode_doc_line("😀"), "😀");
    }

    #[test]
    fn ids_are_checked() {
        assert!(is_overleaf_id("0123456789abcdef01234567"));
        assert!(!is_overleaf_id("../etc"));
    }

    const PROJECT: &str = "0123456789abcdef01234567";
    const DOC: &str = "89abcdef0123456789abcdef";

    /// One HTTP request off the socket: its head and body.
    async fn read_request(sock: &mut tokio::net::TcpStream) -> (String, String) {
        let mut buf = Vec::new();
        let mut chunk = [0u8; 4096];
        loop {
            let n = sock.read(&mut chunk).await.unwrap();
            buf.extend_from_slice(&chunk[..n]);
            let text = String::from_utf8_lossy(&buf).into_owned();
            if let Some((head, body)) = text.split_once("\r\n\r\n") {
                let len = head
                    .lines()
                    .find_map(|l| {
                        l.to_ascii_lowercase()
                            .strip_prefix("content-length: ")
                            .map(str::to_owned)
                    })
                    .and_then(|v| v.trim().parse::<usize>().ok())
                    .unwrap_or(0);
                if body.len() >= len || n == 0 {
                    return (head.to_owned(), body.to_owned());
                }
            }
        }
    }

    /// A poll's answer: the queued frames (events wrapped as `5:::`), or a noop after 0.5 s.
    async fn poll_reply(outbox: &Mutex<VecDeque<String>>) -> String {
        let mut out = Vec::new();
        for _ in 0..20 {
            out.extend(outbox.lock().unwrap().drain(..));
            if !out.is_empty() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
        if out.is_empty() {
            return "8::".to_owned();
        }
        out.iter()
            .map(|f| {
                let f = if f.starts_with('{') {
                    format!("5:::{f}")
                } else {
                    f.clone()
                };
                format!("\u{fffd}{}\u{fffd}{f}", f.encode_utf16().count())
            })
            .collect()
    }

    /// A socket.io 0.9 server on loopback: joins the project on the first poll, answers
    /// joinDoc and applyOtUpdate, and confirms the update with `otUpdateApplied`.
    async fn fake_overleaf() -> (String, Arc<Mutex<Vec<String>>>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}/", listener.local_addr().unwrap());
        let sent = Arc::new(Mutex::new(Vec::<String>::new()));
        let outbox = Arc::new(Mutex::new(VecDeque::<String>::from([
            "1::".to_owned(),
            json!({ "name": "joinProjectResponse", "args": [{
                "project": { "name": "Thesis", "rootDoc_id": DOC,
                    "rootFolder": [{ "docs": [{ "_id": DOC, "name": "main.tex" }] }] },
                "permissionsLevel": "owner" }] })
            .to_string(),
        ])));
        let seen = Arc::clone(&sent);
        drop(tokio::spawn(async move {
            loop {
                let (mut sock, _) = listener.accept().await.unwrap();
                let (sent, outbox) = (Arc::clone(&seen), Arc::clone(&outbox));
                drop(tokio::spawn(async move {
                    let (head, body) = read_request(&mut sock).await;
                    let line = head.lines().next().unwrap_or_default().to_owned();
                    let reply = if line.starts_with("GET /socket.io/1/?") {
                        "sid1:60:60:websocket,xhr-polling".to_owned()
                    } else if line.starts_with("GET /socket.io/1/xhr-polling/sid1") {
                        poll_reply(&outbox).await
                    } else if line.starts_with("POST /socket.io/1/xhr-polling/sid1") {
                        sent.lock().unwrap().push(body.clone());
                        if let Some(rest) = body.strip_prefix("5:") {
                            let id: String =
                                rest.chars().take_while(char::is_ascii_digit).collect();
                            let mut out = outbox.lock().unwrap();
                            if body.contains("\"joinDoc\"") {
                                out.push_back(format!(
                                    "6:::{id}+[null,[\"h\u{c3}\u{a9}\",\"b\"],7,[],{{}}]"
                                ));
                            } else if body.contains("\"applyOtUpdate\"") {
                                out.push_back(format!("6:::{id}+[null]"));
                                out.push_back(
                                    json!({ "name": "otUpdateApplied", "args": [{ "doc": DOC, "v": 7 }] }).to_string(),
                                );
                            } else {
                                out.push_back(format!("6:::{id}+[null]"));
                            }
                        }
                        "1".to_owned()
                    } else {
                        String::new()
                    };
                    let response = format!(
                        "HTTP/1.1 200 OK\r\ncontent-type: text/plain; charset=UTF-8\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{reply}",
                        reply.len()
                    );
                    let _ = sock.write_all(response.as_bytes()).await;
                }));
            }
        }));
        (base, sent)
    }

    fn body_of(answer: &Answer) -> Value {
        serde_json::from_slice(&answer.body).unwrap()
    }

    /// The IDE's own events go through as they are, reply and all; others are refused.
    async fn assert_ide_events_pass(opener: &Opener<'_>, live: &str) {
        let raw = serve(
            opener,
            "emit",
            &json!({ "liveId": live, "name": "joinDoc", "args": [DOC, { "encodeRanges": true }] }),
            None,
        )
        .await;
        assert_eq!(raw.status, 200);
        assert_eq!(
            body_of(&raw)["reply"],
            json!([null, ["h\u{c3}\u{a9}", "b"], 7, [], {}])
        );
        let refused = serve(
            opener,
            "emit",
            &json!({ "liveId": live, "name": "joinProject", "args": [] }),
            None,
        )
        .await;
        assert_eq!(refused.status, 400);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn a_room_opens_reads_a_doc_and_sends_an_edit() {
        let (base, sent) = fake_overleaf().await;
        let client = reqwest::Client::new();
        let rooms = Rooms::default();
        let opener = Opener {
            client: &client,
            base: &base,
            rooms: &rooms,
        };

        let opened = serve(
            &opener,
            "open",
            &json!({ "projectId": PROJECT }),
            Some("c=1".into()),
        )
        .await;
        assert_eq!(opened.status, 200);
        let opened = body_of(&opened);
        assert_eq!(opened["name"], "Thesis");
        assert_eq!(opened["rootDocId"], DOC);
        assert_eq!(opened["join"][0]["project"]["name"], "Thesis");
        assert_eq!(opened["join"][0]["permissionsLevel"], "owner");
        let live = opened["liveId"].as_str().unwrap().to_owned();

        assert_ide_events_pass(&opener, &live).await;

        let doc = serve(
            &opener,
            "doc",
            &json!({ "liveId": live, "docId": DOC }),
            None,
        )
        .await;
        assert_eq!(body_of(&doc), json!({ "lines": ["hé", "b"], "version": 7 }));

        let op = json!([{ "p": 0, "i": "x" }]);
        let update = serve(
            &opener,
            "update",
            &json!({ "liveId": live, "docId": DOC, "op": op, "version": 7 }),
            None,
        )
        .await;
        assert_eq!(update.status, 200);
        let events = body_of(&serve(&opener, "events", &json!({ "liveId": live }), None).await);
        assert_eq!(events["events"][0]["name"], "otUpdateApplied");
        assert!(
            sent.lock()
                .unwrap()
                .iter()
                .any(|b| b.contains("applyOtUpdate") && b.contains("\"v\":7"))
        );

        let closed = serve(&opener, "close", &json!({ "liveId": live }), None).await;
        assert_eq!(closed.status, 200);
        let gone = serve(&opener, "events", &json!({ "liveId": live }), None).await;
        assert_eq!(gone.status, 410);
        assert!(sent.lock().unwrap().iter().any(|b| b == "0::"));
    }

    #[tokio::test]
    async fn bad_requests_are_refused_without_network() {
        let client = reqwest::Client::new();
        let rooms = Rooms::default();
        let opener = Opener {
            client: &client,
            base: "http://127.0.0.1:9/",
            rooms: &rooms,
        };
        let no_project = serve(
            &opener,
            "open",
            &json!({ "projectId": "../x" }),
            Some("c".into()),
        )
        .await;
        assert_eq!(no_project.status, 400);
        let signed_out = serve(&opener, "open", &json!({ "projectId": PROJECT }), None).await;
        assert_eq!(signed_out.status, 401);
        let no_room = serve(
            &opener,
            "doc",
            &json!({ "liveId": "nope", "docId": DOC }),
            None,
        )
        .await;
        assert_eq!(no_room.status, 410);
    }
}
