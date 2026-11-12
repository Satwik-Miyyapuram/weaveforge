//! Embedder lifecycle rules for the semantic index (wf-core `search::embedding_runtime`).
//! Ports `IDLE_EVICT_MS` and `supportsLocalEmbedding` in
//! `apps/web/src/features/search/infrastructure/parts-3.ts`. The browser globals are
//! probed in TS and passed in; the timers and the Worker stay in TS.

/// How long an idle embedder keeps its model loaded before it is evicted: five minutes.
pub const IDLE_EVICT_MS: u32 = 5 * 60_000;

/// Whether the encoder can run at all: it needs both a Worker host and WebAssembly.
#[must_use]
pub const fn supports_local_embedding(has_worker: bool, has_web_assembly: bool) -> bool {
    has_worker && has_web_assembly
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn idle_evict_is_five_minutes() {
        assert_eq!(IDLE_EVICT_MS, 300_000);
    }

    #[test]
    fn local_embedding_needs_worker_and_wasm() {
        assert!(supports_local_embedding(true, true));
        assert!(!supports_local_embedding(true, false));
        assert!(!supports_local_embedding(false, true));
        assert!(!supports_local_embedding(false, false));
    }
}
