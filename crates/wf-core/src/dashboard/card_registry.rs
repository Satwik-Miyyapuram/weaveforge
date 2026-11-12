//! Dashboard card catalog, ported from the `CARD_REGISTRY` data and lookups in
//! `apps/web/src/features/dashboard/application/parts.ts`. Labels, groups, data-source deps,
//! role gates, sizes and the list-card flag live here. The React renderers stay in TS
//! (`ui/cards`), keyed by the same card ids.

use serde::Serialize;
use std::collections::BTreeMap;

use super::packing::UnknownCardType;
use crate::member::role_rank;

/// A width and height in grid cells.
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
pub struct GridSize {
    /// Width in columns.
    pub w: f64,
    /// Height in rows.
    pub h: f64,
}

const fn size(w: f64, h: f64) -> GridSize {
    GridSize { w, h }
}

/// The size fields shared by a card's layout, spelled out once per layout kind.
#[derive(Clone, Copy, Debug)]
struct Sizes {
    default: GridSize,
    default_sm: GridSize,
    min: GridSize,
    max: GridSize,
}

/// Every stat tile (progress rings and counts).
const STAT_TILE: Sizes = Sizes {
    default: size(3.0, 2.0),
    default_sm: size(2.0, 2.0),
    min: size(2.0, 2.0),
    max: size(6.0, 3.0),
};

/// A standard chart or list panel.
const PANEL: Sizes = Sizes {
    default: size(6.0, 3.0),
    default_sm: size(4.0, 3.0),
    min: size(4.0, 3.0),
    max: size(12.0, 6.0),
};

/// A panel that is taller by default.
const TALL_PANEL: Sizes = Sizes {
    default: size(6.0, 4.0),
    default_sm: size(4.0, 5.0),
    min: size(4.0, 3.0),
    max: size(12.0, 6.0),
};

/// One card's catalog entry. Serialized in the camelCase shape the TS `CardDef` uses.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CardDef {
    /// Card type id, as stored in the layout.
    #[serde(rename = "type")]
    pub card_type: &'static str,
    /// Picker label.
    pub label: &'static str,
    /// Picker group.
    pub group: &'static str,
    /// Data sources required to render this card.
    pub deps: &'static [&'static str],
    /// Compact stat tile layout (progress rings / counts).
    pub is_stat: bool,
    /// Lowest role that sees the card. Absent = all roles.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min_role: Option<&'static str>,
    /// Size on a wide (12-column) grid.
    pub default_size: GridSize,
    /// Size on a narrow (4-column) grid.
    pub default_size_sm: GridSize,
    /// Smallest size.
    pub min_size: GridSize,
    /// Largest size.
    pub max_size: GridSize,
    /// A list that takes the rows its content needs while viewed (DA-128).
    pub fit_content: bool,
}

const fn card(
    card_type: &'static str,
    label: &'static str,
    group: &'static str,
    deps: &'static [&'static str],
    sizes: Sizes,
) -> CardDef {
    CardDef {
        card_type,
        label,
        group,
        deps,
        is_stat: false,
        min_role: None,
        default_size: sizes.default,
        default_size_sm: sizes.default_sm,
        min_size: sizes.min,
        max_size: sizes.max,
        fit_content: false,
    }
}

const fn stat(
    card_type: &'static str,
    label: &'static str,
    group: &'static str,
    deps: &'static [&'static str],
) -> CardDef {
    CardDef {
        is_stat: true,
        ..card(card_type, label, group, deps, STAT_TILE)
    }
}

const fn with_fit(def: &CardDef) -> CardDef {
    CardDef {
        fit_content: true,
        ..*def
    }
}

const fn for_phd(def: &CardDef) -> CardDef {
    CardDef {
        min_role: Some("phd"),
        ..*def
    }
}

/// Every data source a card can depend on, in the TS order.
pub const ALL_DATA_SOURCES: [&str; 9] = [
    "papers",
    "sections",
    "milestones",
    "experiments",
    "log",
    "relations",
    "lists",
    "tags",
    "supervision",
];

/// The catalog, in picker order.
pub static CARD_REGISTRY: [CardDef; 11] = [
    stat(
        "reading-progress",
        "Reading progress",
        "Progress",
        &["papers"],
    ),
    stat(
        "report-progress",
        "Report progress",
        "Progress",
        &["sections"],
    ),
    stat(
        "plan-progress",
        "Plan progress",
        "Progress",
        &["milestones"],
    ),
    stat(
        "experiments-summary",
        "Experiments",
        "Progress",
        &["experiments"],
    ),
    card(
        "needs-attention",
        "Needs attention",
        "Activity",
        &["papers", "milestones", "experiments"],
        PANEL,
    ),
    // A log row (date over preview) is taller than a grid row.
    with_fit(&card(
        "recent-log",
        "Recent log",
        "Activity",
        &["log"],
        Sizes {
            default: size(6.0, 3.0),
            default_sm: size(4.0, 4.0),
            min: size(4.0, 3.0),
            max: size(12.0, 6.0),
        },
    )),
    stat(
        "library-snapshot",
        "Library snapshot",
        "Library",
        &["papers", "relations", "lists"],
    ),
    card(
        "top-tags",
        "Top tags",
        "Library",
        &["tags"],
        Sizes {
            default: size(4.0, 3.0),
            default_sm: size(4.0, 3.0),
            min: size(3.0, 3.0),
            max: size(12.0, 6.0),
        },
    ),
    with_fit(&for_phd(&card(
        "team-roster",
        "Team roster",
        "Team",
        &["supervision"],
        TALL_PANEL,
    ))),
    with_fit(&for_phd(&card(
        "team-attention",
        "Team attention",
        "Team",
        &["supervision"],
        PANEL,
    ))),
    for_phd(&card(
        "supervisee-snapshot",
        "Student snapshot",
        "Team",
        &["supervision"],
        TALL_PANEL,
    )),
];

