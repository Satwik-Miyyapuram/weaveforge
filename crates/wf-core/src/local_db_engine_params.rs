//! Start parameters for the local database engine (PGlite), used by the sidecar
//! and the desktop app (TS before this port: `apps/shell/sidecar/src/local-db-engine-params.ts`).

/// Shared buffers for the local engine. The default 128 MB cache is about 8x the
/// database and costs about 120 MB of main memory.
pub const LOCAL_DB_SHARED_BUFFERS: &str = "32MB";

/// `defaults` with `-c shared_buffers=<LOCAL_DB_SHARED_BUFFERS>` appended. `defaults` is not changed.
#[must_use]
pub fn engine_start_params(defaults: &[String]) -> Vec<String> {
    let mut params = Vec::with_capacity(defaults.len() + 2);
    params.extend(defaults.iter().cloned());
    params.push("-c".to_owned());
    params.push(format!("shared_buffers={LOCAL_DB_SHARED_BUFFERS}"));
    debug_assert_eq!(params.len(), defaults.len() + 2);
    params
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn appends_shared_buffers_after_defaults_and_keeps_input() {
        let defaults = vec!["-X".to_owned(), "custom".to_owned(), "--debug".to_owned()];
        let params = engine_start_params(&defaults);
        assert_eq!(
            params,
            ["-X", "custom", "--debug", "-c", "shared_buffers=32MB"]
        );
        assert_eq!(defaults, ["-X", "custom", "--debug"]);
    }
}
