//! Port of `packages/core/src/features/relations/domain/parts.ts` (the row
//! mapping in `apps/web/.../citation-alert-track-rows.ts`). Pure: rows in, domain out.

/// A paper watched for new citing papers (TS `CitationAlertTrack`).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct CitationAlertTrack {
    /// Track id.
    pub id: String,
    /// The watched paper.
    pub paper_id: String,
    /// When tracking started, ISO 8601 UTC.
    pub tracked_at: String,
    /// Absent until the first successful poll after tracking starts.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub last_checked_at: Option<String>,
    /// Citing-paper ids already seen by the provider.
    pub seen_citing_ids: Vec<String>,
}

/// A stored `citation_alert_tracks` row (TS `TrackRow`). Columns are snake_case.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct CitationAlertTrackRow {
    /// Track id.
    pub id: String,
    /// The watched paper.
    pub paper_id: String,
    /// When tracking started.
    pub tracked_at: String,
    /// Last successful poll; null until one happens.
    pub last_checked_at: Option<String>,
    /// Seen citing-paper ids; null reads as none.
    pub seen_citing_ids: Option<Vec<String>>,
}

/// Map a stored row to the domain track (TS `toDomain`). Null reads as absent (`last_checked_at`)
/// or empty (`seen_citing_ids`).
#[must_use]
pub fn citation_alert_track_from_row(row: CitationAlertTrackRow) -> CitationAlertTrack {
    CitationAlertTrack {
        id: row.id,
        paper_id: row.paper_id,
        tracked_at: row.tracked_at,
        last_checked_at: row.last_checked_at,
        seen_citing_ids: row.seen_citing_ids.unwrap_or_default(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(last: Option<&str>, seen: Option<Vec<&str>>) -> CitationAlertTrackRow {
        CitationAlertTrackRow {
            id: "t1".to_owned(),
            paper_id: "p1".to_owned(),
            tracked_at: "2026-01-01T00:00:00.000Z".to_owned(),
            last_checked_at: last.map(str::to_owned),
            seen_citing_ids: seen.map(|v| v.into_iter().map(str::to_owned).collect()),
        }
    }

    #[test]
    fn null_columns_read_as_absent_and_empty() {
        let track = citation_alert_track_from_row(row(None, None));
        assert_eq!(track.last_checked_at, None);
        assert!(track.seen_citing_ids.is_empty());
        let json = serde_json::to_string(&track).expect("serializes");
        assert!(!json.contains("lastCheckedAt"));
        assert!(json.contains(r#""seenCitingIds":[]"#));
    }

    #[test]
    fn present_values_map_to_camel_case() {
        let track = citation_alert_track_from_row(row(
            Some("2026-02-01T00:00:00.000Z"),
            Some(vec!["c1", "c2"]),
        ));
        assert_eq!(
            track.last_checked_at.as_deref(),
            Some("2026-02-01T00:00:00.000Z")
        );
        assert_eq!(track.seen_citing_ids, vec!["c1", "c2"]);
        assert_eq!(track.paper_id, "p1");
    }
}
