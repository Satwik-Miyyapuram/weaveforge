//! Supabase Auth (GoTrue) calls for account deletion and admin user creation, as the
//! web's supabase-auth provider makes them. Also resolves the caller's member profile.
//! Ported from apps/web/src/backend/providers/supabase-auth/.

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use reqwest::Method;
use reqwest::header::{AUTHORIZATION, CONTENT_TYPE};
use serde_json::{Value, json};
use wf_core::member::OtpInput;

use crate::postgrest::{DbError, UserDb, eq};
use crate::routes::AppState;

const UNREACHABLE: &str = "Could not reach the auth server.";
/// The largest auth server reply the relay reads (1 MiB); a larger one counts as not JSON.
const MAX_REPLY_BYTES: usize = 1024 * 1024;

/// A caller's member profile, as the lab roles see it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Member {
    /// The Supabase user id.
    pub id: String,
    /// The account email, if the profile has one.
    pub email: Option<String>,
    /// The display name, if the profile has one.
    pub full_name: Option<String>,
    /// The lab role (`standalone`, `masters`, `phd`, `professor`), or "" when unset.
    pub role: String,
    /// The supervising member's id, if any.
    pub supervisor_id: Option<String>,
}

impl Member {
    /// The API shape of a member; absent fields are left out, as `JSON.stringify` does.
    #[must_use]
    pub fn to_json(&self) -> Value {
        let mut out = json!({"id": self.id, "role": self.role});
        if let Some(email) = &self.email {
            out["email"] = json!(email);
        }
        if let Some(full_name) = &self.full_name {
            out["fullName"] = json!(full_name);
        }
        if let Some(supervisor_id) = &self.supervisor_id {
            out["supervisorId"] = json!(supervisor_id);
        }
        out
    }
}

/// The Supabase user behind a session token, or `None` when Supabase refuses it.
pub async fn session_user_id(state: &AppState, token: &str) -> Option<String> {
    let request = state
        .client
        .get(format!("{}/auth/v1/user", state.config.supabase_url))
        .header("apikey", state.config.anon_key.as_str())
        .header(AUTHORIZATION, format!("Bearer {token}"));
    let answer = send(request).await.ok()?;
    if !answer.ok {
        return None;
    }
    answer.body.get("id")?.as_str().map(str::to_owned)
}

/// The caller's member profile; `None` when the session is invalid or has no profile.
pub async fn resolve_member(state: &AppState, token: &str) -> Result<Option<Member>, DbError> {
    let Some(user_id) = session_user_id(state, token).await else {
        return Ok(None);
    };
    let db = UserDb::new(
        &state.client,
        &state.config.data_url,
        &state.config.service_role_key,
        &state.config.service_role_key,
    );
    let rows = db
        .select(
            "profiles",
            &[
                (
                    "select",
                    "user_id,email,full_name,role,supervisor_id".to_string(),
                ),
                ("user_id", eq(&user_id)),
            ],
        )
        .await?;
    Ok(rows.first().map(|row| Member {
        id: user_id,
        email: field(row, "email"),
        full_name: field(row, "full_name"),
        role: field(row, "role").unwrap_or_default(),
        supervisor_id: field(row, "supervisor_id"),
    }))
}

