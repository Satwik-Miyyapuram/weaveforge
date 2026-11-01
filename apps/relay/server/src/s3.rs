//! SigV4-signed S3 object client for the R2 hot tier and the cold store. Port of the
//! object calls in `apps/web/src/storage/providers/s3/s3-blob-store.ts`.

use std::fmt::Write as _;

use hmac::{Hmac, Mac};
use reqwest::header::{AUTHORIZATION, CONTENT_TYPE};
use reqwest::{Method, StatusCode};
use sha2::{Digest, Sha256};
use url::Url;

const UNREACHABLE: &str = "Object store unreachable.";
const OCTET_STREAM: &str = "application/octet-stream";

/// One S3-compatible bucket the relay talks to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct S3Target {
    /// Endpoint with no trailing slash, e.g. `https://acc.r2.cloudflarestorage.com`.
    pub endpoint: String,
    /// `auto` for R2 and the cold store.
    pub region: String,
    /// Physical bucket name.
    pub bucket: String,
    /// Access key id.
    pub access_key_id: String,
    /// Secret access key.
    pub secret_access_key: String,
}

/// The parts of a request that SigV4 signs.
pub struct SignRequest<'a> {
    /// HTTP method.
    pub method: &'a str,
    /// Percent-encoded path.
    pub canonical_uri: &'a str,
    /// Canonical query string; `""` for none.
    pub canonical_query: &'a str,
    /// Header name (lower case) and value pairs, in any order.
    pub headers: &'a [(&'a str, &'a str)],
    /// Lower-hex SHA-256 of the body.
    pub payload_sha256: &'a str,
    /// `YYYYMMDDTHHMMSSZ`.
    pub amz_date: &'a str,
    /// Signing region.
    pub region: &'a str,
    /// Access key id.
    pub access_key_id: &'a str,
    /// Secret access key.
    pub secret_access_key: &'a str,
}

/// An object's bytes and the content type it was stored with.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct S3Object {
    /// The object bytes.
    pub bytes: Vec<u8>,
    /// Stored content type, or `application/octet-stream`.
    pub content_type: String,
}

/// The full `Authorization` header value for a signed S3 request.
#[must_use]
pub fn authorization(req: &SignRequest<'_>) -> String {
    let date = req.amz_date.get(..8).unwrap_or(req.amz_date);
    let scope = format!("{date}/{}/s3/aws4_request", req.region);
    let mut headers: Vec<(&str, &str)> = req
        .headers
        .iter()
        .map(|(name, value)| (*name, value.trim()))
        .collect();
    headers.sort_by(|a, b| a.0.cmp(b.0));
    let canonical_headers: String = headers
        .iter()
        .map(|(name, value)| format!("{name}:{value}\n"))
        .collect();
    let signed = headers
        .iter()
        .map(|(name, _)| *name)
        .collect::<Vec<_>>()
        .join(";");
    let canonical = format!(
        "{}\n{}\n{}\n{canonical_headers}\n{signed}\n{}",
        req.method, req.canonical_uri, req.canonical_query, req.payload_sha256
    );
    let to_sign = format!(
        "AWS4-HMAC-SHA256\n{}\n{scope}\n{}",
        req.amz_date,
        hex(&Sha256::digest(canonical.as_bytes()))
    );
    let key = signing_key(req.secret_access_key, date, req.region);
    let signature = hex(&hmac_sha256(&key, to_sign.as_bytes()));
    format!(
        "AWS4-HMAC-SHA256 Credential={}/{scope},SignedHeaders={signed},Signature={signature}",
        req.access_key_id
    )
}

/// `YYYYMMDDTHHMMSSZ` in UTC for a Unix time in seconds.
#[must_use]
pub fn amz_date(unix_seconds: u64) -> String {
    let days = unix_seconds / 86_400;
    let secs = unix_seconds % 86_400;
    let (year, month, day) = civil_from_days(i64::try_from(days).unwrap_or(i64::MAX));
    format!(
        "{year:04}{month:02}{day:02}T{:02}{:02}{:02}Z",
        secs / 3_600,
        secs % 3_600 / 60,
        secs % 60
    )
}

/// The request path for `key` in `bucket`, with the key percent-encoded.
#[must_use]
pub fn object_uri(bucket: &str, key: &str) -> String {
    format!("/{bucket}/{}", percent_encode(key))
}

/// Writes an object. Any 2xx is success.
pub async fn put_object(
    client: &reqwest::Client,
    target: &S3Target,
    key: &str,
    body: Vec<u8>,
    content_type: &str,
    now: u64,
) -> Result<(), String> {
    let reply = send(
        client,
        target,
        Method::PUT,
        key,
        body,
        Some(content_type),
        now,
    )
    .await?;
    check_status(reply.status(), "PUT")
}

