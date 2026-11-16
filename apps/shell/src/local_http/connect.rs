//! The files Connect (Settings → AI & MCP) leaves for AI clients. Ported from `mcp-connect.ts`.
//!
//! `~/.weaveforge/mcp.json` holds the connection for this user; the bridge and its cached tool
//! list sit in `~/.weaveforge/mcp/`. WeaveForge Dev uses `mcp-dev.json` and `mcp-dev/`.

use std::collections::BTreeMap;
use std::ffi::OsStr;
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};

use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::Permission;

/// The bridge script's file name inside the bridge folder.
pub const MCP_BRIDGE_FILE: &str = "weaveforge-mcp.mjs";
/// Read, drafts, and experiment logging for the agent's training scripts.
pub const MCP_CLIENT_PERMISSIONS: [Permission; 3] = [
    Permission::McpRead,
    Permission::McpSuggest,
    Permission::Experiments,
];
/// The token name shown in WeaveForge for AI clients.
pub const MCP_CLIENT_TOKEN_NAME: &str = "AI clients";
/// The config folder under the home directory.
pub const HOME_CONFIG_DIR: &str = ".weaveforge";
/// The clients the app opens itself; anything else gets a snippet to copy.
pub const MCP_OPEN_CLIENTS: [&str; 3] = ["cursor", "vscode", "claude-desktop"];

const ELECTRON_FLAG: &str = "ELECTRON_RUN_AS_NODE";
const MCP_FILE_ENV: &str = "WEAVEFORGE_MCP_FILE";

/// Where one variant's token file and bridge folder live.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct McpPaths {
    /// The token file.
    pub file: PathBuf,
    /// Where the bridge script and `tools.json` are copied.
    pub dir: PathBuf,
    /// The bridge inside the app bundle, if one is shipped.
    pub bridge_source: Option<PathBuf>,
}

/// The connection Connect saves. Field names are camelCase on disk.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct McpConnection {
    /// The MCP endpoint URL the clients call.
    pub url: String,
    /// The base API URL of the local server.
    pub api_url: String,
    /// The bearer token for the connection.
    pub token: String,
    /// The token's id, used to revoke it.
    pub token_id: String,
}

/// How a client starts the bridge: the command, its args, and the env it sets.
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct McpLaunch {
    /// The executable to run.
    pub command: String,
    /// Arguments passed to the command.
    pub args: Vec<String>,
    /// Environment variables set for the bridge process.
    pub env: BTreeMap<String, String>,
}

/// The token file and folder for `variant` (`mcp` or `mcp-{variant}`) under `home`.
#[must_use]
pub fn mcp_paths(home: &Path, variant: Option<&str>, bridge_source: Option<PathBuf>) -> McpPaths {
    let base = home.join(HOME_CONFIG_DIR);
    let stem = match variant.filter(|v| !v.is_empty()) {
        Some(v) => format!("mcp-{v}"),
        None => "mcp".to_owned(),
    };
    McpPaths {
        file: base.join(format!("{stem}.json")),
        dir: base.join(&stem),
        bridge_source,
    }
}

/// The saved connection, or `None` when the file is missing, not JSON, or has an empty or non-string field.
#[must_use]
pub fn read_mcp_connection(file: &Path) -> Option<McpConnection> {
    let text = fs::read_to_string(file).ok()?;
    let value: Value = serde_json::from_str(&text).ok()?;
    let filled = ["url", "apiUrl", "token", "tokenId"].iter().all(|key| {
        value
            .get(*key)
            .and_then(Value::as_str)
            .is_some_and(|s| !s.is_empty())
    });
    if !filled {
        return None;
    }
    serde_json::from_value(value).ok()
}

/// Writes the token file (mode 0600 on unix), the bridge copy, and `tools.json`.
///
/// # Errors
/// Returns the first I/O error from creating the folder or writing a file.
pub fn write_mcp_connection(
    paths: &McpPaths,
    conn: &McpConnection,
    tools: &[Value],
) -> io::Result<()> {
    fs::create_dir_all(&paths.dir)?;
    write_private_file(&paths.file, &pretty_with_newline(conn)?)?;
    if let Some(source) = &paths.bridge_source {
        fs::write(paths.dir.join(MCP_BRIDGE_FILE), fs::read(source)?)?;
    }
    fs::write(
        paths.dir.join("tools.json"),
        pretty_with_newline(&serde_json::json!({ "tools": tools }))?,
    )
}

