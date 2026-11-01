//! PostgREST calls made as the caller (anon key + the caller's bearer), as the web's
//! `sdkDbForUserToken` does, so row-level security applies to the caller.

use reqwest::{Method, Response};
use serde_json::Value;

/// A failed database call: the PostgREST error code when there is one, and a message.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DbError {
    /// The PostgREST `code` from a JSON error body, if any.
    pub code: Option<String>,
    /// The message to log; never sent to the caller as is.
    pub message: String,
}

/// Runs table queries against PostgREST as one user.
pub struct UserDb<'a> {
    client: &'a reqwest::Client,
    data_url: &'a str,
    anon_key: &'a str,
    token: &'a str,
}

impl<'a> UserDb<'a> {
    /// A client for the user who holds `token`.
    #[must_use]
    pub fn new(
        client: &'a reqwest::Client,
        data_url: &'a str,
        anon_key: &'a str,
        token: &'a str,
    ) -> Self {
        Self {
            client,
            data_url,
            anon_key,
            token,
        }
    }

    /// `GET` rows of `table` matching `query`.
    pub async fn select(
        &self,
        table: &str,
        query: &[(&str, String)],
    ) -> Result<Vec<Value>, DbError> {
        let response = self.send(Method::GET, table, query, None, None).await?;
        rows(response).await
    }

    /// `POST` `rows` (an array or object) into `table`.
    pub async fn insert(&self, table: &str, rows: &Value) -> Result<(), DbError> {
        let _response = self
            .send(Method::POST, table, &[], Some("return=minimal"), Some(rows))
            .await?;
        Ok(())
    }

    /// `POST` `rows` into `table` and return the saved rows (`return=representation`).
    pub async fn insert_returning(
        &self,
        table: &str,
        body: &Value,
        query: &[(&str, String)],
    ) -> Result<Vec<Value>, DbError> {
        let response = self
            .send(
                Method::POST,
                table,
                query,
                Some("return=representation"),
                Some(body),
            )
            .await?;
        rows(response).await
    }

    /// `POST` one `row` into `table` as merge-duplicates and return the saved rows.
    pub async fn upsert(
        &self,
        table: &str,
        row: &Value,
        query: &[(&str, String)],
    ) -> Result<Vec<Value>, DbError> {
        let response = self
            .send(
                Method::POST,
                table,
                query,
                Some("resolution=merge-duplicates,return=representation"),
                Some(row),
            )
            .await?;
        rows(response).await
    }

    /// `PATCH` the rows of `table` matching `query` with `patch`.
    pub async fn update(
        &self,
        table: &str,
        query: &[(&str, String)],
        patch: &Value,
    ) -> Result<(), DbError> {
        let _response = self
            .send(
                Method::PATCH,
                table,
                query,
                Some("return=minimal"),
                Some(patch),
            )
            .await?;
        Ok(())
    }

    /// `DELETE` the rows of `table` matching `query`.
    pub async fn delete(&self, table: &str, query: &[(&str, String)]) -> Result<(), DbError> {
        let _response = self
            .send(Method::DELETE, table, query, Some("return=minimal"), None)
            .await?;
        Ok(())
    }

