//! A minimal Postgres wire client over TCP. It asks for text results, which tokio-postgres does not.

use super::{Column, Conn, PgError, TextRows};
use bytes::{BufMut, BytesMut};
use fallible_iterator::FallibleIterator;
use postgres_protocol::IsNull;
use postgres_protocol::authentication::sasl::{ChannelBinding, SCRAM_SHA_256, ScramSha256};
use postgres_protocol::message::{backend, frontend};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

/// A connection to Postgres over TCP.
pub struct PgConn {
    stream: TcpStream,
    read: BytesMut,
    write: BytesMut,
}

#[allow(clippy::needless_pass_by_value, reason = "passed to map_err")]
fn io(e: std::io::Error) -> PgError {
    PgError::local(e.to_string())
}

fn error_from(body: &backend::ErrorResponseBody) -> PgError {
    let mut code = String::new();
    let mut message = String::new();
    let mut fields = body.fields();
    while let Ok(Some(field)) = fields.next() {
        match field.type_() {
            b'C' => code = String::from_utf8_lossy(field.value_bytes()).into_owned(),
            b'M' => message = String::from_utf8_lossy(field.value_bytes()).into_owned(),
            _ => {}
        }
    }
    PgError { code, message }
}

/// Keeps only the first error seen before `ReadyForQuery`, so the connection stays in sync.
fn keep_first(first: &mut Option<PgError>, e: PgError) {
    if first.is_none() {
        *first = Some(e);
    }
}

fn first_error(first: Option<PgError>) -> Result<(), PgError> {
    match first {
        Some(e) => Err(e),
        None => Ok(()),
    }
}

fn read_columns(body: &backend::RowDescriptionBody) -> Result<Vec<Column>, PgError> {
    let mut fields = body.fields();
    let mut columns = Vec::new();
    while let Some(field) = fields.next().map_err(io)? {
        columns.push(Column {
            name: field.name().to_owned(),
            type_oid: field.type_oid(),
        });
    }
    Ok(columns)
}

fn text_at(buffer: &[u8], range: std::ops::Range<usize>) -> Result<String, PgError> {
    buffer
        .get(range)
        .and_then(|bytes| std::str::from_utf8(bytes).ok())
        .map(str::to_owned)
        .ok_or_else(|| PgError::local("Postgres sent a value that is not UTF-8"))
}

fn decode_row(body: &backend::DataRowBody) -> Result<Vec<Option<String>>, PgError> {
    let buffer = body.buffer();
    let mut row = Vec::new();
    let mut ranges = body.ranges();
    while let Some(range) = ranges.next().map_err(io)? {
        row.push(match range {
            None => None,
            Some(r) => Some(text_at(buffer, r)?),
        });
    }
    Ok(row)
}

fn encode_params(
    params: &[serde_json::Value],
    oids: &[u32],
) -> Result<Vec<Option<String>>, PgError> {
    let mut texts = Vec::with_capacity(params.len());
    for (i, v) in params.iter().enumerate() {
        let oid = oids.get(i).copied().unwrap_or(0);
        texts.push(super::value::param_to_text(v, oid)?);
    }
    Ok(texts)
}

/// Opens a TCP connection and authenticates with SCRAM-SHA-256 only.
pub async fn connect(
    host: &str,
    port: u16,
    user: &str,
    password: &str,
    database: &str,
) -> Result<PgConn, PgError> {
    connect_with(host, port, user, password, database, true).await
}

/// `connect`, but `require_proof = false` also accepts a server that skips auth (test fakes).
async fn connect_with(
    host: &str,
    port: u16,
    user: &str,
    password: &str,
    database: &str,
    require_proof: bool,
) -> Result<PgConn, PgError> {
    let stream = TcpStream::connect((host, port)).await.map_err(io)?;
    stream.set_nodelay(true).map_err(io)?;
    let mut conn = PgConn {
        stream,
        read: BytesMut::new(),
        write: BytesMut::new(),
    };
    let params = [
        ("user", user),
        ("database", database),
        ("client_encoding", "UTF8"),
        ("TimeZone", "UTC"),
        ("DateStyle", "ISO"),
        ("application_name", "weaveforge"),
    ];
    frontend::startup_message(params, &mut conn.write).map_err(io)?;
    conn.send().await?;
    conn.authenticate(password, require_proof).await?;
    Ok(conn)
}

impl PgConn {
    async fn send(&mut self) -> Result<(), PgError> {
        self.stream.write_all(&self.write).await.map_err(io)?;
        self.write.clear();
        Ok(())
    }