/// Deletes the token file; a missing file is not an error.
///
/// # Errors
/// Returns any I/O error other than `NotFound`.
pub fn remove_mcp_connection(file: &Path) -> io::Result<()> {
    match fs::remove_file(file) {
        Err(error) if error.kind() != io::ErrorKind::NotFound => Err(error),
        _ => Ok(()),
    }
}

/// How a client starts the bridge. The shell binary itself is the bridge: `exe --mcp-bridge`.
///
/// `WEAVEFORGE_MCP_FILE` is set only for a variant file (anything but `mcp.json`).
#[must_use]
pub fn mcp_launch(paths: &McpPaths, exe: &Path) -> McpLaunch {
    let mut env = BTreeMap::new();
    if paths.file.file_name().and_then(OsStr::to_str) != Some("mcp.json") {
        let _ = env.insert(
            MCP_FILE_ENV.to_owned(),
            paths.file.to_string_lossy().into_owned(),
        );
    }
    McpLaunch {
        command: exe.to_string_lossy().into_owned(),
        args: vec!["--mcp-bridge".to_owned()],
        env,
    }
}

/// Cursor's install link: the launch as base64 JSON.
#[must_use]
pub fn cursor_install_link(launch: &McpLaunch) -> String {
    let config = base64::engine::general_purpose::STANDARD
        .encode(serde_json::to_string(launch).unwrap_or_default());
    format!(
        "cursor://anysphere.cursor-deeplink/mcp/install?name=weaveforge&config={}",
        encode_uri_component(&config)
    )
}

#[derive(Serialize)]
struct VscodeEntry<'a> {
    name: &'static str,
    #[serde(flatten)]
    launch: &'a McpLaunch,
}

/// VS Code's install link: the server entry as URL-encoded JSON.
#[must_use]
pub fn vscode_install_link(launch: &McpLaunch) -> String {
    let entry = VscodeEntry {
        name: "weaveforge",
        launch,
    };
    let json = serde_json::to_string(&entry).unwrap_or_default();
    format!("vscode:mcp/install?{}", encode_uri_component(&json))
}

#[derive(Serialize)]
struct Manifest<'a> {
    manifest_version: &'static str,
    name: &'static str,
    display_name: &'static str,
    version: &'a str,
    description: &'static str,
    author: Author,
    homepage: &'static str,
    license: &'static str,
    server: Server,
}

#[derive(Serialize)]
struct Author {
    name: &'static str,
    url: &'static str,
}

#[derive(Serialize)]
struct Server {
    #[serde(rename = "type")]
    kind: &'static str,
    entry_point: &'static str,
    mcp_config: McpConfig,
}

