//! MCP stdio bridge: one JSON-RPC message per line on stdin, one answer per line on stdout.
//! Forwards to the desktop app's loopback MCP endpoint; nothing leaves this computer.

use std::ffi::OsStr;
use std::io;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde_json::{Value, json};
use tokio::io::{
    AsyncBufRead, AsyncBufReadExt, AsyncReadExt, AsyncWrite, AsyncWriteExt, BufReader,
};
use tokio::net::TcpStream;
use tokio::runtime::Builder;
use tokio::time::timeout;

const PROTOCOL_VERSION: &str = "2025-06-18";
const DEFAULT_URL: &str = "http://127.0.0.1:27123/mcp";
const CONNECT_HINT: &str = "Open WeaveForge, go to Settings → AI & MCP and press Connect.";
const CLOSED_HINT: &str = "WeaveForge is not running. Open WeaveForge, then try again.";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(120);
const LOG_PREFIX: &str = "[weaveforge-mcp] ";

/// Where the bridge finds the app and the token.
#[derive(Debug, Clone)]
pub struct BridgeConfig {
    /// User home; `.weaveforge` lives under it.
    pub home: PathBuf,
    /// Config file (`WEAVEFORGE_MCP_FILE`); defaults to `~/.weaveforge/mcp.json`.
    pub mcp_file: Option<PathBuf>,
    /// Token override (`WEAVEFORGE_TOKEN`); wins over the file.
    pub token_override: Option<String>,
    /// URL override (`WEAVEFORGE_MCP_URL`); wins over the file.
    pub url_override: Option<String>,
}

impl BridgeConfig {
    /// Reads the three env overrides; an empty value counts as unset.
    #[must_use]
    pub fn from_env(home: PathBuf) -> Self {
        Self {
            home,
            mcp_file: non_empty_env("WEAVEFORGE_MCP_FILE").map(PathBuf::from),
            token_override: non_empty_env("WEAVEFORGE_TOKEN"),
            url_override: non_empty_env("WEAVEFORGE_MCP_URL"),
        }
    }
}

fn non_empty_env(name: &str) -> Option<String> {
    std::env::var(name).ok().filter(|value| !value.is_empty())
}

/// Answers one input line; `None` when nothing goes back on stdout.
pub async fn handle_line(cfg: &BridgeConfig, line: &str) -> Option<String> {
    if line.trim().is_empty() {
        return None;
    }
    let Ok(request) = serde_json::from_str::<Value>(line) else {
        return Some(failure(&Value::Null, -32700, "Not JSON.").to_string());
    };
    // `null`, a number or a string parses but is no request.
    if !(request.is_object() || request.is_array()) {
        return Some(failure(&Value::Null, -32600, "Invalid request.").to_string());
    }
    match forward(cfg, &request).await {
        Ok(answer) => answer.map(|value| value.to_string()),
        Err(error) => {
            log(&error.to_string());
            request_id(&request).map(|id| failure(&id, -32603, "Bridge error.").to_string())
        }
    }
}

/// Reads lines from `input` and writes one answer per line to `output`, until EOF.
/// Requests are handled one at a time, in order.
///
/// # Errors
/// Returns the first read or write error.
pub async fn run<R, W>(cfg: &BridgeConfig, input: R, mut output: W) -> io::Result<()>
where
    R: AsyncBufRead + Unpin,
    W: AsyncWrite + Unpin,
{
    let mut lines = input.lines();
    while let Some(line) = lines.next_line().await? {
        if let Some(answer) = handle_line(cfg, &line).await {
            output.write_all(answer.as_bytes()).await?;
            output.write_all(b"\n").await?;
            output.flush().await?;
        }
    }
    Ok(())
}

/// Runs the bridge on stdin/stdout until EOF; returns the process exit code.
#[must_use]
pub fn run_stdio(home: PathBuf) -> i32 {
    let cfg = BridgeConfig::from_env(home);
    let runtime = match Builder::new_current_thread().enable_all().build() {
        Ok(runtime) => runtime,
        Err(error) => {
            log(&format!("cannot start runtime: {error}"));
            return 1;
        }
    };
    match runtime.block_on(run(
        &cfg,
        BufReader::new(tokio::io::stdin()),
        tokio::io::stdout(),
    )) {
        Ok(()) => 0,
        Err(error) => {
            log(&format!("stdio error: {error}"));
            1
        }
    }
}