    async fn next(&mut self) -> Result<backend::Message, PgError> {
        loop {
            if let Some(message) = backend::Message::parse(&mut self.read).map_err(io)? {
                return Ok(message);
            }
            let n = self.stream.read_buf(&mut self.read).await.map_err(io)?;
            if n == 0 {
                return Err(PgError::local("Postgres closed the connection"));
            }
        }
    }

    async fn authenticate(&mut self, password: &str, require_proof: bool) -> Result<(), PgError> {
        let mut scram: Option<ScramSha256> = None;
        // Only a server that proved it knows the password is trusted.
        let mut proven = false;
        loop {
            match self.next().await? {
                backend::Message::AuthenticationOk => {
                    if require_proof && !proven {
                        return Err(PgError::local("Postgres accepted without a SCRAM proof"));
                    }
                }
                backend::Message::AuthenticationCleartextPassword => {
                    return Err(PgError::local("cleartext auth is not supported"));
                }
                backend::Message::AuthenticationMd5Password(_) => {
                    return Err(PgError::local("md5 auth is not supported"));
                }
                backend::Message::AuthenticationSasl(body) => {
                    let mut mechanisms = body.mechanisms();
                    let mut offered = false;
                    while let Some(name) = mechanisms.next().map_err(io)? {
                        offered |= name == SCRAM_SHA_256;
                    }
                    if !offered {
                        return Err(PgError::local("Postgres offered no SCRAM-SHA-256"));
                    }
                    let s = ScramSha256::new(password.as_bytes(), ChannelBinding::unsupported());
                    frontend::sasl_initial_response(SCRAM_SHA_256, s.message(), &mut self.write)
                        .map_err(io)?;
                    self.send().await?;
                    scram = Some(s);
                }
                backend::Message::AuthenticationSaslContinue(body) => {
                    let Some(s) = scram.as_mut() else {
                        return Err(PgError::local("Postgres sent SCRAM data before starting"));
                    };
                    s.update(body.data()).map_err(io)?;
                    frontend::sasl_response(s.message(), &mut self.write).map_err(io)?;
                    self.send().await?;
                }
                backend::Message::AuthenticationSaslFinal(body) => {
                    let Some(s) = scram.as_mut() else {
                        return Err(PgError::local("Postgres sent SCRAM data before starting"));
                    };
                    s.finish(body.data())
                        .map_err(|_| PgError::local("Postgres SCRAM proof did not match"))?;
                    proven = true;
                }
                backend::Message::ErrorResponse(body) => return Err(error_from(&body)),
                backend::Message::ReadyForQuery(_) => return Ok(()),
                _ => {}
            }
        }
    }

    async fn describe(&mut self, sql: &str) -> Result<(Vec<u32>, Vec<Column>), PgError> {
        frontend::parse("", sql, std::iter::empty::<u32>(), &mut self.write).map_err(io)?;
        frontend::describe(b'S', "", &mut self.write).map_err(io)?;
        frontend::sync(&mut self.write);
        self.send().await?;
        let mut oids = Vec::new();
        let mut columns = Vec::new();
        let mut first = None;
        loop {
            match self.next().await? {
                backend::Message::ParameterDescription(body) => {
                    let mut params = body.parameters();
                    while let Some(oid) = params.next().map_err(io)? {
                        oids.push(oid);
                    }
                }
                backend::Message::RowDescription(body) => columns = read_columns(&body)?,
                backend::Message::ErrorResponse(body) => keep_first(&mut first, error_from(&body)),
                backend::Message::ReadyForQuery(_) => {
                    return first_error(first).map(|()| (oids, columns));
                }
                _ => {}
            }
        }
    }

    async fn run(&mut self, texts: &[Option<String>]) -> Result<Vec<Vec<Option<String>>>, PgError> {
        frontend::bind(
            "",
            "",
            std::iter::empty::<i16>(),
            texts.iter(),
            |t: &Option<String>, buf: &mut BytesMut| match t {
                None => Ok(IsNull::Yes),
                Some(s) => {
                    buf.put_slice(s.as_bytes());
                    Ok(IsNull::No)
                }
            },
            std::iter::empty::<i16>(),
            &mut self.write,
        )
        .map_err(|_| PgError::local("could not encode params"))?;
        frontend::execute("", 0, &mut self.write).map_err(io)?;
        frontend::sync(&mut self.write);
        self.send().await?;
        let mut rows = Vec::new();
        let mut first = None;
        loop {
            match self.next().await? {
                backend::Message::DataRow(body) => match decode_row(&body) {
                    Ok(row) => rows.push(row),
                    Err(e) => keep_first(&mut first, e),
                },
                backend::Message::ErrorResponse(body) => keep_first(&mut first, error_from(&body)),
                backend::Message::ReadyForQuery(_) => {
                    return first_error(first).map(|()| rows);
                }
                _ => {}
            }
        }
    }
}