/// Reads an object. Anything but a 2xx answer is `None`.
pub async fn get_object(
    client: &reqwest::Client,
    target: &S3Target,
    key: &str,
    now: u64,
) -> Option<S3Object> {
    let reply = match send(client, target, Method::GET, key, Vec::new(), None, now).await {
        Ok(reply) => reply,
        Err(msg) => {
            eprintln!("[blobs] object read failed: {msg}");
            return None;
        }
    };
    let status = reply.status();
    if !status.is_success() {
        if status != StatusCode::NOT_FOUND {
            eprintln!("[blobs] object read replied {}", status.as_u16());
        }
        return None;
    }
    let content_type = reply
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or(OCTET_STREAM)
        .to_string();
    let bytes = reply.bytes().await.ok()?.to_vec();
    Some(S3Object {
        bytes,
        content_type,
    })
}

/// Deletes an object. A 404 counts as deleted.
pub async fn delete_object(
    client: &reqwest::Client,
    target: &S3Target,
    key: &str,
    now: u64,
) -> Result<(), String> {
    let reply = send(client, target, Method::DELETE, key, Vec::new(), None, now).await?;
    let status = reply.status();
    if status == StatusCode::NOT_FOUND {
        return Ok(());
    }
    check_status(status, "DELETE")
}

/// Signs and sends one object request. Transport failures become `UNREACHABLE`.
async fn send(
    client: &reqwest::Client,
    target: &S3Target,
    method: Method,
    key: &str,
    body: Vec<u8>,
    content_type: Option<&str>,
    now: u64,
) -> Result<reqwest::Response, String> {
    let uri = object_uri(&target.bucket, key);
    let url =
        Url::parse(&format!("{}{uri}", target.endpoint)).map_err(|_| UNREACHABLE.to_string())?;
    let amz = amz_date(now);
    let payload = hex(&Sha256::digest(&body));
    let host = host_header(&url);
    let mut headers = vec![
        ("host", host.as_str()),
        ("x-amz-content-sha256", payload.as_str()),
        ("x-amz-date", amz.as_str()),
    ];
    if let Some(ct) = content_type {
        headers.push(("content-type", ct));
    }
    let auth = authorization(&SignRequest {
        method: method.as_str(),
        canonical_uri: &uri,
        canonical_query: "",
        headers: &headers,
        payload_sha256: &payload,
        amz_date: &amz,
        region: &target.region,
        access_key_id: &target.access_key_id,
        secret_access_key: &target.secret_access_key,
    });
    let mut request = client
        .request(method, url)
        .header("x-amz-date", amz.as_str())
        .header("x-amz-content-sha256", payload.as_str())
        .header(AUTHORIZATION, auth)
        .body(body);
    if let Some(ct) = content_type {
        request = request.header(CONTENT_TYPE, ct);
    }
    request.send().await.map_err(|_| UNREACHABLE.to_string())
}

/// `Ok` for a 2xx status, else the "replied {status} to {verb}." error.
fn check_status(status: StatusCode, verb: &str) -> Result<(), String> {
    if status.is_success() {
        Ok(())
    } else {
        Err(format!(
            "Object store replied {} to {verb}.",
            status.as_u16()
        ))
    }
}

/// The signed `host` value: the URL host, plus the port when one is explicit.
fn host_header(url: &Url) -> String {
    let host = url.host_str().unwrap_or_default();
    match url.port() {
        Some(port) => format!("{host}:{port}"),
        None => host.to_string(),
    }
}

/// The SigV4 signing key for one date, region and the `s3` service.
fn signing_key(secret: &str, date: &str, region: &str) -> Vec<u8> {
    let k_date = hmac_sha256(format!("AWS4{secret}").as_bytes(), date.as_bytes());
    let k_region = hmac_sha256(&k_date, region.as_bytes());
    let k_service = hmac_sha256(&k_region, b"s3");
    hmac_sha256(&k_service, b"aws4_request")
}

fn hmac_sha256(key: &[u8], data: &[u8]) -> Vec<u8> {
    let Ok(mut mac) = Hmac::<Sha256>::new_from_slice(key) else {
        // HMAC accepts a key of any length, so this branch cannot run.
        return Vec::new();
    };
    mac.update(data);
    mac.finalize().into_bytes().to_vec()
}

fn hex(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        let _ = write!(out, "{byte:02x}");
    }
    out
}

/// Percent-encodes every byte except unreserved characters and `/`.
fn percent_encode(text: &str) -> String {
    let mut out = String::new();
    for byte in text.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~' | b'/') {
            out.push(char::from(byte));
        } else {
            let _ = write!(out, "%{byte:02X}");
        }
    }
    out
}

/// Howard Hinnant's `civil_from_days`: days since 1970-01-01 to (year, month, day).
fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let z = days + 719_468;
    let era = z / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    (year, month, day)
}
