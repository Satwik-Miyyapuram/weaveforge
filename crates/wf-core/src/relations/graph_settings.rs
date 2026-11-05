//! Graph view settings and the per-project graph state. Port of
//! `packages/core/src/features/relations/domain/graph-view-settings.ts` and
//! `graph-persisted-state.ts`.
//!
//! Both read untrusted JSON (a project row, local storage), so they take a
//! `serde_json::Value` and fall back to the defaults field by field.

use serde::de::DeserializeOwned;
use serde_json::{Map, Value};

use crate::reader_analysis::lines::js_trim;

/// Which links the graph draws.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub enum EdgeMode {
    /// Paper relations.
    Cites,
    /// Shared tags (concepts).
    Tags,
    /// Both.
    Both,
}

/// What a node's colour says.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub enum ColorBy {
    /// Reading status.
    Status,
    /// First tag.
    Tag,
    /// Reading list.
    List,
    /// Node kind.
    Type,
    /// Publication year ramp.
    Year,
    /// Link count ramp.
    Degree,
    /// Label-propagation community.
    Cluster,
    /// The person's own query rules.
    Groups,
}

/// The colouring `groupBy` picks (it never moves nodes).
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub enum GroupBy {
    /// No grouping.
    None,
    /// By status.
    Status,
    /// By list.
    List,
}

/// How nodes are arranged.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub enum LayoutMode {
    /// Physics layout.
    Force,
    /// x pinned to the publication year.
    Timeline,
}

/// Where node colours come from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub enum NodePalette {
    /// The active theme's chip colours.
    Theme,
    /// The muted original palette.
    Classic,
}

/// A paper relation kind (`RELATION_TYPES` in `paper-relation.ts`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub enum RelationType {
    /// Cites.
    Cites,
    /// Extends.
    Extends,
    /// Contradicts.
    Contradicts,
    /// Similar.
    Similar,
    /// Builds on.
    BuildsOn,
    /// Uses the method of.
    UsesMethod,
}

/// Per-kind colour overrides, as lower-case `#rrggbb`. Missing keys follow the palette.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[allow(missing_docs)]
pub struct NodeColors {
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub paper: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub to_read: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub reading: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub read: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub skimmed: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub note: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub report: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub experiment: Option<String>,
}

/// One custom colour rule: `tag:x`, `list:x`, `status:x`, or words in the title.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ColorGroup {
    /// The rule.
    pub query: String,
    /// Lower-case `#rrggbb`.
    pub color: String,
}

/// The graph's view settings (TS `GraphViewSettings`).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[allow(missing_docs, clippy::struct_excessive_bools)]
pub struct GraphViewSettings {
    pub edge_mode: EdgeMode,
    pub color_by: ColorBy,
    pub group_by: GroupBy,
    pub layout: LayoutMode,
    pub show_concepts: bool,
    pub min_concept_degree: f64,
    pub hide_orphans: bool,
    pub relation_types: Vec<RelationType>,
    pub show_concept_cooccurrence: bool,
    pub search_query: String,
    pub text_fade_threshold: f64,
    pub node_size: f64,
    pub link_thickness: f64,
    pub show_auto_style: bool,
    pub center_strength: f64,
    pub charge_strength: f64,
    pub link_distance: f64,
    pub node_palette: NodePalette,
    pub node_colors: NodeColors,
    pub color_groups: Vec<ColorGroup>,
    /// Optional in TS; read as `true` when absent.
    #[serde(default = "yes")]
    pub include_lists_as_concepts: bool,
    /// Optional in TS; read as `true` when absent.
    #[serde(default = "yes")]
    pub bounded_zoom_scale: bool,
}

const fn yes() -> bool {
    true
}

/// Enough rules to be useful, few enough that the legend still fits.
pub const MAX_COLOR_GROUPS: usize = 12;

