//! Graph colours: the fixed palette, tag hues, and the graph-wide colour modes
//! (year, link count, community, custom groups). Ports
//! `apps/web/src/features/relations/domain/graph-palette.ts` and
//! `apps/web/src/features/relations/application/node-colouring.ts`.

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

use super::graph_settings::ColorGroup;
use super::node_colouring;
use crate::enum_label::enum_label;
use crate::reader_analysis::lines::js_trim;

/// Nodes the current mode says nothing about.
const UNCOLOURED: &str = "#c7c1b6";
/// The ramp as a CSS gradient, for the legend.
const RAMP_GRADIENT: &str = "linear-gradient(90deg, #e8d9b0, #8c928f, #2f4b6e)";
/// Distinct, print-safe hues for communities, biggest first.
const CLUSTER_PALETTE: [&str; 10] = [
    "#e4572e", "#2e86ab", "#f2a541", "#3bb273", "#7768ae", "#e15a97", "#1b998b", "#c1a33a",
    "#8a5a44", "#4f6d7a",
];
const NOTE_COLOR: &str = "#a0896a";
const PAPER_COLOR: &str = "#6d7fa3";
const WIKILINK_COLOR: &str = "#6f7f9c";
const REPORT_COLOR: &str = "#5e8f7b";
const EXPERIMENT_COLOR: &str = "#b06a4e";
const EXPERIMENT_LINK_COLOR: &str = "rgba(176, 106, 78, 0.55)";

/// Edge colour per relation type. Keys are the snake_case relation names.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct RelationColours {
    /// Cites.
    pub cites: String,
    /// Extends.
    pub extends: String,
    /// Contradicts.
    pub contradicts: String,
    /// Similar.
    pub similar: String,
    /// Builds on.
    pub builds_on: String,
    /// Uses method.
    pub uses_method: String,
}

/// Node colour per reading status. Keys are the status names.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ReadingStatusColours {
    /// To read.
    pub to_read: String,
    /// Eading.
    pub reading: String,
    /// Ead.
    pub read: String,
    /// Skimmed.
    pub skimmed: String,
}

/// Every fixed colour the citation graph draws (TS `GraphPalette`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct GraphPalette {
    /// Edge colour per relation type.
    pub relation: RelationColours,
    /// Node colour per reading status.
    pub reading_status: ReadingStatusColours,
    /// Note.
    pub note: String,
    /// Papers when the graph is coloured by kind.
    pub paper: String,
    /// Direct `[[wikilink]]` edges.
    pub wikilink: String,
    /// Report section nodes.
    pub report: String,
    /// Experiment nodes.
    pub experiment: String,
    /// Experiment to paper edges.
    pub experiment_link: String,
    /// Nodes the current mode says nothing about.
    pub uncoloured: String,
    /// The ramp as a CSS gradient.
    pub ramp_gradient: String,
    /// Community colours, biggest first.
    pub cluster: Vec<String>,
}

/// The whole fixed palette.
#[must_use]
pub fn graph_palette() -> GraphPalette {
    GraphPalette {
        relation: RelationColours {
            cites: "#8a857c".to_owned(),
            extends: "#7c9885".to_owned(),
            contradicts: "#c0573f".to_owned(),
            similar: "#c98a6b".to_owned(),
            builds_on: "#5a7d8c".to_owned(),
            uses_method: "#9a7bb0".to_owned(),
        },
        reading_status: ReadingStatusColours {
            to_read: "#b9b2a6".to_owned(),
            reading: "#7c9885".to_owned(),
            read: "#5a7d8c".to_owned(),
            skimmed: "#c98a6b".to_owned(),
        },
        note: NOTE_COLOR.to_owned(),
        paper: PAPER_COLOR.to_owned(),
        wikilink: WIKILINK_COLOR.to_owned(),
        report: REPORT_COLOR.to_owned(),
        experiment: EXPERIMENT_COLOR.to_owned(),
        experiment_link: EXPERIMENT_LINK_COLOR.to_owned(),
        uncoloured: UNCOLOURED.to_owned(),
        ramp_gradient: RAMP_GRADIENT.to_owned(),
        cluster: CLUSTER_PALETTE.iter().map(|c| (*c).to_owned()).collect(),
    }
}