async fn forward(cfg: &BridgeConfig, request: &Value) -> io::Result<Option<Value>> {
    let notification = request_id(request).is_none();
    let (url, token) = settings(cfg);
    let Some(target) = loopback_target(&url) else {
        log(&format!("refusing {url}: only http://127.0.0.1 is allowed"));
        return Ok((!notification).then(|| {
            failure(
                &id_of(request),
                -32000,
                "WeaveForge MCP only talks to 127.0.0.1.",
            )
        }));
    };
    if token.is_empty() {
        let why = format!("Not connected. {CONNECT_HINT}");
        return Ok((!notification).then(|| offline(cfg, request, &why)));
    }

    let (status, body) = match post(&target, &token, &request.to_string()).await? {
        Outcome::Reply { status, body } => (status, body),
        Outcome::Unreachable(error) => {
            log(&format!("cannot reach {url}: {}", error_code_text(&error)));
            return Ok((!notification).then(|| offline(cfg, request, CLOSED_HINT)));
        }
    };
    if status == 401 || status == 403 {
        let why = format!("The saved token was refused. {CONNECT_HINT}");
        return Ok((!notification).then(|| offline(cfg, request, &why)));
    }
    if notification || status == 202 || body.is_empty() {
        return Ok(None);
    }
    match serde_json::from_str::<Value>(&body) {
        Ok(value) => Ok(Some(value)),
        Err(_) => {
            log(&format!(
                "unexpected answer ({status}): {}",
                body.chars().take(200).collect::<String>()
            ));
            Ok(Some(failure(
                &id_of(request),
                -32000,
                &format!("WeaveForge answered {status}."),
            )))
        }
    }
}

/// Answer for when the app cannot be reached, so a client can still start.
fn offline(cfg: &BridgeConfig, request: &Value, why: &str) -> Value {
    let id = id_of(request);
    match request.get("method").and_then(Value::as_str) {
        Some("initialize") => reply(
            &id,
            &json!({
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "weaveforge-workspace", "version": "1"},
            }),
        ),
        Some("ping") => reply(&id, &json!({})),
        Some("tools/list") => {
            let tools = read_json(&tools_path(cfg))
                .and_then(|cached| {
                    cached
                        .get("tools")
                        .filter(|tools| tools.is_array())
                        .cloned()
                })
                .unwrap_or_else(|| json!([]));
            reply(&id, &json!({"tools": tools}))
        }
        Some("tools/call") => reply(
            &id,
            &json!({"isError": true, "content": [{"type": "text", "text": why}]}),
        ),
        _ => failure(
            &id,
            -32601,
            &format!("No method named {}.", method_text(request)),
        ),
    }
}

enum Outcome {
    Reply { status: u16, body: String },
    Unreachable(io::Error),
}

/// One HTTP/1.1 POST to the app; a connect failure is `Unreachable`, not an error.
async fn post(target: &Target, token: &str, body: &str) -> io::Result<Outcome> {
    if token.chars().any(char::is_control) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "saved token is not a valid header value",
        ));
    }
    let head = format!(
        "POST {} HTTP/1.1\r\nHost: {}\r\nAuthorization: Bearer {token}\r\nContent-Type: application/json\r\nAccept: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        target.path,
        target.host_header,
        body.len(),
    );
    let request = head + body;
    timeout(REQUEST_TIMEOUT, exchange(target, request.as_bytes()))
        .await
        .unwrap_or_else(|_| {
            Err(io::Error::new(
                io::ErrorKind::TimedOut,
                "no answer within 120 s",
            ))
        })
}

async fn exchange(target: &Target, request: &[u8]) -> io::Result<Outcome> {
    let mut stream = match TcpStream::connect((target.connect_host.as_str(), target.port)).await {
        Ok(stream) => stream,
        Err(error) => return Ok(Outcome::Unreachable(error)),
    };
    stream.write_all(request).await?;
    let mut raw = Vec::new();
    let _ = stream.read_to_end(&mut raw).await?;
    parse_response(&raw)
}