impl Conn for PgConn {
    async fn exec(&mut self, sql: &str) -> Result<(), PgError> {
        frontend::query(sql, &mut self.write).map_err(io)?;
        self.send().await?;
        let mut first = None;
        loop {
            match self.next().await? {
                backend::Message::ErrorResponse(body) => keep_first(&mut first, error_from(&body)),
                backend::Message::ReadyForQuery(_) => return first_error(first),
                _ => {}
            }
        }
    }

    async fn query(
        &mut self,
        sql: &str,
        params: &[serde_json::Value],
    ) -> Result<TextRows, PgError> {
        let (oids, columns) = self.describe(sql).await?;
        let texts = encode_params(params, &oids)?;
        let rows = self.run(&texts).await?;
        Ok(TextRows { columns, rows })
    }
}

impl PgConn {
    /// Sends Terminate and shuts the socket down.
    pub async fn close(mut self) -> Result<(), PgError> {
        frontend::terminate(&mut self.write);
        self.send().await?;
        self.stream.shutdown().await.map_err(io)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    /// Builds one backend message: tag, i32 length (including itself), body.
    fn msg(tag: u8, body: &[u8]) -> Vec<u8> {
        let len = i32::try_from(body.len() + 4).unwrap_or(i32::MAX);
        let mut out = vec![tag];
        out.extend_from_slice(&len.to_be_bytes());
        out.extend_from_slice(body);
        out
    }

    fn auth_ok() -> Vec<u8> {
        msg(b'R', &0_i32.to_be_bytes())
    }

    fn ready() -> Vec<u8> {
        msg(b'Z', b"I")
    }

    fn error_msg(code: &str, message: &str) -> Vec<u8> {
        let mut body = Vec::new();
        for (k, v) in [(b'S', "FATAL"), (b'C', code), (b'M', message)] {
            body.push(k);
            body.extend_from_slice(v.as_bytes());
            body.push(0);
        }
        body.push(0);
        msg(b'E', &body)
    }

    async fn read_startup(sock: &mut TcpStream) -> std::io::Result<()> {
        let len = sock.read_i32().await?;
        let mut body = vec![0u8; usize::try_from(len).unwrap_or(4).saturating_sub(4)];
        let _ = sock.read_exact(&mut body).await?;
        Ok(())
    }

    /// Reads frontend messages until one with `tag` (b'S' sync, b'Q' simple query).
    async fn read_until(sock: &mut TcpStream, tag: u8) -> std::io::Result<()> {
        loop {
            let t = sock.read_u8().await?;
            let len = sock.read_i32().await?;
            let mut body = vec![0u8; usize::try_from(len).unwrap_or(4).saturating_sub(4)];
            let _ = sock.read_exact(&mut body).await?;
            if t == tag {
                return Ok(());
            }
        }
    }

    #[tokio::test]
    async fn connect_rejects_server_without_scram_proof() -> Result<(), Box<dyn std::error::Error>>
    {
        let listener = TcpListener::bind("127.0.0.1:0").await?;
        let port = listener.local_addr()?.port();
        let server = tokio::spawn(async move {
            let (mut sock, _) = listener.accept().await?;
            read_startup(&mut sock).await?;
            sock.write_all(&[auth_ok(), ready()].concat()).await?;
            Ok::<(), std::io::Error>(())
        });
        let err = match connect("127.0.0.1", port, "u", "p", "db").await {
            Err(e) => e,
            Ok(_) => return Err("connect should refuse a server that skipped SCRAM".into()),
        };
        assert_eq!(err.message, "Postgres accepted without a SCRAM proof");
        server.await??;
        Ok(())
    }

    #[tokio::test]
    async fn connect_refuses_cleartext_password() -> Result<(), Box<dyn std::error::Error>> {
        let listener = TcpListener::bind("127.0.0.1:0").await?;
        let port = listener.local_addr()?.port();
        let server = tokio::spawn(async move {
            let (mut sock, _) = listener.accept().await?;
            read_startup(&mut sock).await?;
            sock.write_all(&msg(b'R', &3_i32.to_be_bytes())).await?;
            // The client must hang up without sending a password message.
            let mut rest = Vec::new();
            let _ = sock.read_to_end(&mut rest).await?;
            Ok::<Vec<u8>, std::io::Error>(rest)
        });
        let err = match connect("127.0.0.1", port, "u", "p", "db").await {
            Err(e) => e,
            Ok(_) => return Err("connect should refuse cleartext auth".into()),
        };
        assert_eq!(err.message, "cleartext auth is not supported");
        assert!(server.await??.is_empty(), "no password may be sent");
        Ok(())
    }

    #[tokio::test]
    async fn connect_with_accepts_auth_ok_when_proof_not_required()
    -> Result<(), Box<dyn std::error::Error>> {
        let listener = TcpListener::bind("127.0.0.1:0").await?;
        let port = listener.local_addr()?.port();
        let server = tokio::spawn(async move {
            let (mut sock, _) = listener.accept().await?;
            read_startup(&mut sock).await?;
            sock.write_all(&[auth_ok(), ready()].concat()).await?;
            Ok::<(), std::io::Error>(())
        });
        let _conn = connect_with("127.0.0.1", port, "u", "p", "db", false).await?;
        server.await??;
        Ok(())
    }

    #[tokio::test]
    async fn connect_keeps_server_error_code() -> Result<(), Box<dyn std::error::Error>> {
        let listener = TcpListener::bind("127.0.0.1:0").await?;
        let port = listener.local_addr()?.port();
        let server = tokio::spawn(async move {
            let (mut sock, _) = listener.accept().await?;
            read_startup(&mut sock).await?;
            sock.write_all(&error_msg("28P01", "password authentication failed"))
                .await?;
            Ok::<(), std::io::Error>(())
        });
        let err = match connect("127.0.0.1", port, "u", "p", "db").await {
            Err(e) => e,
            Ok(_) => return Err("connect should fail".into()),
        };
        assert_eq!(err.code, "28P01");
        assert_eq!(err.message, "password authentication failed");
        server.await??;
        Ok(())
    }

    #[tokio::test]
    async fn query_returns_text_rows() -> Result<(), Box<dyn std::error::Error>> {
        let listener = TcpListener::bind("127.0.0.1:0").await?;
        let port = listener.local_addr()?.port();
        let server = tokio::spawn(async move {
            let (mut sock, _) = listener.accept().await?;
            read_startup(&mut sock).await?;
            sock.write_all(&[auth_ok(), ready()].concat()).await?;
            // Describe phase: Parse, Describe, Sync.
            read_until(&mut sock, b'S').await?;
            let describe_reply = [
                msg(b'1', &[]),
                msg(b't', &[0, 1, 0, 0, 0, 23]),
                msg(
                    b'T',
                    &[
                        0, 1, // one field
                        b'n', 0, // name
                        0, 0, 0, 0, // table oid
                        0, 0, // attnum
                        0, 0, 0, 23, // type oid
                        0, 4, // size
                        255, 255, 255, 255, // typmod -1
                        0, 0, // text format
                    ],
                ),
                ready(),
            ]
            .concat();
            sock.write_all(&describe_reply).await?;
            // Run phase: Bind, Execute, Sync.
            read_until(&mut sock, b'S').await?;
            let run_reply = [
                msg(b'2', &[]),
                msg(b'D', &[0, 1, 0, 0, 0, 1, b'7']),
                msg(b'D', &[0, 1, 255, 255, 255, 255]),
                msg(b'C', b"SELECT 2\0"),
                ready(),
            ]
            .concat();
            sock.write_all(&run_reply).await?;
            Ok::<(), std::io::Error>(())
        });
        let mut conn = connect_with("127.0.0.1", port, "u", "p", "db", false).await?;
        let out = conn.query("select $1", &[serde_json::json!(5)]).await?;
        assert_eq!(
            out.columns,
            vec![Column {
                name: "n".to_owned(),
                type_oid: 23,
            }]
        );
        assert_eq!(out.rows, vec![vec![Some("7".to_owned())], vec![None]]);
        server.await??;
        Ok(())
    }

    #[tokio::test]
    async fn exec_error_keeps_connection_in_sync() -> Result<(), Box<dyn std::error::Error>> {
        let listener = TcpListener::bind("127.0.0.1:0").await?;
        let port = listener.local_addr()?.port();
        let server = tokio::spawn(async move {
            let (mut sock, _) = listener.accept().await?;
            read_startup(&mut sock).await?;
            sock.write_all(&[auth_ok(), ready()].concat()).await?;
            read_until(&mut sock, b'Q').await?;
            sock.write_all(&[error_msg("42P01", "relation missing"), ready()].concat())
                .await?;
            read_until(&mut sock, b'Q').await?;
            sock.write_all(&[msg(b'C', b"SET\0"), ready()].concat())
                .await?;
            Ok::<(), std::io::Error>(())
        });
        let mut conn = connect_with("127.0.0.1", port, "u", "p", "db", false).await?;
        let err = match conn.exec("bad").await {
            Err(e) => e,
            Ok(()) => return Err("exec should fail".into()),
        };
        assert_eq!(err.code, "42P01");
        conn.exec("set x").await?;
        server.await??;
        Ok(())
    }
}