/// Creates a confirmed auth user; the new user's id, or fixed wording on refusal:
/// "Email already registered." for a taken email, else "Failed to create user.".
pub async fn admin_create_user(
    state: &AppState,
    email: &str,
    password: &str,
    full_name: Option<&str>,
) -> Result<String, String> {
    let mut body = json!({"email": email, "password": password, "email_confirm": true});
    if let Some(full_name) = full_name {
        body["user_metadata"] = json!({"full_name": full_name});
    }
    let made_after = SystemTime::now();
    let answer = send(admin(state, Method::POST, "/auth/v1/admin/users", &body)).await?;
    if !answer.ok {
        log_refusal("admin create user", answer.status);
        let text = auth_message(&answer.body, "").to_lowercase();
        let taken = [
            "already registered",
            "already been registered",
            "already exists",
        ]
        .iter()
        .any(|needle| text.contains(needle));
        return Err(if taken {
            "Email already registered.".to_string()
        } else {
            "Failed to create user.".to_string()
        });
    }
    if let Some(id) = user_id_of(&answer.body) {
        return Ok(id);
    }
    // A 2xx that is not a JSON object did not come from GoTrue (a proxy page, say), so no
    // user was made and nothing is cleaned up.
    if !answer.body.is_object() {
        eprintln!("[gotrue admin create user] 2xx reply was not a JSON object; nothing cleaned up");
        return Err("Failed to create user.".to_string());
    }
    // GoTrue made the user but named no id, so the profile cannot be written: remove the
    // half-made user (found by exact email) and fail, rather than leave it without a profile.
    remove_unnamed_user(state, email, made_after).await;
    Err("Failed to create user.".to_string())
}

/// Users per lookup page, and the most pages read, when finding a user by email.
const LOOKUP_PAGE_SIZE: usize = 50;
const LOOKUP_MAX_PAGES: usize = 20;
/// How far a user's `created_at` may sit before the create call (clock skew between the
/// relay and the auth server) and still count as the user that call made.
const CREATE_CLOCK_SKEW: Duration = Duration::from_secs(600);

/// Deletes the one auth user whose email is `email` (ignoring ASCII case), whose email is
/// confirmed (the create asked for that), who was created no more than `CREATE_CLOCK_SKEW`
/// before `made_after` and who has no profile row yet. Best effort and fail closed: a failed
/// lookup, no match, several matches, an unconfirmed match, an older or unreadable
/// `created_at`, a profile row or a failed profile check deletes nothing and is only logged.
async fn remove_unnamed_user(state: &AppState, email: &str, made_after: SystemTime) {
    let Some(matches) = users_with_email(state, email).await else {
        return;
    };
    let [user] = matches.as_slice() else {
        eprintln!(
            "[gotrue admin create user] no id; {} exact matches, nothing deleted",
            matches.len()
        );
        return;
    };
    let id = user.get("id").and_then(Value::as_str).unwrap_or_default();
    if !is_safe_user_id(id) {
        eprintln!("[gotrue admin create user] no id; match has a bad id, nothing deleted");
        return;
    }
    // The create sent `email_confirm: true`, so an unconfirmed match is another signup.
    if !user.get("email_confirmed_at").is_some_and(Value::is_string) {
        eprintln!("[gotrue admin create user] no id; match is unconfirmed, nothing deleted");
        return;
    }
    // An account made before this call is someone else's, whatever its profile state.
    let created_at = user.get("created_at").and_then(Value::as_str);
    if !created_at.is_some_and(|stamp| made_since(stamp, made_after)) {
        eprintln!("[gotrue admin create user] no id; match is older or undated, nothing deleted");
        return;
    }
    // A user with a profile is a real account, not the one just half-made.
    if has_profile(state, id).await != Some(false) {
        eprintln!("[gotrue admin create user] no id; match has a profile or check failed");
        return;
    }
    if admin_delete_user(state, id).await.is_err() {
        eprintln!("[gotrue admin create user] no id; delete failed, user may be left");
    }
}