/// Status and body of a response that ends at EOF; `Content-Length` bounds the body when present.
fn parse_response(raw: &[u8]) -> io::Result<Outcome> {
    let end = raw
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .ok_or_else(|| invalid("no end of HTTP headers"))?;
    let head = String::from_utf8_lossy(&raw[..end]);
    let mut lines = head.split("\r\n");
    let status = lines
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .and_then(|code| code.parse::<u16>().ok())
        .ok_or_else(|| invalid("bad status line"))?;
    let length = lines
        .filter_map(|line| line.split_once(':'))
        .find(|(name, _)| name.trim().eq_ignore_ascii_case("content-length"))
        .and_then(|(_, value)| value.trim().parse::<usize>().ok());
    let rest = &raw[end + 4..];
    let body = match length {
        Some(length) => &rest[..length.min(rest.len())],
        None => rest,
    };
    Ok(Outcome::Reply {
        status,
        body: String::from_utf8_lossy(body).into_owned(),
    })
}

fn invalid(message: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message)
}

struct Target {
    host_header: String,
    connect_host: String,
    port: u16,
    path: String,
}

/// Plain http to 127.0.0.1, localhost or [::1] only; `None` for anything else.
fn loopback_target(url: &str) -> Option<Target> {
    let (scheme, rest) = url.split_once("://")?;
    if !scheme.eq_ignore_ascii_case("http") {
        return None;
    }
    let end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
    let (authority, tail) = rest.split_at(end);
    let authority = authority
        .rsplit_once('@')
        .map_or(authority, |(_, host)| host);
    let (host, port) = split_authority(authority)?;
    let host = host.to_ascii_lowercase();
    if !matches!(host.as_str(), "127.0.0.1" | "localhost" | "[::1]") {
        return None;
    }
    let port = if port.is_empty() {
        80
    } else {
        port.parse::<u16>().ok()?
    };
    let tail = tail.split('#').next().unwrap_or("");
    // A space or line break would split the request line.
    if tail.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return None;
    }
    let path = if tail.is_empty() {
        "/".to_owned()
    } else if tail.starts_with('/') {
        tail.to_owned()
    } else {
        format!("/{tail}")
    };
    Some(Target {
        host_header: format!("{host}:{port}"),
        connect_host: host
            .trim_start_matches('[')
            .trim_end_matches(']')
            .to_owned(),
        port,
        path,
    })
}

/// Splits `host[:port]`; IPv6 hosts keep their brackets. Port text is empty when absent.
fn split_authority(authority: &str) -> Option<(&str, &str)> {
    if authority.starts_with('[') {
        let close = authority.find(']')?;
        let (host, rest) = authority.split_at(close + 1);
        return match rest {
            "" => Some((host, "")),
            _ => Some((host, rest.strip_prefix(':')?)),
        };
    }
    Some(authority.split_once(':').unwrap_or((authority, "")))
}

/// URL and token: env override, else the config file, else the defaults.
fn settings(cfg: &BridgeConfig) -> (String, String) {
    let file = read_json(&config_path(cfg)).unwrap_or(Value::Null);
    let url = cfg
        .url_override
        .clone()
        .filter(|value| !value.is_empty())
        .or_else(|| file["url"].as_str().map(str::to_owned))
        .unwrap_or_else(|| DEFAULT_URL.to_owned());
    let token = cfg
        .token_override
        .clone()
        .filter(|value| !value.is_empty())
        .or_else(|| file["token"].as_str().map(str::to_owned))
        .unwrap_or_default();
    (url, token)
}

fn config_path(cfg: &BridgeConfig) -> PathBuf {
    cfg.mcp_file
        .clone()
        .unwrap_or_else(|| cfg.home.join(".weaveforge").join("mcp.json"))
}

/// Cached tools sit beside the config as `<dir>/<stem>/tools.json`.
fn tools_path(cfg: &BridgeConfig) -> PathBuf {
    let config = config_path(cfg);
    let dir = config.parent().unwrap_or(Path::new("")).to_path_buf();
    let stem = config.file_stem().unwrap_or(OsStr::new("mcp"));
    dir.join(stem).join("tools.json")
}