/// `DEFAULT_GRAPH_SETTINGS`.
#[must_use]
pub fn default_graph_settings() -> GraphViewSettings {
    GraphViewSettings {
        edge_mode: EdgeMode::Cites,
        color_by: ColorBy::Status,
        group_by: GroupBy::None,
        layout: LayoutMode::Force,
        show_concepts: false,
        min_concept_degree: 2.0,
        hide_orphans: true,
        relation_types: vec![RelationType::Cites],
        show_concept_cooccurrence: false,
        search_query: String::new(),
        text_fade_threshold: 0.55,
        node_size: 1.0,
        link_thickness: 1.0,
        show_auto_style: true,
        center_strength: 0.05,
        charge_strength: -22.0,
        link_distance: 24.0,
        node_palette: NodePalette::Theme,
        node_colors: NodeColors::default(),
        color_groups: Vec::new(),
        include_lists_as_concepts: true,
        bounded_zoom_scale: true,
    }
}

/// `/^#[0-9a-f]{6}$/i`, lower-cased.
fn hex(v: Option<&Value>) -> Option<String> {
    let s = v?.as_str()?;
    let b = s.as_bytes();
    (b.len() == 7 && b[0] == b'#' && b[1..].iter().all(u8::is_ascii_hexdigit))
        .then(|| s.to_ascii_lowercase())
}

/// A string enum member, or `None` for anything else.
fn member<T: DeserializeOwned>(v: Option<&Value>) -> Option<T> {
    v.filter(|v| v.is_string())
        .and_then(|v| serde_json::from_value(v.clone()).ok())
}

fn boolean(v: Option<&Value>) -> Option<bool> {
    v.and_then(Value::as_bool)
}

/// A finite number. `serde_json` holds no `NaN` or infinity.
fn number(v: Option<&Value>) -> Option<f64> {
    v.and_then(Value::as_f64)
}

fn normalize_node_colors(raw: Option<&Value>) -> NodeColors {
    let Some(Value::Object(src)) = raw else {
        return NodeColors::default();
    };
    NodeColors {
        paper: hex(src.get("paper")),
        to_read: hex(src.get("to_read")),
        reading: hex(src.get("reading")),
        read: hex(src.get("read")),
        skimmed: hex(src.get("skimmed")),
        note: hex(src.get("note")),
        report: hex(src.get("report")),
        experiment: hex(src.get("experiment")),
    }
}

/// `s.slice(0, n)` in UTF-16 units. A surrogate pair the cut would split is dropped
/// whole, where JS keeps a lone half.
fn js_slice_start(s: &str, n: usize) -> String {
    let mut units = 0;
    s.chars()
        .take_while(|c| {
            units += c.len_utf16();
            units <= n
        })
        .collect()
}

fn normalize_color_groups(raw: Option<&Value>) -> Vec<ColorGroup> {
    let Some(Value::Array(items)) = raw else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for g in items {
        let Value::Object(g) = g else { continue };
        let (Some(query), Some(color)) =
            (g.get("query").and_then(Value::as_str), hex(g.get("color")))
        else {
            continue;
        };
        out.push(ColorGroup {
            query: js_slice_start(query, 80),
            color,
        });
        if out.len() == MAX_COLOR_GROUPS {
            break;
        }
    }
    out
}