#[derive(Serialize)]
struct McpConfig {
    command: &'static str,
    args: [&'static str; 1],
    env: BTreeMap<String, String>,
}

/// A Claude Desktop extension (.mcpb): the bridge run by Claude's own Node, so the install dialog
/// needs no paths. The launch env rides in the manifest; `ELECTRON_RUN_AS_NODE` is dropped.
#[must_use]
pub fn mcpb_bundle(
    bridge: &[u8],
    tools: &[Value],
    version: &str,
    launch_env: &BTreeMap<String, String>,
) -> Vec<u8> {
    let env: BTreeMap<String, String> = launch_env
        .iter()
        .filter(|(key, _)| key.as_str() != ELECTRON_FLAG)
        .map(|(key, value)| (key.clone(), value.clone()))
        .collect();
    let manifest = Manifest {
        manifest_version: "0.2",
        name: "weaveforge",
        display_name: "WeaveForge",
        version,
        description: concat!(
            "Read and search your WeaveForge workspace, leave drafts to approve, and log experiments. ",
            "Runs on this computer only."
        ),
        author: Author {
            name: "WeaveForge",
            url: "https://weaveforge.org",
        },
        homepage: "https://weaveforge.org",
        license: "AGPL-3.0-only",
        server: Server {
            kind: "node",
            entry_point: "server/index.mjs",
            mcp_config: McpConfig {
                command: "node",
                args: ["${__dirname}/server/index.mjs"],
                env,
            },
        },
    };
    let manifest_text = pretty_with_newline(&manifest).unwrap_or_default();
    let tools_text =
        pretty_with_newline(&serde_json::json!({ "tools": tools })).unwrap_or_default();
    store_zip(&[
        ("manifest.json", manifest_text.as_bytes()),
        ("server/index.mjs", bridge),
        ("server/tools.json", tools_text.as_bytes()),
    ])
}

/// Writes `weaveforge.mcpb` into the folder and returns its path.
///
/// # Errors
/// Returns the first I/O error from creating the folder or writing the bundle.
pub fn write_mcpb(
    paths: &McpPaths,
    bridge: &[u8],
    tools: &[Value],
    version: &str,
    launch: &McpLaunch,
) -> io::Result<PathBuf> {
    fs::create_dir_all(&paths.dir)?;
    let file = paths.dir.join("weaveforge.mcpb");
    fs::write(&file, mcpb_bundle(bridge, tools, version, &launch.env))?;
    Ok(file)
}

fn pretty_with_newline<T: Serialize + ?Sized>(value: &T) -> serde_json::Result<String> {
    serde_json::to_string_pretty(value).map(|text| format!("{text}\n"))
}

/// Writes the token file with mode 0600 from the start on unix; `mode` only applies on create.
fn write_private_file(path: &Path, text: &str) -> io::Result<()> {
    let mut options = fs::OpenOptions::new();
    let _ = options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        let _ = options.mode(0o600);
    }
    let mut file = options.open(path)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        file.set_permissions(fs::Permissions::from_mode(0o600))?;
    }
    file.write_all(text.as_bytes())
}

/// Percent-encodes every byte outside the JavaScript `encodeURIComponent` unreserved set.
fn encode_uri_component(text: &str) -> String {
    const HEX: &[u8; 16] = b"0123456789ABCDEF";
    let mut out = String::with_capacity(text.len());
    for byte in text.bytes() {
        if byte.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&byte) {
            out.push(char::from(byte));
        } else {
            out.push('%');
            out.push(char::from(HEX[usize::from(byte >> 4)]));
            out.push(char::from(HEX[usize::from(byte & 0x0f)]));
        }
    }
    out
}

fn u16_of(n: usize) -> u16 {
    u16::try_from(n).unwrap_or(u16::MAX)
}

fn u32_of(n: usize) -> u32 {
    u32::try_from(n).unwrap_or(u32::MAX)
}

fn put_u16(out: &mut Vec<u8>, value: u16) {
    out.extend_from_slice(&value.to_le_bytes());
}

fn put_u32(out: &mut Vec<u8>, value: u32) {
    out.extend_from_slice(&value.to_le_bytes());
}

/// A PKZIP archive of `entries` in order, each stored uncompressed (method 0).
/// Sizes past 4 GiB clamp; the bundle holds only small text and the bridge.
fn store_zip(entries: &[(&str, &[u8])]) -> Vec<u8> {
    const VERSION: u16 = 20;
    const DOS_DATE_1980_01_01: u16 = 0x21;
    let mut out = Vec::new();
    let mut central = Vec::new();
    for (name, data) in entries {
        let name = name.as_bytes();
        let crc = crc32fast::hash(data);
        let size = u32_of(data.len());
        let name_len = u16_of(name.len());
        let offset = u32_of(out.len());

        put_u32(&mut out, 0x0403_4b50);
        put_u16(&mut out, VERSION);
        put_u16(&mut out, 0); // flags
        put_u16(&mut out, 0); // method: stored
        put_u16(&mut out, 0); // time
        put_u16(&mut out, DOS_DATE_1980_01_01);
        put_u32(&mut out, crc);
        put_u32(&mut out, size);
        put_u32(&mut out, size);
        put_u16(&mut out, name_len);
        put_u16(&mut out, 0); // extra length
        out.extend_from_slice(name);
        out.extend_from_slice(data);

        put_u32(&mut central, 0x0201_4b50);
        put_u16(&mut central, VERSION); // made by
        put_u16(&mut central, VERSION); // needed
        put_u16(&mut central, 0); // flags
        put_u16(&mut central, 0); // method
        put_u16(&mut central, 0); // time
        put_u16(&mut central, DOS_DATE_1980_01_01);
        put_u32(&mut central, crc);
        put_u32(&mut central, size);
        put_u32(&mut central, size);
        put_u16(&mut central, name_len);
        put_u16(&mut central, 0); // extra length
        put_u16(&mut central, 0); // comment length
        put_u16(&mut central, 0); // disk number
        put_u16(&mut central, 0); // internal attributes
        put_u32(&mut central, 0); // external attributes
        put_u32(&mut central, offset);
        central.extend_from_slice(name);
    }
    let count = u16_of(entries.len());
    let central_offset = u32_of(out.len());
    let central_size = u32_of(central.len());
    out.extend_from_slice(&central);

    put_u32(&mut out, 0x0605_4b50);
    put_u16(&mut out, 0); // disk number
    put_u16(&mut out, 0); // disk with central directory
    put_u16(&mut out, count);
    put_u16(&mut out, count);
    put_u32(&mut out, central_size);
    put_u32(&mut out, central_offset);
    put_u16(&mut out, 0); // comment length
    out
}