fn read_json(path: &Path) -> Option<Value> {
    let text = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&text).ok()
}

fn request_id(request: &Value) -> Option<Value> {
    request.get("id").filter(|id| !id.is_null()).cloned()
}

fn id_of(request: &Value) -> Value {
    request_id(request).unwrap_or(Value::Null)
}

fn method_text(request: &Value) -> String {
    match request.get("method") {
        None | Some(Value::Null) => String::new(),
        Some(Value::String(method)) => method.clone(),
        Some(other) => other.to_string(),
    }
}

fn error_code_text(error: &io::Error) -> String {
    if error.kind() == io::ErrorKind::ConnectionRefused {
        "ECONNREFUSED".to_owned()
    } else {
        error.to_string()
    }
}

fn reply(id: &Value, result: &Value) -> Value {
    json!({"jsonrpc": "2.0", "id": id, "result": result})
}

fn failure(id: &Value, code: i64, message: &str) -> Value {
    json!({"jsonrpc": "2.0", "id": id, "error": {"code": code, "message": message}})
}

fn log(message: &str) {
    eprintln!("{LOG_PREFIX}{message}");
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::future::Future;
    use std::path::{Path, PathBuf};
    use std::time::Duration;

    use serde_json::{Value, json};
    use tokio::io::{AsyncReadExt, AsyncWriteExt, BufReader};
    use tokio::net::{TcpListener, TcpStream};
    use tokio::runtime::Builder;
    use tokio::task::JoinHandle;
    use tokio::time::timeout;

    use super::{BridgeConfig, handle_line, loopback_target, run};

    fn block_on<F: Future>(future: F) -> F::Output {
        Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("runtime")
            .block_on(future)
    }

    /// Temp home removed on drop; nothing else is touched.
    struct TempHome(PathBuf);

    impl TempHome {
        fn new(name: &str) -> Self {
            let dir = std::env::temp_dir().join(format!("wf-bridge-{}-{name}", std::process::id()));
            let _ = fs::remove_dir_all(&dir);
            fs::create_dir_all(&dir).expect("temp home");
            Self(dir)
        }

        fn path(&self, rel: &str) -> PathBuf {
            self.0.join(rel)
        }

        fn cfg(
            &self,
            mcp_file: Option<PathBuf>,
            token: Option<&str>,
            url: Option<&str>,
        ) -> BridgeConfig {
            BridgeConfig {
                home: self.0.clone(),
                mcp_file,
                token_override: token.map(str::to_owned),
                url_override: url.map(str::to_owned),
            }
        }
    }

    impl Drop for TempHome {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn write_json(path: &Path, value: &Value) {
        fs::create_dir_all(path.parent().expect("parent")).expect("dirs");
        fs::write(path, value.to_string()).expect("write");
    }

    async fn ask(cfg: &BridgeConfig, line: &str) -> Value {
        let answer = handle_line(cfg, line).await.expect("answer");
        serde_json::from_str(&answer).expect("json")
    }

    fn text(answer: &Value) -> &str {
        answer["result"]["content"][0]["text"]
            .as_str()
            .unwrap_or("")
    }

    fn message(answer: &Value) -> &str {
        answer["error"]["message"].as_str().unwrap_or("")
    }

    /// A loopback port with nothing listening on it.
    async fn closed_port() -> u16 {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        listener.local_addr().expect("addr").port()
    }

    /// Reads one HTTP request; returns its Authorization header and body.
    async fn read_request(socket: &mut TcpStream) -> (Option<String>, String) {
        let mut buf = Vec::new();
        let head_end = loop {
            if let Some(pos) = buf.windows(4).position(|window| window == b"\r\n\r\n") {
                break pos;
            }
            let mut chunk = [0u8; 1024];
            let n = socket.read(&mut chunk).await.expect("read");
            assert!(n > 0, "client closed before head");
            buf.extend_from_slice(&chunk[..n]);
        };
        let head = String::from_utf8_lossy(&buf[..head_end]).into_owned();
        let auth = head
            .lines()
            .find_map(|line| line.strip_prefix("Authorization: "))
            .map(str::to_owned);
        let length: usize = head
            .lines()
            .find_map(|line| line.strip_prefix("Content-Length: "))
            .and_then(|value| value.trim().parse().ok())
            .unwrap_or(0);
        let body_start = head_end + 4;
        while buf.len() < body_start + length {
            let mut chunk = [0u8; 1024];
            let n = socket.read(&mut chunk).await.expect("read");
            assert!(n > 0, "client closed before body");
            buf.extend_from_slice(&chunk[..n]);
        }
        (
            auth,
            String::from_utf8_lossy(&buf[body_start..body_start + length]).into_owned(),
        )
    }

    /// Accepts `expected` connections, answers each with `respond(body)`, returns the Authorization values seen.
    async fn serve(
        listener: TcpListener,
        expected: usize,
        respond: fn(&str) -> (u16, String),
    ) -> Vec<Option<String>> {
        let mut seen = Vec::new();
        for _ in 0..expected {
            let (mut socket, _) = listener.accept().await.expect("accept");
            let (auth, body) = read_request(&mut socket).await;
            let (status, reply) = respond(&body);
            let head = format!(
                "HTTP/1.1 {status} OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                reply.len()
            );
            socket
                .write_all(format!("{head}{reply}").as_bytes())
                .await
                .expect("write");
            seen.push(auth);
        }
        seen
    }

    /// Fake app on 127.0.0.1 answering in the background; returns its port.
    async fn spawn_app(
        expected: usize,
        respond: fn(&str) -> (u16, String),
    ) -> (u16, JoinHandle<Vec<Option<String>>>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let port = listener.local_addr().expect("addr").port();
        (port, tokio::spawn(serve(listener, expected, respond)))
    }

    fn echo(body: &str) -> (u16, String) {
        let request: Value = serde_json::from_str(body).expect("json");
        match request.get("id") {
            None => (202, String::new()),
            Some(id) => (
                200,
                json!({"jsonrpc": "2.0", "id": id, "result": {"echoed": request["method"]}})
                    .to_string(),
            ),
        }
    }

    fn accepted(_body: &str) -> (u16, String) {
        (202, String::new())
    }

    fn refuse(body: &str) -> (u16, String) {
        if body.contains("\"tools/call\"") {
            (401, String::new())
        } else {
            (500, "<html>boom</html>".to_owned())
        }
    }

    #[test]
    fn forwards_with_saved_token_and_stays_quiet_on_notifications() {
        block_on(async {
            let (port, app) = spawn_app(3, echo).await;
            let home = TempHome::new("forward");
            let file = home.path("mcp.json");
            write_json(
                &file,
                &json!({"url": format!("http://127.0.0.1:{port}/mcp"), "token": "abc"}),
            );
            let cfg = home.cfg(Some(file), None, None);
            let mut answers = Vec::new();
            for line in [
                r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}"#,
                r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#,
                r#"{"jsonrpc":"2.0","id":2,"method":"tools/list"}"#,
                "not json",
            ] {
                answers.extend(handle_line(&cfg, line).await);
            }
            let seen = timeout(Duration::from_secs(10), app)
                .await
                .expect("app")
                .expect("join");
            assert_eq!(seen, vec![Some("Bearer abc".to_owned()); 3]);
            let parsed: Vec<Value> = answers
                .iter()
                .map(|answer| serde_json::from_str(answer).expect("json"))
                .collect();
            assert_eq!(
                parsed,
                vec![
                    json!({"jsonrpc": "2.0", "id": 1, "result": {"echoed": "initialize"}}),
                    json!({"jsonrpc": "2.0", "id": 2, "result": {"echoed": "tools/list"}}),
                    json!({"jsonrpc": "2.0", "id": null, "error": {"code": -32700, "message": "Not JSON."}}),
                ]
            );
        });
    }

    #[test]
    fn app_closed_serves_cached_tools_and_says_to_open_weaveforge() {
        block_on(async {
            let home = TempHome::new("closed");
            let port = closed_port().await;
            write_json(
                &home.path(".weaveforge/mcp.json"),
                &json!({"url": format!("http://127.0.0.1:{port}/mcp"), "token": "abc"}),
            );
            write_json(
                &home.path(".weaveforge/mcp/tools.json"),
                &json!({"tools": [{"name": "search_workspace"}]}),
            );
            let cfg = home.cfg(None, None, None);
            let init = ask(
                &cfg,
                r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}"#,
            )
            .await;
            let list = ask(&cfg, r#"{"jsonrpc":"2.0","id":2,"method":"tools/list"}"#).await;
            let call = ask(&cfg, r#"{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"search_workspace","arguments":{}}}"#).await;
            assert_eq!(init["result"]["serverInfo"]["name"], "weaveforge-workspace");
            assert_eq!(
                list["result"],
                json!({"tools": [{"name": "search_workspace"}]})
            );
            assert_eq!(call["result"]["isError"], true);
            assert!(text(&call).contains("Open WeaveForge"), "{}", text(&call));
        });
    }

    #[test]
    fn no_token_asks_to_connect_and_non_loopback_url_is_refused_without_sending() {
        block_on(async {
            let home = TempHome::new("connect");
            let missing = home.cfg(Some(home.path("none.json")), None, None);
            let call = ask(
                &missing,
                r#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"x"}}"#,
            )
            .await;
            assert!(text(&call).contains("Connect"), "{}", text(&call));

            let remote = home.cfg(
                Some(home.path("none.json")),
                Some("abc"),
                Some("https://example.com/mcp"),
            );
            let list = ask(&remote, r#"{"jsonrpc":"2.0","id":1,"method":"tools/list"}"#).await;
            assert!(message(&list).contains("127.0.0.1"), "{}", message(&list));

            // A live listener that must never see a connection: the token stays off other hosts.
            let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
            let port = listener.local_addr().expect("addr").port();
            for url in [
                format!("https://127.0.0.1:{port}/mcp"),
                format!("http://10.0.0.5:{port}/mcp"),
                format!("http://127.0.0.1.example.com:{port}/mcp"),
            ] {
                let cfg = home.cfg(
                    Some(home.path("none.json")),
                    Some("abc"),
                    Some(url.as_str()),
                );
                let refused = ask(&cfg, r#"{"jsonrpc":"2.0","id":1,"method":"tools/list"}"#).await;
                assert!(message(&refused).contains("127.0.0.1"), "{url}");
            }
            assert!(
                timeout(Duration::from_millis(200), listener.accept())
                    .await
                    .is_err()
            );
        });
    }

    #[test]
    fn non_request_json_gets_invalid_request_and_later_lines_are_still_answered() {
        block_on(async {
            let home = TempHome::new("shapes");
            let cfg = home.cfg(Some(home.path("none.json")), None, None);
            for line in ["null", "42", "\"text\""] {
                let answer = ask(&cfg, line).await;
                assert_eq!(
                    answer,
                    json!({"jsonrpc": "2.0", "id": null, "error": {"code": -32600, "message": "Invalid request."}})
                );
            }
            let call = ask(
                &cfg,
                r#"{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"x"}}"#,
            )
            .await;
            assert_eq!(call["id"], 7);
            assert!(text(&call).contains("Connect"), "{}", text(&call));
        });
    }

    #[test]
    fn app_down_without_cache_gives_closed_hint_and_empty_tools() {
        block_on(async {
            let home = TempHome::new("down");
            let port = closed_port().await;
            let url = format!("http://127.0.0.1:{port}/mcp");
            let cfg = home.cfg(
                Some(home.path("none.json")),
                Some("abc"),
                Some(url.as_str()),
            );
            let list = ask(&cfg, r#"{"jsonrpc":"2.0","id":1,"method":"tools/list"}"#).await;
            assert_eq!(list["result"], json!({"tools": []}));
            let call = ask(
                &cfg,
                r#"{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"x"}}"#,
            )
            .await;
            assert_eq!(call["result"]["isError"], true);
            assert!(text(&call).contains("Open WeaveForge"), "{}", text(&call));
        });
    }

    #[test]
    fn accepted_202_produces_no_output() {
        block_on(async {
            let (port, app) = spawn_app(1, accepted).await;
            let home = TempHome::new("accepted");
            let url = format!("http://127.0.0.1:{port}/mcp");
            let cfg = home.cfg(
                Some(home.path("none.json")),
                Some("abc"),
                Some(url.as_str()),
            );
            let answer =
                handle_line(&cfg, r#"{"jsonrpc":"2.0","id":1,"method":"tools/list"}"#).await;
            assert_eq!(answer, None);
            let _ = timeout(Duration::from_secs(10), app)
                .await
                .expect("app")
                .expect("join");
        });
    }

    #[test]
    fn rejected_token_and_server_error_are_answered_as_index_mjs_does() {
        block_on(async {
            let (port, app) = spawn_app(2, refuse).await;
            let home = TempHome::new("refused");
            let url = format!("http://127.0.0.1:{port}/mcp");
            let cfg = home.cfg(
                Some(home.path("none.json")),
                Some("abc"),
                Some(url.as_str()),
            );
            let call = ask(
                &cfg,
                r#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"x"}}"#,
            )
            .await;
            assert!(text(&call).contains("refused"), "{}", text(&call));
            let list = ask(&cfg, r#"{"jsonrpc":"2.0","id":2,"method":"tools/list"}"#).await;
            assert_eq!(
                list["error"],
                json!({"code": -32000, "message": "WeaveForge answered 500."})
            );
            let _ = timeout(Duration::from_secs(10), app)
                .await
                .expect("app")
                .expect("join");
        });
    }

    #[test]
    fn mcp_dev_config_uses_mcp_dev_tools_cache() {
        block_on(async {
            let home = TempHome::new("dev");
            let port = closed_port().await;
            let file = home.path(".weaveforge/mcp-dev.json");
            write_json(
                &file,
                &json!({"url": format!("http://127.0.0.1:{port}/mcp"), "token": "abc"}),
            );
            write_json(
                &home.path(".weaveforge/mcp-dev/tools.json"),
                &json!({"tools": [{"name": "dev_tool"}]}),
            );
            write_json(
                &home.path(".weaveforge/mcp/tools.json"),
                &json!({"tools": [{"name": "stable_tool"}]}),
            );
            let cfg = home.cfg(Some(file), None, None);
            let list = ask(&cfg, r#"{"jsonrpc":"2.0","id":1,"method":"tools/list"}"#).await;
            assert_eq!(list["result"], json!({"tools": [{"name": "dev_tool"}]}));
        });
    }

    #[test]
    fn run_answers_each_line_in_order_and_skips_blank_lines() {
        block_on(async {
            let home = TempHome::new("run");
            let cfg = home.cfg(Some(home.path("none.json")), None, None);
            let input = BufReader::new(&b"\n\"text\"\n   \nnull\n"[..]);
            let (mut reader, writer) = tokio::io::duplex(4096);
            run(&cfg, input, writer).await.expect("run");
            let mut out = String::new();
            let _ = reader.read_to_string(&mut out).await.expect("read");
            let lines: Vec<&str> = out.lines().collect();
            assert_eq!(lines.len(), 2);
            assert!(out.ends_with('\n'));
            for line in lines {
                let answer: Value = serde_json::from_str(line).expect("json");
                assert_eq!(answer["error"]["code"], -32600);
            }
        });
    }

    #[test]
    fn only_plain_http_to_this_computer_is_allowed() {
        for url in [
            "http://127.0.0.1:27123/mcp",
            "http://localhost/mcp",
            "HTTP://LOCALHOST:8080",
            "http://[::1]:27123/mcp",
        ] {
            assert!(loopback_target(url).is_some(), "{url}");
        }
        for url in [
            "https://127.0.0.1/mcp",
            "http://example.com/mcp",
            "http://127.0.0.1.example.com/",
            "http://10.0.0.5/",
            "http://127.0.0.1:99999/",
            "http://user@evil.com/?@127.0.0.1",
            "",
            "127.0.0.1",
        ] {
            assert!(loopback_target(url).is_none(), "{url}");
        }
    }
}