/// Merges partial settings with the defaults and drops bad enum and number fields.
#[must_use]
pub fn normalize_graph_view_settings(raw: &Value) -> GraphViewSettings {
    let empty = Map::new();
    let o = match raw {
        Value::Object(o) => o,
        _ => &empty,
    };
    let d = default_graph_settings();
    let relation_types = match o.get("relationTypes") {
        Some(Value::Array(items)) => items.iter().filter_map(|t| member(Some(t))).collect(),
        _ => d.relation_types.clone(),
    };
    GraphViewSettings {
        edge_mode: member(o.get("edgeMode")).unwrap_or(d.edge_mode),
        color_by: member(o.get("colorBy")).unwrap_or(d.color_by),
        group_by: member(o.get("groupBy")).unwrap_or(d.group_by),
        layout: member(o.get("layout")).unwrap_or(d.layout),
        show_concepts: boolean(o.get("showConcepts")).unwrap_or(d.show_concepts),
        min_concept_degree: number(o.get("minConceptDegree")).unwrap_or(d.min_concept_degree),
        hide_orphans: boolean(o.get("hideOrphans")).unwrap_or(d.hide_orphans),
        relation_types: if relation_types.is_empty() {
            d.relation_types
        } else {
            relation_types
        },
        show_concept_cooccurrence: boolean(o.get("showConceptCooccurrence"))
            .unwrap_or(d.show_concept_cooccurrence),
        search_query: o
            .get("searchQuery")
            .and_then(Value::as_str)
            .map_or(d.search_query, str::to_owned),
        text_fade_threshold: number(o.get("textFadeThreshold")).unwrap_or(d.text_fade_threshold),
        node_size: number(o.get("nodeSize")).unwrap_or(d.node_size),
        link_thickness: number(o.get("linkThickness")).unwrap_or(d.link_thickness),
        show_auto_style: boolean(o.get("showAutoStyle")).unwrap_or(d.show_auto_style),
        center_strength: number(o.get("centerStrength")).unwrap_or(d.center_strength),
        charge_strength: number(o.get("chargeStrength")).unwrap_or(d.charge_strength),
        link_distance: number(o.get("linkDistance")).unwrap_or(d.link_distance),
        node_palette: member(o.get("nodePalette")).unwrap_or(d.node_palette),
        node_colors: normalize_node_colors(o.get("nodeColors")),
        color_groups: normalize_color_groups(o.get("colorGroups")),
        include_lists_as_concepts: boolean(o.get("includeListsAsConcepts"))
            .unwrap_or(d.include_lists_as_concepts),
        bounded_zoom_scale: boolean(o.get("boundedZoomScale")).unwrap_or(d.bounded_zoom_scale),
    }
}

/// Whether relation edges show.
#[must_use]
pub fn show_relation_edges(settings: &GraphViewSettings) -> bool {
    matches!(settings.edge_mode, EdgeMode::Cites | EdgeMode::Both)
}

/// Whether concept edges show.
#[must_use]
pub fn show_concept_edges(settings: &GraphViewSettings) -> bool {
    settings.show_concepts || matches!(settings.edge_mode, EdgeMode::Tags | EdgeMode::Both)
}

/// The relation kinds to draw; none when relation edges are hidden.
#[must_use]
pub fn effective_relation_types(settings: &GraphViewSettings) -> Vec<RelationType> {
    if !show_relation_edges(settings) {
        return Vec::new();
    }
    if settings.relation_types.is_empty() {
        vec![RelationType::Cites]
    } else {
        settings.relation_types.clone()
    }
}

/// How many filters differ from the defaults, for the toolbar badge.
#[must_use]
pub fn graph_filter_count(
    selected_tags: usize,
    selected_lists: usize,
    settings: &GraphViewSettings,
) -> u32 {
    [
        selected_tags > 0,
        selected_lists > 0,
        settings.edge_mode != EdgeMode::Cites,
        settings.color_by != ColorBy::Status,
        settings.show_concepts,
        settings.hide_orphans,
        !js_trim(&settings.search_query).is_empty(),
        settings.group_by != GroupBy::None,
        settings.layout != LayoutMode::Force,
    ]
    .into_iter()
    .map(u32::from)
    .sum()
}

/// A pinned node's position.
#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize, serde::Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[allow(missing_docs)]
pub struct GraphPinnedPosition {
    pub x: f64,
    pub y: f64,
}

/// Per-project graph UI state synced across devices (TS `GraphPersistedState`).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[allow(missing_docs)]
pub struct GraphPersistedState {
    pub settings: GraphViewSettings,
    pub selected_lists: Vec<String>,
    pub selected_tags: Vec<String>,
    pub local_seed: Option<String>,
    pub local_depth: f64,
    /// Node id to position, in the order the JSON gave them.
    #[cfg_attr(
        feature = "specta",
        specta(type = std::collections::BTreeMap<String, GraphPinnedPosition>)
    )]
    pub pinned: Map<String, Value>,
}