#[cfg(test)]
mod tests {
    use std::time::{SystemTime, UNIX_EPOCH};

    use base64::Engine;
    use base64::engine::general_purpose::STANDARD;
    use serde_json::json;

    use super::*;

    /// A scratch folder under the temp dir, removed on drop.
    struct Scratch(PathBuf);

    impl Scratch {
        fn new(name: &str) -> Self {
            let nanos = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or_default();
            let dir = std::env::temp_dir().join(format!(
                "wf-mcp-connect-{name}-{}-{nanos}",
                std::process::id()
            ));
            fs::create_dir_all(&dir).expect("create scratch dir");
            Self(dir)
        }
    }

    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn sample_connection() -> McpConnection {
        McpConnection {
            url: "http://127.0.0.1:27123/mcp".to_owned(),
            api_url: "http://127.0.0.1:27123".to_owned(),
            token: "secret".to_owned(),
            token_id: "id-1".to_owned(),
        }
    }

    fn sample_launch() -> McpLaunch {
        McpLaunch {
            command: "/apps/WeaveForge.exe".to_owned(),
            args: vec!["--mcp-bridge".to_owned()],
            env: BTreeMap::from([(
                MCP_FILE_ENV.to_owned(),
                "/h/.weaveforge/mcp-dev.json".to_owned(),
            )]),
        }
    }

    fn percent_decode(text: &str) -> Vec<u8> {
        let bytes = text.as_bytes();
        let mut out = Vec::new();
        let mut i = 0;
        while i < bytes.len() {
            if bytes[i] == b'%' {
                out.push(u8::from_str_radix(&text[i + 1..i + 3], 16).unwrap());
                i += 3;
            } else {
                out.push(bytes[i]);
                i += 1;
            }
        }
        out
    }

    /// Parses a store-only zip the way a reader does: central directory, then local headers.
    /// Asserts signatures, method 0, and that each CRC matches its data.
    fn read_zip(bytes: &[u8]) -> Vec<(String, Vec<u8>)> {
        let u16_at = |i: usize| u16::from_le_bytes([bytes[i], bytes[i + 1]]);
        let u32_at =
            |i: usize| u32::from_le_bytes([bytes[i], bytes[i + 1], bytes[i + 2], bytes[i + 3]]);
        let eocd = bytes.len() - 22;
        assert_eq!(u32_at(eocd), 0x0605_4b50, "end record signature");
        let count = usize::from(u16_at(eocd + 10));
        let mut at = u32_at(eocd + 16) as usize;
        let mut out = Vec::new();
        for _ in 0..count {
            assert_eq!(u32_at(at), 0x0201_4b50, "central header signature");
            assert_eq!(u16_at(at + 10), 0, "stored");
            let crc = u32_at(at + 16);
            let size = u32_at(at + 20) as usize;
            let name_len = usize::from(u16_at(at + 28));
            let extra_len = usize::from(u16_at(at + 30));
            let comment_len = usize::from(u16_at(at + 32));
            let local = u32_at(at + 42) as usize;
            let name = String::from_utf8(bytes[at + 46..at + 46 + name_len].to_vec()).unwrap();

            assert_eq!(u32_at(local), 0x0403_4b50, "local header signature");
            assert_eq!(u16_at(local + 8), 0, "stored");
            let local_name = usize::from(u16_at(local + 26));
            let local_extra = usize::from(u16_at(local + 28));
            let start = local + 30 + local_name + local_extra;
            let data = bytes[start..start + size].to_vec();
            assert_eq!(crc32fast::hash(&data), crc, "crc of {name}");
            out.push((name, data));
            at += 46 + name_len + extra_len + comment_len;
        }
        assert_eq!(count, out.len());
        out
    }