/// The whole catalog.
#[must_use]
pub fn registry() -> &'static [CardDef] {
    &CARD_REGISTRY
}

/// The entry for `card_type`.
///
/// # Errors
///
/// Fails when `card_type` is not in the catalog.
pub fn card_def(card_type: &str) -> Result<&'static CardDef, UnknownCardType> {
    CARD_REGISTRY
        .iter()
        .find(|c| c.card_type == card_type)
        .ok_or_else(|| UnknownCardType(card_type.to_owned()))
}

/// The cards a viewer with `role` may add. No role counts as rank 0; a role the rank table does
/// not know sees only the cards with no role gate.
#[must_use]
pub fn cards_for_role(role: Option<&str>) -> Vec<&'static CardDef> {
    let rank = match role {
        Some(r) if !r.is_empty() => role_rank(r),
        _ => Some(0),
    };
    CARD_REGISTRY
        .iter()
        .filter(|c| match c.min_role {
            None => true,
            Some(min) => matches!((rank, role_rank(min)), (Some(r), Some(m)) if r >= m),
        })
        .collect()
}

/// Whether `card_type` is a stat tile.
///
/// # Errors
///
/// Fails when `card_type` is not in the catalog.
pub fn is_stat_card(card_type: &str) -> Result<bool, UnknownCardType> {
    card_def(card_type).map(|c| c.is_stat)
}

/// Union of the data sources the cards need, each once, in first-seen order.
///
/// # Errors
///
/// Fails when any card type is not in the catalog.
pub fn data_sources_for_card_types(
    card_types: &[&str],
) -> Result<Vec<&'static str>, UnknownCardType> {
    let mut out: Vec<&'static str> = Vec::new();
    for card_type in card_types {
        for &dep in card_def(card_type)?.deps {
            if !out.contains(&dep) {
                out.push(dep);
            }
        }
    }
    Ok(out)
}

/// The data sources to fetch: the visible cards' union, or every source when no card is
/// visible.
///
/// # Errors
///
/// Fails when any card type is not in the catalog.
pub fn resolve_deps(card_types: &[&str]) -> Result<Vec<&'static str>, UnknownCardType> {
    if card_types.is_empty() {
        Ok(ALL_DATA_SOURCES.to_vec())
    } else {
        data_sources_for_card_types(card_types)
    }
}

/// Largest height of each list card that fits its content, keyed by card type.
#[must_use]
pub fn fit_max_heights() -> BTreeMap<&'static str, f64> {
    CARD_REGISTRY
        .iter()
        .filter(|c| c.fit_content)
        .map(|c| (c.card_type, c.max_size.h))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    // it: "collects deps from visible cards only"
    fn collects_deps_from_visible_cards_only() {
        let deps = data_sources_for_card_types(&["reading-progress", "recent-log"]).unwrap();
        assert!(deps.contains(&"papers"));
        assert!(deps.contains(&"log"));
        assert!(!deps.contains(&"tags"));
    }

    #[test]
    // it: "the recent log card takes the height its rows need"
    fn recent_log_card_takes_the_height_its_rows_need() {
        assert!(card_def("recent-log").unwrap().fit_content);
    }

    #[test]
    // it: "only the list cards fit their content"
    fn only_the_list_cards_fit_their_content() {
        assert!(card_def("team-roster").unwrap().fit_content);
        assert!(card_def("team-attention").unwrap().fit_content);
        assert!(
            !card_def("reading-progress").unwrap().fit_content,
            "stat tiles keep their size"
        );
    }

    #[test]
    fn unknown_card_type_is_an_error() {
        assert_eq!(
            card_def("nope").unwrap_err(),
            UnknownCardType("nope".to_owned())
        );
        assert!(is_stat_card("nope").is_err());
        assert!(data_sources_for_card_types(&["nope"]).is_err());
    }

    #[test]
    fn stat_tiles_are_flagged() {
        assert!(is_stat_card("reading-progress").unwrap());
        assert!(!is_stat_card("needs-attention").unwrap());
    }

    #[test]
    fn no_visible_cards_fetch_every_source() {
        assert_eq!(resolve_deps(&[]).unwrap(), ALL_DATA_SOURCES.to_vec());
    }

    #[test]
    fn deps_are_unique_in_first_seen_order() {
        let deps = data_sources_for_card_types(&["needs-attention", "reading-progress"]).unwrap();
        assert_eq!(deps, vec!["papers", "milestones", "experiments"]);
    }

    #[test]
    fn team_cards_need_a_phd_or_higher() {
        let visible = |role: Option<&str>| {
            cards_for_role(role)
                .iter()
                .any(|c| c.card_type == "team-roster")
        };
        assert!(!visible(None));
        assert!(!visible(Some("masters")));
        assert!(visible(Some("phd")));
        assert!(visible(Some("professor")));
        assert!(
            !visible(Some("admin")),
            "an unknown role sees no gated card"
        );
        let ungated = cards_for_role(Some("admin"));
        assert!(ungated.iter().any(|c| c.card_type == "reading-progress"));
    }

    #[test]
    fn fit_max_heights_list_only_the_fitting_cards() {
        let heights = fit_max_heights();
        assert_eq!(heights.len(), 3);
        assert_eq!(heights["team-roster"], 6.0);
        assert_eq!(heights["recent-log"], 6.0);
    }
}