fn string_array(raw: Option<&Value>) -> Vec<String> {
    let Some(Value::Array(items)) = raw else {
        return Vec::new();
    };
    items
        .iter()
        .filter_map(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
        .collect()
}

fn parse_pinned(raw: Option<&Value>) -> Map<String, Value> {
    let Some(Value::Object(src)) = raw else {
        return Map::new();
    };
    let mut out = Map::new();
    for (id, pos) in src {
        let Value::Object(p) = pos else { continue };
        if let (Some(x), Some(y)) = (number(p.get("x")), number(p.get("y"))) {
            let _ = out.insert(id.clone(), serde_json::json!({ "x": x, "y": y }));
        }
    }
    out
}

/// Parses graph state from persistence; `None` when the payload is absent or not an object.
#[must_use]
pub fn parse_graph_persisted_state(raw: &Value) -> Option<GraphPersistedState> {
    let Value::Object(o) = raw else {
        return None;
    };
    // `>= 1` keeps the value positive, where JS `Math.round` and Rust `round` agree.
    let local_depth = number(o.get("localDepth"))
        .filter(|d| *d >= 1.0)
        .map_or(2.0, f64::round);
    Some(GraphPersistedState {
        settings: normalize_graph_view_settings(o.get("settings").unwrap_or(&Value::Null)),
        selected_lists: string_array(o.get("selectedLists")),
        selected_tags: string_array(o.get("selectedTags")),
        local_seed: o
            .get("localSeed")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .map(str::to_owned),
        local_depth,
        pinned: parse_pinned(o.get("pinned")),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn bad_fields_fall_back_to_defaults() {
        let s = normalize_graph_view_settings(&json!({
            "edgeMode": "both", "colorBy": 3, "relationTypes": ["nope"], "nodeSize": "2",
            "nodeColors": { "paper": "#ABCDEF", "read": "#abc" },
            "colorGroups": [{ "query": "tag:x", "color": "#00FF00" }, [1], { "query": 1, "color": "#000000" }]
        }));
        assert_eq!(s.edge_mode, EdgeMode::Both);
        assert_eq!(s.color_by, ColorBy::Status);
        assert_eq!(s.relation_types, vec![RelationType::Cites]);
        assert!((s.node_size - 1.0).abs() < f64::EPSILON);
        assert_eq!(s.node_colors.paper.as_deref(), Some("#abcdef"));
        assert_eq!(s.node_colors.read, None);
        assert_eq!(
            s.color_groups,
            vec![ColorGroup {
                query: "tag:x".into(),
                color: "#00ff00".into()
            }]
        );
    }

    #[test]
    fn persisted_state_rounds_depth_and_drops_bad_pins() {
        assert_eq!(parse_graph_persisted_state(&Value::Null), None);
        assert_eq!(parse_graph_persisted_state(&json!([])), None);
        let s = parse_graph_persisted_state(&json!({
            "localDepth": 2.5, "localSeed": "", "selectedTags": ["a", "", 1],
            "pinned": { "n1": { "x": 1, "y": 2 }, "n2": { "x": "1", "y": 2 } }
        }))
        .unwrap();
        assert!((s.local_depth - 3.0).abs() < f64::EPSILON);
        assert_eq!(s.local_seed, None);
        assert_eq!(s.selected_tags, vec!["a".to_owned()]);
        assert_eq!(s.pinned.len(), 1);
    }

    #[test]
    fn filter_count_counts_changed_filters() {
        let mut s = default_graph_settings();
        assert_eq!(graph_filter_count(0, 0, &s), 1); // hideOrphans defaults on
        s.search_query = "  ".into();
        assert_eq!(graph_filter_count(1, 0, &s), 2);
        s.edge_mode = EdgeMode::Tags;
        assert!(effective_relation_types(&s).is_empty());
        assert!(show_concept_edges(&s));
    }

    #[test]
    fn slice_counts_utf16_units() {
        assert_eq!(js_slice_start("ab", 1), "a");
        assert_eq!(js_slice_start("a\u{1F600}", 2), "a");
        assert_eq!(js_slice_start("a\u{1F600}", 3), "a\u{1F600}");
    }
}