    #[test]
    fn mcp_paths_split_main_app_and_dev() {
        let home = Path::new("/h");
        let main = mcp_paths(home, None, None);
        let dev = mcp_paths(home, Some("dev"), None);
        assert_eq!(main.file, home.join(HOME_CONFIG_DIR).join("mcp.json"));
        assert_eq!(dev.file, home.join(HOME_CONFIG_DIR).join("mcp-dev.json"));
        assert_eq!(dev.dir, home.join(HOME_CONFIG_DIR).join("mcp-dev"));
        assert_ne!(main.dir, dev.dir);
        assert_eq!(mcp_paths(home, Some(""), None).file, main.file);
    }

    #[test]
    fn launch_sets_the_file_env_only_for_a_variant() {
        let home = Path::new("/h");
        let exe = Path::new("/apps/WeaveForge.exe");
        let main = mcp_launch(&mcp_paths(home, None, None), exe);
        assert_eq!(main.command, "/apps/WeaveForge.exe");
        assert_eq!(main.args, vec!["--mcp-bridge".to_owned()]);
        assert!(main.env.is_empty());

        let dev_paths = mcp_paths(home, Some("dev"), None);
        let dev = mcp_launch(&dev_paths, exe);
        assert_eq!(
            dev.env,
            BTreeMap::from([(
                MCP_FILE_ENV.to_owned(),
                dev_paths.file.to_string_lossy().into_owned()
            )])
        );
    }