/// Every auth user whose email is `email` (ignoring ASCII case), read page by page until a
/// page comes back empty; `None` (logged) when a page fails or the page cap is reached.
async fn users_with_email(state: &AppState, email: &str) -> Option<Vec<Value>> {
    let filter: String = ::url::form_urlencoded::byte_serialize(email.as_bytes()).collect();
    let mut matches = Vec::new();
    for page in 1..=LOOKUP_MAX_PAGES {
        let path =
            format!("/auth/v1/admin/users?filter={filter}&page={page}&per_page={LOOKUP_PAGE_SIZE}");
        let Ok(answer) = send(admin(state, Method::GET, &path, &Value::Null)).await else {
            eprintln!("[gotrue admin create user] no id; lookup unreachable, user may be left");
            return None;
        };
        if !answer.ok {
            log_refusal("admin create user lookup", answer.status);
            return None;
        }
        let Some(users) = answer.body.get("users").and_then(Value::as_array) else {
            eprintln!(
                "[gotrue admin create user] no id; lookup reply unreadable, user may be left"
            );
            return None;
        };
        // Every exact match counts, even one with a bad or missing id, so a second account is
        // never hidden from the one-match check.
        matches.extend(
            users
                .iter()
                .filter(|user| {
                    user.get("email")
                        .and_then(Value::as_str)
                        .is_some_and(|found| found.eq_ignore_ascii_case(email))
                })
                .cloned(),
        );
        // Only an empty page ends the list: a server may cap pages below the size asked for.
        if users.is_empty() {
            return Some(matches);
        }
    }
    eprintln!("[gotrue admin create user] no id; lookup page cap reached, user may be left");
    None
}

/// Whether the GoTrue UTC stamp `stamp` (`YYYY-MM-DDTHH:MM:SS[.frac](Z|+00:00)`) is no more
/// than `CREATE_CLOCK_SKEW` before `made_after`. Any other shape is `false` (fail closed).
fn made_since(stamp: &str, made_after: SystemTime) -> bool {
    let Some(floor) = made_after
        .checked_sub(CREATE_CLOCK_SKEW)
        .and_then(|floor| floor.duration_since(UNIX_EPOCH).ok())
    else {
        return false;
    };
    let (Some(base), Some(rest)) = (stamp.get(..19), stamp.get(19..)) else {
        return false;
    };
    let shaped = base.bytes().enumerate().all(|(at, byte)| match at {
        4 | 7 => byte == b'-',
        10 => byte == b'T',
        13 | 16 => byte == b':',
        _ => byte.is_ascii_digit(),
    });
    // A fraction, when present, has at least one digit.
    let zone = match rest.strip_prefix('.') {
        Some(frac) => match frac.trim_start_matches(|c: char| c.is_ascii_digit()) {
            zone if zone.len() < frac.len() => zone,
            _ => return false,
        },
        None => rest,
    };
    shaped && (zone == "Z" || zone == "+00:00") && base >= utc_stamp(floor.as_secs()).as_str()
}

/// `secs` since the Unix epoch as `YYYY-MM-DDTHH:MM:SS` (UTC, proleptic Gregorian).
fn utc_stamp(secs: u64) -> String {
    let (days, of_day) = (secs / 86_400, secs % 86_400);
    // Howard Hinnant's civil-from-days, on unsigned values (the epoch is after year 0).
    let z = days + 719_468;
    let era = z / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + u64::from(month <= 2);
    let (hour, minute, second) = (of_day / 3_600, of_day % 3_600 / 60, of_day % 60);
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}")
}