/// The hue for a tag: a string hash over 360 degrees at fixed saturation and
/// lightness. Hashes UTF-16 code units, as the JS original does.
#[must_use]
pub fn tag_colour(tag: &str) -> String {
    let mut h: u32 = 0;
    for unit in tag.encode_utf16() {
        h = (h * 31 + u32::from(unit)) % 360;
    }
    format!("hsl({h}, 55%, 62%)")
}

/// A community's colour; past the palette, communities share the neutral grey.
#[must_use]
pub fn cluster_colour(index: Option<usize>) -> String {
    index
        .and_then(|i| CLUSTER_PALETTE.get(i))
        .map_or_else(|| UNCOLOURED.to_owned(), |c| (*c).to_owned())
}

/// What a group rule can test on a node.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GroupSubject {
    /// Title.
    pub title: String,
    /// Tags.
    pub tags: Vec<String>,
    /// Empty when the node has no status.
    pub status: String,
    /// Names of the lists the paper is in.
    pub lists: Vec<String>,
}

/// A paper as the custom-colour rules read it.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupPaper {
    /// Id.
    pub id: String,
    /// Title.
    pub title: String,
    #[serde(default)]
    /// Status.
    pub status: String,
    #[serde(default)]
    /// Tags.
    pub tags: Vec<String>,
}

/// A reading list as the custom-colour rules read it.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupList {
    /// Id.
    pub id: String,
    /// Name.
    pub name: String,
}

/// A node's fields for recolouring. Fields the modes do not read are ignored.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColourableNode {
    /// Id.
    pub id: String,
    /// Label.
    pub label: String,
    #[serde(default)]
    /// Paper id.
    pub paper_id: Option<String>,
    #[serde(default)]
    /// Year.
    pub year: Option<f64>,
    #[serde(default)]
    /// Tag name.
    pub tag_name: Option<String>,
}

/// One graph link, by its endpoint ids.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkEnds {
    /// Source.
    pub source: String,
    /// Target.
    pub target: String,
}

/// The lookups recolouring needs beyond the nodes and links.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecolourContext {
    /// Papers by id.
    pub papers: HashMap<String, GroupPaper>,
    /// Hashtags per note id.
    #[serde(default)]
    pub note_tags: HashMap<String, Vec<String>>,
    /// Paper ids per list id.
    #[serde(default)]
    pub membership: HashMap<String, HashSet<String>>,
    #[serde(default)]
    /// Lists.
    pub lists: Vec<GroupList>,
}

/// Whether a group rule matches a subject. `tag:`, `list:`, `status:` and
/// `title:` name a field; anything else matches the title.
fn matches(query: &str, s: &GroupSubject) -> bool {
    let q = js_trim(query).to_lowercase();
    if q.is_empty() {
        return false;
    }
    let (field, value) = match q.find(':').filter(|&i| i > 0) {
        Some(i) => {
            let rest = js_trim(&q[i + 1..]);
            (&q[..i], rest.strip_prefix('#').unwrap_or(rest))
        }
        None => ("", q.as_str()),
    };
    match field {
        "tag" => s.tags.iter().any(|t| t.to_lowercase() == value),
        "list" => s.lists.iter().any(|l| l.to_lowercase() == value),
        // "status:to read", "status:to_read" and the label "status:done" all match.
        "status" => {
            s.status == value.replace(' ', "_")
                || enum_label("paperStatus", &s.status).to_lowercase() == value
        }
        "title" => s.title.to_lowercase().contains(value),
        _ => s.title.to_lowercase().contains(&q),
    }
}

/// The colour of the first group whose rule matches, or none.
#[must_use]
pub fn group_colour(groups: &[ColorGroup], s: &GroupSubject) -> Option<String> {
    groups
        .iter()
        .find(|g| matches(&g.query, s))
        .map(|g| g.color.clone())
}

/// A paper as a group rule sees it.
fn paper_subject(p: &GroupPaper, ctx: &RecolourContext) -> GroupSubject {
    GroupSubject {
        title: p.title.clone(),
        tags: p.tags.clone(),
        status: p.status.clone(),
        lists: ctx
            .lists
            .iter()
            .filter(|l| {
                ctx.membership
                    .get(&l.id)
                    .is_some_and(|set| set.contains(&p.id))
            })
            .map(|l| l.name.clone())
            .collect(),
    }
}

