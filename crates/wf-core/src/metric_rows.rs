//! Metric row mapping (TS `metric-rows.ts`). A row is one logged metric point. The wall time
//! arrives as an ISO 8601 string; a driver that hands back a `Date` is normalised by the caller
//! before the row reaches this module.

use serde::{Deserialize, Serialize};

/// A metric row as read.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct MetricRow {
    /// The experiment the point belongs to.
    pub experiment_id: String,
    /// The metric's name.
    pub metric: String,
    /// The training step the point was logged at.
    pub step: f64,
    /// The logged value.
    pub value: f64,
    /// When the point was logged (ISO 8601), when recorded.
    pub wall_time: Option<String>,
}

/// One metric point as the app models it (TS `MetricPoint`). Unset optionals are left out of
/// the serialized object, as `undefined` is in JS.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct MetricPoint {
    /// The experiment the point belongs to.
    pub experiment_id: String,
    /// The metric's name.
    pub metric: String,
    /// The training step the point was logged at.
    pub step: f64,
    /// The logged value.
    pub value: f64,
    /// When the point was logged (ISO 8601), when recorded.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub wall_time: Option<String>,
}

/// The point a row maps to (`toDomain`).
#[must_use]
pub fn to_domain(row: &MetricRow) -> MetricPoint {
    MetricPoint {
        experiment_id: row.experiment_id.clone(),
        metric: row.metric.clone(),
        step: row.step,
        value: row.value,
        wall_time: row.wall_time.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(wall_time: Option<&str>) -> MetricRow {
        MetricRow {
            experiment_id: "e1".into(),
            metric: "loss".into(),
            step: 3.0,
            value: 0.25,
            wall_time: wall_time.map(String::from),
        }
    }

    #[test]
    fn keeps_fields() {
        let point = to_domain(&row(Some("2026-04-01T10:00:00.000Z")));
        assert_eq!(point.experiment_id, "e1");
        assert_eq!(point.metric, "loss");
        assert!((point.step - 3.0).abs() < f64::EPSILON);
        assert_eq!(point.wall_time.as_deref(), Some("2026-04-01T10:00:00.000Z"));
    }

    #[test]
    fn missing_wall_time_stays_missing() {
        assert!(to_domain(&row(None)).wall_time.is_none());
    }
}