/// Whether `id` is safe to put in an admin path: non-empty ASCII letters, digits and `-`.
fn is_safe_user_id(id: &str) -> bool {
    !id.is_empty() && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

/// Whether `user_id` has a profile row; `None` when the check fails.
async fn has_profile(state: &AppState, user_id: &str) -> Option<bool> {
    let db = UserDb::new(
        &state.client,
        &state.config.data_url,
        &state.config.service_role_key,
        &state.config.service_role_key,
    );
    let rows = db
        .select(
            "profiles",
            &[("select", "user_id".to_string()), ("user_id", eq(user_id))],
        )
        .await
        .ok()?;
    Some(!rows.is_empty())
}

/// Deletes an auth user outright; fixed wording on refusal (the auth server's text is not
/// passed on).
/// An id that is not plain ASCII letters, digits and `-` is refused before any request.
pub async fn admin_delete_user(state: &AppState, user_id: &str) -> Result<(), String> {
    if !is_safe_user_id(user_id) {
        eprintln!("[gotrue admin delete user] refused an id with characters unsafe in a path");
        return Err("Failed to delete user.".to_string());
    }
    let body = json!({"should_soft_delete": false});
    let path = format!("/auth/v1/admin/users/{user_id}");
    let answer = send(admin(state, Method::DELETE, &path, &body)).await?;
    if answer.ok {
        Ok(())
    } else {
        log_refusal("admin delete user", answer.status);
        Err("Failed to delete user.".to_string())
    }
}

/// Emails a one-time code to `email`; no account is created for an unknown address.
pub async fn send_email_otp(state: &AppState, email: &str) -> Result<(), String> {
    let body = json!({"email": email, "create_user": false});
    let answer = send(anon(state, Method::POST, "/auth/v1/otp", &body)).await?;
    if answer.ok {
        return Ok(());
    }
    log_refusal("send otp", answer.status);
    if answer.status == 429 {
        Err("Too many code requests. Wait a minute and try again.".to_string())
    } else {
        Err("Failed to send confirmation code.".to_string())
    }
}

/// Checks an emailed code or link; the verified user's id, or why it was refused.
pub async fn verify_email_otp(
    state: &AppState,
    email: &str,
    otp: &OtpInput,
) -> Result<String, String> {
    let body = match otp {
        OtpInput::Token(token) => json!({"type": "email", "email": email, "token": token}),
        OtpInput::TokenHash(hash) => json!({"type": "email", "token_hash": hash}),
    };
    let answer = send(anon(state, Method::POST, "/auth/v1/verify", &body)).await?;
    if !answer.ok {
        log_refusal("verify otp", answer.status);
        // GoTrue refuses a bad or expired code with 400, 403 or 422. Anything else (our key
        // refused, 404, 429, 5xx) is the server's trouble; that wording avoids the 400 keywords.
        if matches!(answer.status, 400 | 403 | 422) {
            return Err("Invalid or expired confirmation code.".to_string());
        }
        return Err("The sign-in server could not check the code. Try again later.".to_string());
    }
    // GoTrue took the code but named no user: the server's trouble, not a bad code (so 500).
    user_id_of(&answer.body).ok_or_else(|| {
        eprintln!("[gotrue] verify otp: no user id in the reply");
        "The sign-in server could not check the code. Try again later.".to_string()
    })
}

/// A reply from the auth server: whether it succeeded, its status, and its JSON body
/// (`Null` when not JSON or over `MAX_REPLY_BYTES`; an oversize 2xx create so fails with
/// no cleanup, like any 2xx that is not a JSON object).
struct Answer {
    ok: bool,
    status: u16,
    body: Value,
}

/// Sends `request` and reads the reply; a send failure is the unreachable message.
async fn send(request: reqwest::RequestBuilder) -> Result<Answer, String> {
    let mut response = request.send().await.map_err(|_| UNREACHABLE.to_string())?;
    let ok = response.status().is_success();
    let status = response.status().as_u16();
    let body = match capped_body(&mut response).await {
        Some(bytes) => serde_json::from_slice(&bytes).unwrap_or(Value::Null),
        None => Value::Null,
    };
    Ok(Answer { ok, status, body })
}

/// The reply body, or `None` when it fails or passes `MAX_REPLY_BYTES` (then it reads as not JSON).
async fn capped_body(response: &mut reqwest::Response) -> Option<Vec<u8>> {
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.ok()? {
        if bytes.len() + chunk.len() > MAX_REPLY_BYTES {
            eprintln!("[gotrue] reply passed {MAX_REPLY_BYTES} bytes; not read");
            return None;
        }
        bytes.extend_from_slice(&chunk);
    }
    Some(bytes)
}

/// Logs an auth server refusal by step and status only; its text can name internal hosts.
fn log_refusal(step: &str, status: u16) {
    eprintln!("[gotrue {step}] HTTP {status}");
}

/// A call to the auth server as the service role.
fn admin(state: &AppState, method: Method, path: &str, body: &Value) -> reqwest::RequestBuilder {
    authed(state, method, path, &state.config.service_role_key, body)
}

/// A call to the auth server with the anon key.
fn anon(state: &AppState, method: Method, path: &str, body: &Value) -> reqwest::RequestBuilder {
    authed(state, method, path, &state.config.anon_key, body)
}

/// A JSON call to the auth server, authorized with `key` as both `apikey` and bearer.
fn authed(
    state: &AppState,
    method: Method,
    path: &str,
    key: &str,
    body: &Value,
) -> reqwest::RequestBuilder {
    state
        .client
        .request(method, format!("{}{path}", state.config.supabase_url))
        .header("apikey", key)
        .header(AUTHORIZATION, format!("Bearer {key}"))
        .header(CONTENT_TYPE, "application/json")
        .body(body.to_string())
}

/// The first non-empty `msg`, `message`, `error_description` or `error` of an auth reply.
/// Only admin user creation uses it, to spot a taken email; the text is never returned or logged.
fn auth_message(body: &Value, fallback: &str) -> String {
    ["msg", "message", "error_description", "error"]
        .iter()
        .find_map(|key| {
            body.get(*key)
                .and_then(Value::as_str)
                .filter(|text| !text.is_empty())
        })
        .map_or_else(|| fallback.to_string(), str::to_owned)
}

/// The user id of an auth reply: `user.id` (verify, create) or a bare `id`.
fn user_id_of(body: &Value) -> Option<String> {
    body.get("user")
        .and_then(|user| user.get("id"))
        .or_else(|| body.get("id"))
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty())
        .map(str::to_owned)
}

