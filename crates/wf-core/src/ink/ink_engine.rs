//! Declared facts about the ink engines this build knows, and the line-stroke slice
//! (`packages/core/src/ink/recognise.ts` data, `packages/core/src/ink/segment.ts`
//! `inkLineStrokes`). Engines themselves stay in the shells: no JS functions here.

use serde::Serialize;

/// The declared facts about one engine (`INK_ENGINES` entry in TS).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InkEngineInfo {
    /// Stable id, written into a note's `ink-engine`.
    pub id: &'static str,
    /// Whether it works with no network.
    pub offline: bool,
    /// Whether it consumes stroke trajectories rather than bitmaps.
    pub online: bool,
    /// Where it can run.
    pub platform: &'static str,
}

/// The engines this build knows of, in preference order (declaration order).
pub const INK_ENGINES: [InkEngineInfo; 1] = [InkEngineInfo {
    id: "windows-ink@1",
    offline: true,
    online: true,
    platform: "desktop-windows",
}];

/// Whether an engine id is one this build was written against.
#[must_use]
pub fn is_ink_engine_id(id: &str) -> bool {
    INK_ENGINES.iter().any(|engine| engine.id == id)
}

/// The declared facts about an engine, or `None` for an id we do not know.
#[must_use]
pub fn ink_engine_info(id: &str) -> Option<InkEngineInfo> {
    INK_ENGINES.iter().copied().find(|engine| engine.id == id)
}

/// The engine's preference rank: its index in [`INK_ENGINES`], or the engine count for an
/// id we do not know, so unknown engines sort after every known one.
#[must_use]
pub fn ink_engine_rank(id: &str) -> usize {
    INK_ENGINES
        .iter()
        .position(|engine| engine.id == id)
        .unwrap_or(INK_ENGINES.len())
}

/// The strokes of one line, by the container's `[stroke_start, stroke_start + stroke_count)`
/// range, clamped to the input like JS `slice`.
#[must_use]
pub fn ink_line_strokes<T: Clone>(strokes: &[T], stroke_start: u32, stroke_count: u32) -> Vec<T> {
    let len = strokes.len();
    let start = usize::try_from(stroke_start).unwrap_or(usize::MAX).min(len);
    let end = start
        .saturating_add(usize::try_from(stroke_count).unwrap_or(usize::MAX))
        .min(len);
    strokes.get(start..end).map_or_else(Vec::new, <[T]>::to_vec)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_engine_ids_are_recognised() {
        assert!(is_ink_engine_id("windows-ink@1"));
        assert!(!is_ink_engine_id("windows-ink"));
        assert!(!is_ink_engine_id("stroke-ctc-small"));
        assert!(!is_ink_engine_id(""));
    }

    #[test]
    fn info_is_the_declared_facts_or_none() {
        assert_eq!(
            ink_engine_info("windows-ink@1"),
            Some(InkEngineInfo {
                id: "windows-ink@1",
                offline: true,
                online: true,
                platform: "desktop-windows",
            })
        );
        assert_eq!(ink_engine_info("myscript@1"), None);
    }

    #[test]
    fn info_serialises_camel_case_like_the_ts_entry() {
        let json = serde_json::to_value(ink_engine_info("windows-ink@1")).expect("serialise info");
        assert_eq!(
            json,
            serde_json::json!({
                "id": "windows-ink@1",
                "offline": true,
                "online": true,
                "platform": "desktop-windows",
            })
        );
        let missing = serde_json::to_value(ink_engine_info("nope")).expect("serialise none");
        assert_eq!(missing, serde_json::Value::Null);
    }

    #[test]
    fn line_strokes_are_the_range_and_clamp_like_slice() {
        let strokes = ["a", "b", "c", "d"];
        assert_eq!(ink_line_strokes(&strokes, 2, 2), vec!["c", "d"]);
        assert_eq!(ink_line_strokes(&strokes, 1, 1), vec!["b"]);
        assert_eq!(ink_line_strokes(&strokes, 3, 5), vec!["d"]);
        assert!(ink_line_strokes(&strokes, 9, 2).is_empty());
        assert!(ink_line_strokes(&strokes, 0, 0).is_empty());
        assert!(ink_line_strokes::<u8>(&[], 0, 3).is_empty());
    }

    #[test]
    fn rank_is_the_declaration_order_and_unknown_ids_sort_last() {
        assert_eq!(ink_engine_rank("windows-ink@1"), 0);
        assert_eq!(ink_engine_rank("myscript@1"), INK_ENGINES.len());
        assert_eq!(ink_engine_rank(""), INK_ENGINES.len());
    }
}