/// What a node looks like to a group rule: its paper if it has one, else its tag,
/// else its note tags.
fn subject_of(n: &ColourableNode, ctx: &RecolourContext) -> GroupSubject {
    let paper = n
        .paper_id
        .as_deref()
        .filter(|id| !id.is_empty())
        .and_then(|id| ctx.papers.get(id));
    if let Some(p) = paper {
        return paper_subject(p, ctx);
    }
    if let Some(tag) = n.tag_name.as_deref().filter(|t| !t.is_empty()) {
        return GroupSubject {
            title: n.label.clone(),
            tags: vec![tag.to_owned()],
            status: String::new(),
            lists: Vec::new(),
        };
    }
    GroupSubject {
        title: n.label.clone(),
        tags: ctx.note_tags.get(&n.id).cloned().unwrap_or_default(),
        status: String::new(),
        lists: Vec::new(),
    }
}

/// Colours for the graph-wide `color_by` modes, one per node in `nodes` order, or
/// `None` when the mode leaves node colours as built. Every node takes the mode's
/// colour, and a node the mode says nothing about is greyed, so colour never
/// means two things at once.
#[must_use]
pub fn recolour_nodes(
    nodes: &[ColourableNode],
    links: &[LinkEnds],
    color_by: &str,
    groups: &[ColorGroup],
    ctx: &RecolourContext,
) -> Option<Vec<String>> {
    match color_by {
        "year" => {
            let years: Vec<(String, f64)> = nodes
                .iter()
                .filter_map(|n| n.year.map(|y| (n.id.clone(), y)))
                .collect();
            let colours: HashMap<String, String> =
                node_colouring::year_colours(&years).into_iter().collect();
            Some(by_id(nodes, &colours))
        }
        "degree" => {
            let mut degree: HashMap<String, f64> =
                nodes.iter().map(|n| (n.id.clone(), 0.0)).collect();
            for l in links {
                *degree.entry(l.source.clone()).or_insert(0.0) += 1.0;
                *degree.entry(l.target.clone()).or_insert(0.0) += 1.0;
            }
            let counts: Vec<(String, f64)> = degree.into_iter().collect();
            let colours: HashMap<String, String> = node_colouring::degree_colours(&counts)
                .into_iter()
                .collect();
            Some(by_id(nodes, &colours))
        }
        "cluster" => {
            let ids: Vec<String> = nodes.iter().map(|n| n.id.clone()).collect();
            let edges: Vec<(String, String)> = links
                .iter()
                .map(|l| (l.source.clone(), l.target.clone()))
                .collect();
            let ranks: HashMap<String, u32> = node_colouring::communities(&ids, &edges)
                .into_iter()
                .collect();
            Some(
                nodes
                    .iter()
                    .map(|n| {
                        cluster_colour(ranks.get(&n.id).and_then(|r| usize::try_from(*r).ok()))
                    })
                    .collect(),
            )
        }
        "groups" => Some(
            nodes
                .iter()
                .map(|n| {
                    group_colour(groups, &subject_of(n, ctx))
                        .unwrap_or_else(|| UNCOLOURED.to_owned())
                })
                .collect(),
        ),
        _ => None,
    }
}