/// A string column of a row; `None` when missing, null or not a string.
fn field(row: &Value, key: &str) -> Option<String> {
    row.get(key)?.as_str().map(str::to_owned)
}

#[cfg(test)]
mod tests {
    use super::{CREATE_CLOCK_SKEW, made_since, utc_stamp};
    use std::time::{Duration, UNIX_EPOCH};

    #[test]
    fn utc_stamp_matches_known_dates() {
        assert_eq!(utc_stamp(0), "1970-01-01T00:00:00");
        assert_eq!(utc_stamp(951_782_400), "2000-02-29T00:00:00");
        assert_eq!(utc_stamp(951_868_800), "2000-03-01T00:00:00");
        assert_eq!(utc_stamp(1_735_689_599), "2024-12-31T23:59:59");
        assert_eq!(utc_stamp(1_709_164_800), "2024-02-29T00:00:00");
        assert_eq!(utc_stamp(4_102_444_800), "2100-01-01T00:00:00");
    }

    #[test]
    fn made_since_holds_at_the_skew_and_fails_just_past_it() {
        // 2024-12-31T23:59:59Z; the floor is 600 s earlier, 23:49:59.
        let made_after = UNIX_EPOCH + Duration::from_secs(1_735_689_599);
        assert_eq!(CREATE_CLOCK_SKEW, Duration::from_secs(600));
        assert!(made_since("2024-12-31T23:59:59Z", made_after));
        assert!(made_since("2024-12-31T23:50:00Z", made_after));
        assert!(made_since("2024-12-31T23:49:59Z", made_after));
        assert!(made_since("2024-12-31T23:49:59.5+00:00", made_after));
        assert!(!made_since("2024-12-31T23:49:58Z", made_after));
        assert!(!made_since("2024-12-31T23:49:58.999999Z", made_after));
        assert!(!made_since("2024-12-01T23:59:59Z", made_after));
    }

    #[test]
    fn made_since_refuses_other_shapes() {
        let made_after = UNIX_EPOCH + Duration::from_secs(1_735_689_599);
        for stamp in [
            "2999-01-01T00:00:00",
            "2999-01-01T00:00:00z",
            "2999-01-01T00:00:00.Z",
            "2999-01-01T00:00:00+02:00",
            "2999-01-01 00:00:00Z",
            "2999-1-01T00:00:00Z",
            "2999",
            "",
        ] {
            assert!(!made_since(stamp, made_after), "{stamp}");
        }
    }
}