    /// `DELETE` the rows of `table` matching `query` and return how many went.
    pub async fn delete_counted(
        &self,
        table: &str,
        query: &[(&str, String)],
    ) -> Result<u64, DbError> {
        let response = self
            .send(
                Method::DELETE,
                table,
                query,
                Some("count=exact,return=minimal"),
                None,
            )
            .await?;
        // PostgREST reports the count as the part after the last `/` in `Content-Range`.
        let count = response
            .headers()
            .get("content-range")
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.rsplit_once('/'))
            .and_then(|(_, count)| count.parse::<u64>().ok())
            .unwrap_or(0);
        Ok(count)
    }

    /// `POST` `args` to the database function `name` and return its JSON reply (`null` when empty).
    pub async fn rpc(&self, name: &str, args: &Value) -> Result<Value, DbError> {
        let response = self
            .send(Method::POST, &format!("rpc/{name}"), &[], None, Some(args))
            .await?;
        value(response).await
    }

    /// `POST` one `row` into `table`, skipping it when `on_conflict` columns already exist.
    pub async fn insert_ignore(
        &self,
        table: &str,
        row: &Value,
        on_conflict: &str,
    ) -> Result<(), DbError> {
        let _response = self
            .send(
                Method::POST,
                table,
                &[("on_conflict", on_conflict.to_string())],
                Some("resolution=ignore-duplicates,return=minimal"),
                Some(row),
            )
            .await?;
        Ok(())
    }

    /// Sends one request and returns the response when it is 2xx.
    async fn send(
        &self,
        method: Method,
        table: &str,
        query: &[(&str, String)],
        prefer: Option<&str>,
        body: Option<&Value>,
    ) -> Result<Response, DbError> {
        let mut url = reqwest::Url::parse(&format!("{}/{table}", self.data_url))
            .map_err(|err| transport_error(&err.to_string()))?;
        if !query.is_empty() {
            let mut pairs = url.query_pairs_mut();
            for (key, value) in query {
                let _pairs = pairs.append_pair(key, value);
            }
        }
        let mut request = self
            .client
            .request(method, url)
            .header("apikey", self.anon_key)
            .header("Authorization", format!("Bearer {}", self.token))
            .header("Accept", "application/json");
        if let Some(prefer) = prefer {
            request = request.header("Prefer", prefer);
        }
        if let Some(body) = body {
            request = request
                .header("Content-Type", "application/json")
                .body(body.to_string());
        }
        let response = request
            .send()
            .await
            .map_err(|err| transport_error(&err.to_string()))?;
        let status = response.status();
        if status.is_success() {
            return Ok(response);
        }
        let bytes = response.bytes().await.unwrap_or_default();
        let text = String::from_utf8_lossy(&bytes).into_owned();
        Err(DbError {
            code: error_code(&text),
            message: format!("HTTP {}: {text}", status.as_u16()),
        })
    }
}

/// Builds the row list from a 2xx reply; anything but a JSON array is unexpected.
async fn rows(response: Response) -> Result<Vec<Value>, DbError> {
    let bytes = response
        .bytes()
        .await
        .map_err(|err| transport_error(&err.to_string()))?;
    match serde_json::from_slice::<Value>(&bytes) {
        Ok(Value::Array(rows)) => Ok(rows),
        _ => Err(DbError {
            code: None,
            message: "Unexpected reply from the database.".to_string(),
        }),
    }
}

/// Parses a 2xx reply as JSON; an empty body is `null`.
async fn value(response: Response) -> Result<Value, DbError> {
    let bytes = response
        .bytes()
        .await
        .map_err(|err| transport_error(&err.to_string()))?;
    if bytes.iter().all(u8::is_ascii_whitespace) {
        return Ok(Value::Null);
    }
    serde_json::from_slice::<Value>(&bytes).map_err(|_| DbError {
        code: None,
        message: "Unexpected reply from the database.".to_string(),
    })
}

/// The `code` of a JSON error object, when it is a non-empty string.
fn error_code(text: &str) -> Option<String> {
    let value: Value = serde_json::from_str(text).ok()?;
    match value.get("code") {
        Some(Value::String(code)) if !code.is_empty() => Some(code.clone()),
        _ => None,
    }
}

fn transport_error(message: &str) -> DbError {
    DbError {
        code: None,
        message: message.to_string(),
    }
}

/// A PostgREST `eq.` filter for `value`.
#[must_use]
pub fn eq(value: &str) -> String {
    format!("eq.{value}")
}

/// A PostgREST `in.(...)` filter; each value is quoted, with `\` and `"` escaped.
#[must_use]
pub fn in_list(values: &[String]) -> String {
    let quoted: Vec<String> = values
        .iter()
        .map(|value| format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\"")))
        .collect();
    format!("in.({})", quoted.join(","))
}