/// Each node's colour from a map by id; nodes the map leaves out are greyed.
fn by_id(nodes: &[ColourableNode], colours: &HashMap<String, String>) -> Vec<String> {
    nodes
        .iter()
        .map(|n| {
            colours
                .get(&n.id)
                .cloned()
                .unwrap_or_else(|| UNCOLOURED.to_owned())
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn paper(id: &str, status: &str, tags: &[&str]) -> GroupPaper {
        GroupPaper {
            id: id.to_owned(),
            title: format!("Paper {id}"),
            status: status.to_owned(),
            tags: tags.iter().map(|t| (*t).to_owned()).collect(),
        }
    }

    fn node(id: &str, year: Option<f64>) -> ColourableNode {
        ColourableNode {
            id: id.to_owned(),
            label: format!("Paper {id}"),
            paper_id: Some(id.to_owned()),
            year,
            tag_name: None,
        }
    }

    fn link(source: &str, target: &str) -> LinkEnds {
        LinkEnds {
            source: source.to_owned(),
            target: target.to_owned(),
        }
    }

    fn ctx(papers: Vec<GroupPaper>) -> RecolourContext {
        RecolourContext {
            papers: papers.into_iter().map(|p| (p.id.clone(), p)).collect(),
            note_tags: HashMap::new(),
            membership: HashMap::new(),
            lists: Vec::new(),
        }
    }

    #[test]
    fn tag_colour_hashes_like_js() {
        assert_eq!(tag_colour("a"), "hsl(97, 55%, 62%)");
        assert_eq!(tag_colour("ml"), tag_colour("ml"));
        assert_ne!(tag_colour("ml"), tag_colour("nlp"));
    }

    #[test]
    fn palette_keys_match_the_ts_names() {
        let p = graph_palette();
        assert_eq!(p.relation.builds_on, "#5a7d8c");
        assert_eq!(p.reading_status.to_read, "#b9b2a6");
        assert_eq!(p.cluster.len(), 10);
    }

    #[test]
    fn cluster_colour_greys_past_the_palette() {
        assert_eq!(cluster_colour(Some(0)), CLUSTER_PALETTE[0]);
        assert_eq!(cluster_colour(Some(10)), UNCOLOURED);
        assert_eq!(cluster_colour(None), UNCOLOURED);
    }

    #[test]
    fn group_rules_match_tags_lists_status_and_title() {
        let mut c = ctx(vec![paper("b", "to_read", &["ml"])]);
        c.lists = vec![GroupList {
            id: "L1".to_owned(),
            name: "Thesis".to_owned(),
        }];
        c.membership = HashMap::from([("L1".to_owned(), HashSet::from(["b".to_owned()]))]);
        let subject = paper_subject(&c.papers["b"], &c);
        let hits = |q: &str| {
            group_colour(
                &[ColorGroup {
                    query: q.to_owned(),
                    color: "#123456".to_owned(),
                }],
                &subject,
            )
            .is_some()
        };
        assert!(hits("tag:#ML"));
        assert!(hits("list:thesis"));
        assert!(hits("status:to read"));
        assert!(hits("status:to_read"));
        assert!(hits("paper b"));
        assert!(!hits("tag:nlp"));
    }

    #[test]
    fn year_mode_ramps_and_greys_undated() {
        let nodes = vec![
            node("a", Some(2001.0)),
            node("b", Some(2021.0)),
            node("c", None),
        ];
        let out =
            recolour_nodes(&nodes, &[], "year", &[], &ctx(Vec::new())).expect("year recolours");
        assert_eq!(out[0], node_colouring::ramp_colour(0.0));
        assert_eq!(out[1], node_colouring::ramp_colour(1.0));
        assert_eq!(out[2], UNCOLOURED);
    }

    #[test]
    fn degree_mode_gives_the_hub_a_different_colour() {
        let nodes = vec![node("a", None), node("b", None), node("c", None)];
        let links = vec![link("a", "b"), link("a", "c")];
        let out = recolour_nodes(&nodes, &links, "degree", &[], &ctx(Vec::new()))
            .expect("degree recolours");
        assert_ne!(out[0], out[1]);
        assert_eq!(out[1], out[2]);
    }

    #[test]
    fn cluster_mode_colours_a_chain_alike_and_greys_lone_nodes() {
        let nodes = vec![
            node("a", None),
            node("b", None),
            node("c", None),
            node("lone", None),
        ];
        let links = vec![link("a", "b"), link("b", "c")];
        let out = recolour_nodes(&nodes, &links, "cluster", &[], &ctx(Vec::new()))
            .expect("cluster recolours");
        assert_eq!(out[0], CLUSTER_PALETTE[0]);
        assert_eq!(out[2], CLUSTER_PALETTE[0]);
        assert_eq!(out[3], UNCOLOURED);
    }

    #[test]
    fn groups_mode_applies_rules_and_greys_the_rest() {
        let nodes = vec![node("a", None), node("b", None)];
        let groups = vec![ColorGroup {
            query: "paper b".to_owned(),
            color: "#123456".to_owned(),
        }];
        let c = ctx(vec![paper("a", "to_read", &[]), paper("b", "to_read", &[])]);
        let out = recolour_nodes(&nodes, &[], "groups", &groups, &c).expect("groups recolours");
        assert_eq!(out[0], UNCOLOURED);
        assert_eq!(out[1], "#123456");
    }

    #[test]
    fn other_modes_leave_colours_as_built() {
        let nodes = vec![node("a", None)];
        assert!(recolour_nodes(&nodes, &[], "status", &[], &ctx(Vec::new())).is_none());
    }
}