    #[test]
    fn write_then_read_keeps_the_connection_and_writes_side_files() {
        let scratch = Scratch::new("write-read");
        let source = scratch.0.join("source.mjs");
        fs::write(&source, b"bridge-bytes").unwrap();
        let paths = mcp_paths(&scratch.0, Some("dev"), Some(source));
        let conn = sample_connection();
        let tools = vec![json!({ "name": "only_here", "inputSchema": { "type": "object" } })];

        write_mcp_connection(&paths, &conn, &tools).unwrap();

        assert_eq!(read_mcp_connection(&paths.file), Some(conn));
        assert_eq!(
            fs::read(paths.dir.join(MCP_BRIDGE_FILE)).unwrap(),
            b"bridge-bytes"
        );
        let listed: Value =
            serde_json::from_str(&fs::read_to_string(paths.dir.join("tools.json")).unwrap())
                .unwrap();
        assert_eq!(listed, json!({ "tools": tools }));
        assert!(fs::read_to_string(&paths.file).unwrap().ends_with('\n'));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&paths.file).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
    }

    #[test]
    fn write_without_a_bridge_source_copies_no_bridge() {
        let scratch = Scratch::new("no-bridge");
        let paths = mcp_paths(&scratch.0, None, None);
        write_mcp_connection(&paths, &sample_connection(), &[]).unwrap();
        assert!(!paths.dir.join(MCP_BRIDGE_FILE).exists());
        assert!(paths.dir.join("tools.json").exists());
    }

    #[test]
    fn read_is_none_for_missing_empty_or_non_string_fields() {
        let scratch = Scratch::new("read-none");
        let file = scratch.0.join("mcp.json");
        assert_eq!(read_mcp_connection(&file), None, "missing");

        fs::write(
            &file,
            r#"{"url":"u","apiUrl":"","token":"t","tokenId":"i"}"#,
        )
        .unwrap();
        assert_eq!(read_mcp_connection(&file), None, "empty field");

        fs::write(&file, r#"{"url":"u","apiUrl":"a","token":5,"tokenId":"i"}"#).unwrap();
        assert_eq!(read_mcp_connection(&file), None, "non-string field");

        fs::write(&file, r#"{"url":"u","apiUrl":"a","token":"t"}"#).unwrap();
        assert_eq!(read_mcp_connection(&file), None, "missing field");

        fs::write(&file, "not json").unwrap();
        assert_eq!(read_mcp_connection(&file), None, "not json");
    }

    #[test]
    fn remove_deletes_the_file_and_tolerates_a_missing_one() {
        let scratch = Scratch::new("remove");
        let paths = mcp_paths(&scratch.0, None, None);
        write_mcp_connection(&paths, &sample_connection(), &[]).unwrap();
        remove_mcp_connection(&paths.file).unwrap();
        assert!(!paths.file.exists());
        remove_mcp_connection(&paths.file).unwrap();
    }

    #[test]
    fn cursor_link_carries_the_launch_as_base64_json() {
        let launch = sample_launch();
        let link = cursor_install_link(&launch);
        let prefix = "cursor://anysphere.cursor-deeplink/mcp/install?name=weaveforge&config=";
        let encoded = link.strip_prefix(prefix).unwrap();
        let decoded = STANDARD.decode(percent_decode(encoded)).unwrap();
        assert_eq!(
            serde_json::from_slice::<Value>(&decoded).unwrap(),
            serde_json::to_value(&launch).unwrap()
        );
    }

    #[test]
    fn vscode_link_is_the_named_launch_as_encoded_json() {
        let launch = sample_launch();
        let expected = r#"{"name":"weaveforge","command":"/apps/WeaveForge.exe","args":["--mcp-bridge"],"env":{"WEAVEFORGE_MCP_FILE":"/h/.weaveforge/mcp-dev.json"}}"#;
        let link = vscode_install_link(&launch);
        assert_eq!(
            link,
            format!("vscode:mcp/install?{}", encode_uri_component(expected))
        );
        assert_eq!(
            percent_decode(link.strip_prefix("vscode:mcp/install?").unwrap()),
            expected.as_bytes()
        );
    }

    #[test]
    fn encode_uri_component_matches_the_js_function() {
        assert_eq!(encode_uri_component("a b"), "a%20b");
        assert_eq!(encode_uri_component("é"), "%C3%A9");
        assert_eq!(encode_uri_component("!'()*-_.~"), "!'()*-_.~");
        assert_eq!(encode_uri_component("/?&=+"), "%2F%3F%26%3D%2B");
    }

    #[test]
    fn mcpb_is_a_three_entry_stored_zip_with_matching_crcs() {
        let bytes = mcpb_bundle(
            b"bridge",
            &[json!({ "name": "t" })],
            "9.9.9",
            &BTreeMap::new(),
        );
        assert_eq!(&bytes[..4], &[0x50, 0x4b, 0x03, 0x04]);
        let entries = read_zip(&bytes);
        let names: Vec<&str> = entries.iter().map(|(name, _)| name.as_str()).collect();
        assert_eq!(
            names,
            ["manifest.json", "server/index.mjs", "server/tools.json"]
        );
        assert_eq!(entries[1].1, b"bridge");
    }

    #[test]
    fn mcpb_manifest_keeps_the_launch_env_without_electron() {
        let env = BTreeMap::from([
            (ELECTRON_FLAG.to_owned(), "1".to_owned()),
            (MCP_FILE_ENV.to_owned(), "/h/mcp-dev.json".to_owned()),
        ]);
        let entries = read_zip(&mcpb_bundle(b"bridge", &[], "9.9.9", &env));
        let manifest: Value = serde_json::from_slice(&entries[0].1).unwrap();
        assert_eq!(manifest["version"], "9.9.9");
        assert_eq!(
            manifest["server"]["mcp_config"],
            json!({
                "command": "node",
                "args": ["${__dirname}/server/index.mjs"],
                "env": { "WEAVEFORGE_MCP_FILE": "/h/mcp-dev.json" }
            })
        );
        let tools: Value = serde_json::from_slice(&entries[2].1).unwrap();
        assert_eq!(tools, json!({ "tools": [] }));
    }

    #[test]
    fn write_mcpb_writes_the_bundle_into_the_folder() {
        let scratch = Scratch::new("mcpb");
        let paths = mcp_paths(&scratch.0, Some("dev"), None);
        let file = write_mcpb(&paths, b"bridge", &[], "9.9.9", &sample_launch()).unwrap();
        assert_eq!(file, paths.dir.join("weaveforge.mcpb"));
        assert_eq!(read_zip(&fs::read(&file).unwrap()).len(), 3);
    }
}
