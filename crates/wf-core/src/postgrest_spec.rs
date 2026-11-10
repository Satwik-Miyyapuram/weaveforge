//! PostgREST table specs (TS `backend/providers/postgrest/spec-repository.ts`). Rust names which
//! table, columns, project scope, order and filters a generic repository uses; TS runs them.

use serde::Serialize;

/// The `milestones` columns a row is read as, named rather than starred.
pub const MILESTONE_COLUMNS: &str =
    "id,title,description,status,target_date,dependencies,compute,created_at";

/// How a list is ordered.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct OrderSpec {
    /// The column to order by.
    pub column: String,
    /// Smallest first when true.
    pub ascending: bool,
    /// Whether nulls sort before the other values.
    pub nulls_first: bool,
}

/// A table of rows keyed by `id`, read and written one row at a time.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct RowSpec {
    /// The table name.
    pub table: String,
    /// The comma-separated column list a read selects.
    pub columns: String,
    /// Whether reads filter, and writes stamp, the selected project.
    pub project_scoped: bool,
    /// The list order, when there is one.
    pub order: Option<OrderSpec>,
    /// Filter keys a list applies as equality when the caller sets them.
    pub eq_filters: Vec<String>,
}

/// One JSON column of a row keyed by `id` (for example `projects.dashboard_layout`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct KeyedColumnSpec {
    /// The table name.
    pub table: String,
    /// The column that holds the value.
    pub column: String,
}

/// The row spec for a named repository, or `None` when no spec has that name.
#[must_use]
pub fn row_spec(name: &str) -> Option<RowSpec> {
    match name {
        "milestones" => Some(RowSpec {
            table: "milestones".into(),
            columns: MILESTONE_COLUMNS.into(),
            project_scoped: true,
            // Soonest target first; undated milestones sink to the end.
            order: Some(OrderSpec {
                column: "target_date".into(),
                ascending: true,
                nulls_first: false,
            }),
            eq_filters: vec!["status".into()],
        }),
        _ => None,
    }
}

/// The keyed-column spec for a named value, or `None` when no spec has that name.
#[must_use]
pub fn keyed_column_spec(name: &str) -> Option<KeyedColumnSpec> {
    let column = match name {
        "dashboardLayout" => "dashboard_layout",
        "graphSettings" => "graph_settings",
        _ => return None,
    };
    Some(KeyedColumnSpec {
        table: "projects".into(),
        column: column.into(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn milestone_spec_is_project_scoped_and_ordered_by_target_date() {
        let spec = row_spec("milestones").expect("milestones has a spec");
        assert_eq!(spec.table, "milestones");
        assert_eq!(spec.columns, MILESTONE_COLUMNS);
        assert!(spec.project_scoped);
        assert_eq!(spec.eq_filters, vec!["status".to_string()]);
        assert_eq!(
            spec.order,
            Some(OrderSpec {
                column: "target_date".into(),
                ascending: true,
                nulls_first: false,
            })
        );
    }

    #[test]
    fn unknown_names_have_no_spec() {
        assert!(row_spec("nope").is_none());
        assert!(keyed_column_spec("nope").is_none());
    }

    #[test]
    fn keyed_specs_point_at_project_columns() {
        let dashboard = keyed_column_spec("dashboardLayout").expect("dashboard spec");
        assert_eq!(dashboard.table, "projects");
        assert_eq!(dashboard.column, "dashboard_layout");
        let graph = keyed_column_spec("graphSettings").expect("graph spec");
        assert_eq!(graph.table, "projects");
        assert_eq!(graph.column, "graph_settings");
    }

    #[test]
    fn row_spec_serialises_camel_case_with_null_for_no_order() {
        let json = serde_json::to_value(row_spec("milestones").expect("spec")).expect("serialises");
        assert_eq!(json["projectScoped"], true);
        assert_eq!(json["eqFilters"][0], "status");
        assert_eq!(json["order"]["nullsFirst"], false);
        assert!(json.get("project_scoped").is_none());

        let no_order = RowSpec {
            order: None,
            ..row_spec("milestones").expect("spec")
        };
        let json = serde_json::to_value(no_order).expect("serialises");
        assert!(json["order"].is_null());
    }
}
