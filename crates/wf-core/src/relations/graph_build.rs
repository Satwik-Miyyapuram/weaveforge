//! Builds the citation graph for one view: papers, notes, report sections, runs,
//! tags and reading lists, joined by relation, tag, list, wikilink and run edges.
//! Ports `buildGraphData`, `paperColor` and `isOrphan` from
//! `apps/web/src/features/relations/application/build-graph-data.ts`.

use std::collections::{BTreeMap, HashMap, HashSet};

use serde::{Deserialize, Serialize};

use super::graph_colour::{
    self, ColourableNode, GraphPalette, GroupList, GroupPaper, LinkEnds, RecolourContext,
};
use super::graph_settings::{
    ColorBy, GraphViewSettings, GroupBy, RelationType, effective_relation_types,
    show_concept_edges, show_relation_edges,
};
use super::graph_tags::{TaggedNote, note_tags};
use super::paper_relation::{PaperRelation, RelationSource};
use crate::reading_lists::reading_list::display_colour;
use crate::vault::page::{extract_wikilinks, normalize_title_key};

/// Edge colour between tags that share an item.
const CONCEPT_EDGE_COLOR: &str = "rgba(140, 133, 124, 0.35)";

/// A paper as the graph reads it.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct GraphBuildPaper {
    /// Id.
    pub id: String,
    /// Title.
    pub title: String,
    /// Publication year, when set.
    #[serde(default)]
    #[cfg_attr(feature = "specta", specta(type = Option<u32>, optional))]
    pub year: Option<f64>,
    /// The reader's own summary; its `[[wikilinks]]` draw edges.
    #[serde(default)]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub summary: Option<String>,
    /// Reading status, as the palette keys it.
    #[serde(default)]
    pub status: String,
    /// Keyword tags.
    #[serde(default)]
    pub tags: Vec<String>,
}

/// A vault note as the graph reads it.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct GraphBuildNote {
    /// Id.
    pub id: String,
    /// Title; its hashtags count as tags.
    pub title: String,
    /// Body; its hashtags and `[[wikilinks]]` count.
    #[serde(default)]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub body: Option<String>,
}

/// A report section as the graph reads it.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct GraphBuildSection {
    /// Id.
    pub id: String,
    /// Title.
    pub title: String,
    /// Section notes; their `[[wikilinks]]` draw edges.
    #[serde(default)]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub notes: Option<String>,
}

/// A run as the graph reads it.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct GraphBuildExperiment {
    /// Id.
    pub id: String,
    /// Name.
    pub name: String,
    /// Run status.
    pub status: String,
    /// The paper this run tests.
    #[serde(default)]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub related_paper: Option<String>,
    /// Hypothesis and result note; its `[[wikilinks]]` draw edges.
    #[serde(default)]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub note: Option<String>,
}

/// A reading list as the graph reads it.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct GraphBuildList {
    /// Id.
    pub id: String,
    /// Name.
    pub name: String,
    /// Own colour, when set.
    #[serde(default)]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub color: Option<String>,
}

/// Everything one graph view is built from.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct GraphBuildInput {
    /// Papers.
    #[serde(default)]
    pub papers: Vec<GraphBuildPaper>,
    /// Paper relations.
    #[serde(default)]
    pub relations: Vec<PaperRelation>,
    /// View settings.
    pub settings: GraphViewSettings,
    /// Member ids (papers and notes) per list id, in order.
    #[serde(default)]
    pub membership: HashMap<String, Vec<String>>,
    /// Reading lists.
    #[serde(default)]
    pub lists: Vec<GraphBuildList>,
    /// Vault notes.
    #[serde(default)]
    pub notes: Vec<GraphBuildNote>,
    /// Report sections.
    #[serde(default)]
    pub sections: Vec<GraphBuildSection>,
    /// Runs.
    #[serde(default)]
    pub experiments: Vec<GraphBuildExperiment>,
}

/// What a node stands for.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub enum NodeKind {
    /// A paper.
    Paper,
    /// A tag or a list.
    Tag,
    /// A vault note.
    Note,
    /// A report section.
    Report,
    /// A run.
    Experiment,
}

/// What a link stands for.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub enum LinkKind {
    /// A paper relation.
    Rel,
    /// An item to a tag or list.
    Tag,
    /// Two tags that share an item.
    Concept,
    /// A `[[wikilink]]`.
    Wikilink,
    /// A run to its paper.
    Experiment,
}

/// One node of the graph.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct GraphNode {
    /// Id, unique across kinds.
    pub id: String,
    /// What the node stands for.
    pub kind: NodeKind,
    /// Text shown for the node.
    pub label: String,
    /// Draw size.
    pub val: f64,
    /// Fill colour.
    pub color: String,
    /// The paper, for a paper node.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub paper_id: Option<String>,
    /// Publication year, for a paper node.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(type = Option<u32>, optional))]
    pub year: Option<f64>,
    /// The note, for a note node.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub note_id: Option<String>,
    /// The section, for a report node.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub section_id: Option<String>,
    /// The tag or list name, for a tag node.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub tag_name: Option<String>,
    /// The run, for an experiment node.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub experiment_id: Option<String>,
    /// The run's status, for an experiment node.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub experiment_status: Option<String>,
}

/// One edge of the graph.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct GraphLink {
    /// Id, unique across links.
    pub id: String,
    /// Source node id.
    pub source: String,
    /// Target node id.
    pub target: String,
    /// Stroke colour.
    pub color: String,
    /// Stroke width.
    pub width: f64,
    /// What the edge stands for.
    pub kind: LinkKind,
    /// The relation type, for a relation edge.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub relation: Option<RelationType>,
    /// The relation's id, for a relation edge.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub relation_id: Option<String>,
    /// Whether a person or the system made the relation.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub source_kind: Option<RelationSource>,
    /// Drawn dashed, for an automatic relation with auto styling on.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub dashed: Option<bool>,
}

/// The nodes and links of one graph view.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct GraphData {
    /// Nodes, in draw order.
    pub nodes: Vec<GraphNode>,
    /// Links whose both ends are nodes.
    pub links: Vec<GraphLink>,
}

/// A graph view and its lookups.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct GraphBuildResult {
    /// Nodes and links.
    pub data: GraphData,
    /// Node id to the ids it is linked to.
    pub neighbors: BTreeMap<String, Vec<String>>,
    /// Tag to the papers that carry it or sit in a list of that name.
    pub tag_to_papers: BTreeMap<String, Vec<String>>,
    /// Tag to the notes that carry it or sit in a list of that name.
    pub tag_to_notes: BTreeMap<String, Vec<String>>,
}

/// Counts per key, remembering the order keys were first seen, as a JS `Map` does.
#[derive(Default)]
struct Tally {
    order: Vec<String>,
    counts: HashMap<String, usize>,
}

impl Tally {
    fn add(&mut self, key: &str) {
        let count = self.counts.entry(key.to_owned()).or_insert(0);
        if *count == 0 {
            self.order.push(key.to_owned());
        }
        *count += 1;
    }

    fn get(&self, key: &str) -> usize {
        self.counts.get(key).copied().unwrap_or(0)
    }
}

/// Degree per node id, and the part of it that comes from relations.
#[derive(Default)]
struct Degrees {
    all: Tally,
    rel: Tally,
}

impl Degrees {
    fn bump(&mut self, id: &str) {
        self.all.add(id);
    }

    fn bump_rel(&mut self, id: &str) {
        self.all.add(id);
        self.rel.add(id);
    }

    fn of(&self, id: &str) -> f64 {
        self.all.get(id) as f64
    }
}

/// A paper with no relation edge and no tag or list. Ports `isOrphan`.
#[must_use]
pub fn is_orphan(rel_degree: usize, tag_count: usize) -> bool {
    rel_degree == 0 && tag_count == 0
}

/// Stable name of a colour mode, as `recolour_nodes` takes it.
fn color_by_name(color_by: ColorBy) -> &'static str {
    match color_by {
        ColorBy::Status => "status",
        ColorBy::Tag => "tag",
        ColorBy::List => "list",
        ColorBy::Type => "type",
        ColorBy::Year => "year",
        ColorBy::Degree => "degree",
        ColorBy::Cluster => "cluster",
        ColorBy::Groups => "groups",
    }
}

fn relation_colour(palette: &GraphPalette, relation: RelationType) -> String {
    let c = &palette.relation;
    match relation {
        RelationType::Cites => c.cites.clone(),
        RelationType::Extends => c.extends.clone(),
        RelationType::Contradicts => c.contradicts.clone(),
        RelationType::Similar => c.similar.clone(),
        RelationType::BuildsOn => c.builds_on.clone(),
        RelationType::UsesMethod => c.uses_method.clone(),
    }
}

fn reading_status_colour(palette: &GraphPalette, status: &str) -> String {
    let c = &palette.reading_status;
    match status {
        "reading" => c.reading.clone(),
        "read" => c.read.clone(),
        "skimmed" => c.skimmed.clone(),
        _ => c.to_read.clone(),
    }
}

/// The ids a list holds, in insertion order.
fn members_of<'a>(input: &'a GraphBuildInput, list_id: &str) -> &'a [String] {
    match input.membership.get(list_id) {
        Some(ids) => ids.as_slice(),
        None => &[],
    }
}

fn in_any_list(input: &GraphBuildInput, id: &str) -> bool {
    input
        .lists
        .iter()
        .any(|l| members_of(input, &l.id).iter().any(|m| m.as_str() == id))
}

/// Paper node colour for the active colour and group modes. Ports `paperColor`.
fn paper_colour(
    p: &GraphBuildPaper,
    settings: &GraphViewSettings,
    input: &GraphBuildInput,
    palette: &GraphPalette,
) -> String {
    if settings.color_by == ColorBy::Type {
        return palette.paper.clone();
    }
    if settings.color_by == ColorBy::Tag {
        return match p.tags.first().filter(|t| !t.is_empty()) {
            Some(tag) => graph_colour::tag_colour(tag),
            None => palette.reading_status.to_read.clone(),
        };
    }
    if settings.color_by == ColorBy::List || settings.group_by == GroupBy::List {
        let list = input
            .lists
            .iter()
            .find(|l| members_of(input, &l.id).iter().any(|m| m == &p.id));
        return match list {
            Some(l) => display_colour(&l.name, l.color.as_deref()),
            None => reading_status_colour(palette, &p.status),
        };
    }
    reading_status_colour(palette, &p.status)
}

fn tags_of_note(n: &GraphBuildNote) -> Vec<String> {
    note_tags(&TaggedNote {
        title: n.title.clone(),
        body: n.body.clone().unwrap_or_default(),
    })
}

fn union_ordered(existing: &[String], extra: &[&String]) -> Vec<String> {
    let mut seen: HashSet<&str> = HashSet::new();
    let mut out = Vec::new();
    for id in existing.iter().chain(extra.iter().copied()) {
        if seen.insert(id.as_str()) {
            out.push(id.clone());
        }
    }
    out
}

fn link(
    id: String,
    source: &str,
    target: &str,
    color: String,
    width: f64,
    kind: LinkKind,
) -> GraphLink {
    GraphLink {
        id,
        source: source.to_owned(),
        target: target.to_owned(),
        color,
        width,
        kind,
        relation: None,
        relation_id: None,
        source_kind: None,
        dashed: None,
    }
}

fn node(id: String, kind: NodeKind, label: String, val: f64, color: String) -> GraphNode {
    GraphNode {
        id,
        kind,
        label,
        val,
        color,
        paper_id: None,
        year: None,
        note_id: None,
        section_id: None,
        tag_name: None,
        experiment_id: None,
        experiment_status: None,
    }
}

/// Builds one graph view. Ports `buildGraphData`.
#[must_use]
#[allow(clippy::too_many_lines)]
pub fn build_graph_data(input: &GraphBuildInput) -> GraphBuildResult {
    let settings = &input.settings;
    let palette = graph_colour::graph_palette();
    let lt = settings.link_thickness;
    let ns = settings.node_size;
    let include_lists = settings.include_lists_as_concepts;
    let show_concepts = show_concept_edges(settings);
    let allowed = effective_relation_types(settings);

    let paper_ids: HashSet<&str> = input.papers.iter().map(|p| p.id.as_str()).collect();
    let note_ids: HashSet<&str> = input.notes.iter().map(|n| n.id.as_str()).collect();
    let note_tag_lists: Vec<Vec<String>> = input.notes.iter().map(tags_of_note).collect();

    let mut links: Vec<GraphLink> = Vec::new();
    let mut degree = Degrees::default();

    if show_relation_edges(settings) {
        for e in &input.relations {
            if !paper_ids.contains(e.from_paper.as_str())
                || !paper_ids.contains(e.to_paper.as_str())
            {
                continue;
            }
            if !allowed.contains(&e.relation) {
                continue;
            }
            let auto = e.source == RelationSource::Auto;
            links.push(GraphLink {
                relation: Some(e.relation),
                relation_id: Some(e.id.clone()),
                source_kind: Some(e.source),
                dashed: Some(settings.show_auto_style && auto),
                width: (if auto { 0.8 } else { 1.6 }) * lt,
                ..link(
                    e.id.clone(),
                    &e.from_paper,
                    &e.to_paper,
                    relation_colour(&palette, e.relation),
                    0.0,
                    LinkKind::Rel,
                )
            });
            degree.bump_rel(&e.from_paper);
            degree.bump_rel(&e.to_paper);
        }
    }

    let mut tag_use = Tally::default();
    let mut paper_tag_count = Tally::default();
    let mut note_tag_count = Tally::default();

    if show_concepts {
        for p in &input.papers {
            for t in &p.tags {
                tag_use.add(t);
                paper_tag_count.add(&p.id);
                let tag_id = format!("tag:{t}");
                links.push(link(
                    format!("pt:{}:{t}", p.id),
                    &p.id,
                    &tag_id,
                    graph_colour::tag_colour(t),
                    0.6 * lt,
                    LinkKind::Tag,
                ));
                degree.bump(&p.id);
                degree.bump(&tag_id);
            }
        }
        for (n, tags) in input.notes.iter().zip(&note_tag_lists) {
            for t in tags {
                tag_use.add(t);
                note_tag_count.add(&n.id);
                let tag_id = format!("tag:{t}");
                links.push(link(
                    format!("nt:{}:{t}", n.id),
                    &n.id,
                    &tag_id,
                    graph_colour::tag_colour(t),
                    0.6 * lt,
                    LinkKind::Tag,
                ));
                degree.bump(&n.id);
                degree.bump(&tag_id);
            }
        }
        if include_lists {
            for l in &input.lists {
                let members = members_of(input, &l.id);
                let member_papers: Vec<&String> = members
                    .iter()
                    .filter(|m| paper_ids.contains(m.as_str()))
                    .collect();
                let member_notes: Vec<&String> = members
                    .iter()
                    .filter(|m| note_ids.contains(m.as_str()))
                    .collect();
                if member_papers.len() + member_notes.len() == 0 {
                    continue;
                }
                let list_node_id = format!("list:{}", l.id);
                let l_colour = display_colour(&l.name, l.color.as_deref());
                for pid in member_papers {
                    paper_tag_count.add(pid);
                    links.push(link(
                        format!("pl:{pid}:{}", l.id),
                        pid,
                        &list_node_id,
                        l_colour.clone(),
                        0.6 * lt,
                        LinkKind::Tag,
                    ));
                    degree.bump(pid);
                    degree.bump(&list_node_id);
                }
                for nid in member_notes {
                    note_tag_count.add(nid);
                    links.push(link(
                        format!("nl:{nid}:{}", l.id),
                        nid,
                        &list_node_id,
                        l_colour.clone(),
                        0.6 * lt,
                        LinkKind::Tag,
                    ));
                    degree.bump(nid);
                    degree.bump(&list_node_id);
                }
            }
        }
    }

    let min_deg = settings.min_concept_degree.max(1.0);
    let visible: Vec<String> = tag_use
        .order
        .iter()
        .filter(|t| (tag_use.get(t) as f64) >= min_deg)
        .cloned()
        .collect();
    let visible_set: HashSet<&str> = visible.iter().map(String::as_str).collect();

    if settings.show_concept_cooccurrence {
        let mut items_by_tag: HashMap<&str, Vec<&str>> = HashMap::new();
        for p in &input.papers {
            for t in &p.tags {
                if visible_set.contains(t.as_str()) {
                    items_by_tag
                        .entry(t.as_str())
                        .or_default()
                        .push(p.id.as_str());
                }
            }
        }
        for (n, tags) in input.notes.iter().zip(&note_tag_lists) {
            for t in tags {
                if visible_set.contains(t.as_str()) {
                    items_by_tag
                        .entry(t.as_str())
                        .or_default()
                        .push(n.id.as_str());
                }
            }
        }
        let item_sets: HashMap<&str, HashSet<&str>> = visible
            .iter()
            .map(|t| {
                let items = items_by_tag
                    .get(t.as_str())
                    .map(|v| v.iter().copied().collect::<HashSet<&str>>())
                    .unwrap_or_default();
                (t.as_str(), items)
            })
            .collect();
        for (i, a) in visible.iter().enumerate() {
            let set_a = &item_sets[a.as_str()];
            for b in &visible[i + 1..] {
                let shared = items_by_tag
                    .get(b.as_str())
                    .is_some_and(|ids| ids.iter().any(|id| set_a.contains(id)));
                if !shared {
                    continue;
                }
                links.push(link(
                    format!("cc:{a}:{b}"),
                    &format!("tag:{a}"),
                    &format!("tag:{b}"),
                    CONCEPT_EDGE_COLOR.to_owned(),
                    0.4,
                    LinkKind::Concept,
                ));
                degree.bump(&format!("tag:{a}"));
                degree.bump(&format!("tag:{b}"));
            }
        }
    }

    let mut tag_to_papers: BTreeMap<String, Vec<String>> = BTreeMap::new();
    let mut tag_to_notes: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for p in &input.papers {
        for t in &p.tags {
            tag_to_papers
                .entry(t.clone())
                .or_default()
                .push(p.id.clone());
        }
    }
    for (n, tags) in input.notes.iter().zip(&note_tag_lists) {
        for t in tags {
            tag_to_notes
                .entry(t.clone())
                .or_default()
                .push(n.id.clone());
        }
    }
    if include_lists {
        for l in &input.lists {
            let members = members_of(input, &l.id);
            let member_papers: Vec<&String> = members
                .iter()
                .filter(|m| paper_ids.contains(m.as_str()))
                .collect();
            let member_notes: Vec<&String> = members
                .iter()
                .filter(|m| note_ids.contains(m.as_str()))
                .collect();
            if !member_papers.is_empty() {
                let existing = tag_to_papers.get(&l.name).cloned().unwrap_or_default();
                let _ =
                    tag_to_papers.insert(l.name.clone(), union_ordered(&existing, &member_papers));
            }
            if !member_notes.is_empty() {
                let existing = tag_to_notes.get(&l.name).cloned().unwrap_or_default();
                let _ =
                    tag_to_notes.insert(l.name.clone(), union_ordered(&existing, &member_notes));
            }
        }
    }

    // Direct [[wikilink]] edges from notes, paper summaries, report sections and run notes.
    let mut wiki_linked: HashSet<String> = HashSet::new();
    {
        let note_by_title: HashMap<String, &str> = input
            .notes
            .iter()
            .map(|n| (normalize_title_key(&n.title), n.id.as_str()))
            .collect();
        let paper_by_title: HashMap<String, &str> = input
            .papers
            .iter()
            .map(|p| (normalize_title_key(&p.title), p.id.as_str()))
            .collect();
        let section_by_title: HashMap<String, &str> = input
            .sections
            .iter()
            .map(|s| (normalize_title_key(&s.title), s.id.as_str()))
            .collect();
        let resolve = |key: &str, source: &str| -> Option<String> {
            if let Some(id) = note_by_title.get(key).filter(|id| **id != source) {
                return Some((*id).to_owned());
            }
            if let Some(id) = paper_by_title.get(key).filter(|id| **id != source) {
                return Some((*id).to_owned());
            }
            if let Some(id) = section_by_title.get(key).filter(|id| **id != source) {
                return Some((*id).to_owned());
            }
            None
        };

        let mut sources: Vec<(&str, &str)> = Vec::new();
        for n in &input.notes {
            if let Some(body) = n.body.as_deref().filter(|b| !b.is_empty()) {
                sources.push((n.id.as_str(), body));
            }
        }
        for p in &input.papers {
            if let Some(summary) = p.summary.as_deref().filter(|b| !b.is_empty()) {
                sources.push((p.id.as_str(), summary));
            }
        }
        for s in &input.sections {
            if let Some(notes) = s.notes.as_deref().filter(|b| !b.is_empty()) {
                sources.push((s.id.as_str(), notes));
            }
        }
        for e in &input.experiments {
            if let Some(note) = e.note.as_deref().filter(|b| !b.is_empty()) {
                sources.push((e.id.as_str(), note));
            }
        }

        let mut seen: HashSet<String> = HashSet::new();
        for (source_id, body) in sources {
            for r in extract_wikilinks(body) {
                let key = normalize_title_key(&r.target);
                if key.is_empty() {
                    continue;
                }
                let Some(target_id) = resolve(&key, source_id) else {
                    continue;
                };
                let id = format!("wl:{source_id}:{target_id}");
                if !seen.insert(id.clone()) {
                    continue;
                }
                links.push(link(
                    id,
                    source_id,
                    &target_id,
                    palette.wikilink.clone(),
                    1.2 * lt,
                    LinkKind::Wikilink,
                ));
                degree.bump(source_id);
                degree.bump(&target_id);
                let _ = wiki_linked.insert(source_id.to_owned());
                let _ = wiki_linked.insert(target_id);
            }
        }
    }

    let mut nodes: Vec<GraphNode> = Vec::new();

    for p in &input.papers {
        let tags_on_paper = p
            .tags
            .iter()
            .filter(|t| !show_concepts || visible_set.contains(t.as_str()))
            .count();
        let in_visible_list = show_concepts && include_lists && in_any_list(input, &p.id);
        let orphan = is_orphan(degree.rel.get(&p.id), paper_tag_count.get(&p.id));
        if settings.hide_orphans
            && orphan
            && tags_on_paper == 0
            && !in_visible_list
            && !wiki_linked.contains(&p.id)
        {
            continue;
        }
        nodes.push(GraphNode {
            paper_id: Some(p.id.clone()),
            year: p.year.filter(|y| y.is_finite()),
            ..node(
                p.id.clone(),
                NodeKind::Paper,
                p.title.clone(),
                (2.0 + degree.of(&p.id).sqrt() * 2.0) * ns,
                paper_colour(p, settings, input, &palette),
            )
        });
    }

    for (n, tags) in input.notes.iter().zip(&note_tag_lists) {
        let tags_on_note = tags
            .iter()
            .filter(|t| !show_concepts || visible_set.contains(t.as_str()))
            .count();
        let in_visible_list = show_concepts && include_lists && in_any_list(input, &n.id);
        if settings.hide_orphans
            && note_tag_count.get(&n.id) == 0
            && tags_on_note == 0
            && !in_visible_list
            && !wiki_linked.contains(&n.id)
        {
            continue;
        }
        nodes.push(GraphNode {
            note_id: Some(n.id.clone()),
            ..node(
                n.id.clone(),
                NodeKind::Note,
                n.title.clone(),
                (1.8 + degree.of(&n.id).sqrt() * 1.8) * ns,
                palette.note.clone(),
            )
        });
    }

    for s in &input.sections {
        if settings.hide_orphans && !wiki_linked.contains(&s.id) {
            continue;
        }
        nodes.push(GraphNode {
            section_id: Some(s.id.clone()),
            ..node(
                s.id.clone(),
                NodeKind::Report,
                s.title.clone(),
                (1.8 + degree.of(&s.id).sqrt() * 1.8) * ns,
                palette.report.clone(),
            )
        });
    }

    // Runs, one node each. A run hangs off the paper it tests; a run whose paper is
    // not shown still gets a node, but no edge.
    for e in &input.experiments {
        let linked_paper = e
            .related_paper
            .as_deref()
            .filter(|rp| paper_ids.contains(rp));
        if let Some(rp) = linked_paper {
            links.push(link(
                format!("exp:{}", e.id),
                rp,
                &e.id,
                palette.experiment_link.clone(),
                lt,
                LinkKind::Experiment,
            ));
            degree.bump(&e.id);
        }
        nodes.push(GraphNode {
            experiment_id: Some(e.id.clone()),
            experiment_status: Some(e.status.clone()),
            ..node(
                e.id.clone(),
                NodeKind::Experiment,
                e.name.clone(),
                (1.6 + degree.of(&e.id).sqrt() * 1.6) * ns,
                palette.experiment.clone(),
            )
        });
    }

    if show_concepts {
        for t in &visible {
            nodes.push(GraphNode {
                tag_name: Some(t.clone()),
                ..node(
                    format!("tag:{t}"),
                    NodeKind::Tag,
                    format!("#{t}"),
                    (1.5 + (tag_use.get(t) as f64).sqrt() * 1.6) * ns,
                    graph_colour::tag_colour(t),
                )
            });
        }
        if include_lists {
            for l in &input.lists {
                let members = members_of(input, &l.id);
                let total = members
                    .iter()
                    .filter(|m| paper_ids.contains(m.as_str()) || note_ids.contains(m.as_str()))
                    .count();
                if total == 0 {
                    continue;
                }
                nodes.push(GraphNode {
                    tag_name: Some(l.name.clone()),
                    ..node(
                        format!("list:{}", l.id),
                        NodeKind::Tag,
                        format!("📋 {}", l.name),
                        (1.8 + (total as f64).sqrt() * 1.6) * ns,
                        display_colour(&l.name, l.color.as_deref()),
                    )
                });
            }
        }
    }

    let filtered_links: Vec<GraphLink> = {
        let node_ids: HashSet<&str> = nodes.iter().map(|n| n.id.as_str()).collect();
        links
            .into_iter()
            .filter(|l| {
                node_ids.contains(l.source.as_str()) && node_ids.contains(l.target.as_str())
            })
            .collect()
    };

    let mut neighbors: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for l in &filtered_links {
        for (from, to) in [(&l.source, &l.target), (&l.target, &l.source)] {
            let list = neighbors.entry(from.clone()).or_default();
            if !list.contains(to) {
                list.push(to.clone());
            }
        }
    }

    let colourable: Vec<ColourableNode> = nodes
        .iter()
        .map(|n| ColourableNode {
            id: n.id.clone(),
            label: n.label.clone(),
            paper_id: n.paper_id.clone(),
            year: n.year,
            tag_name: n.tag_name.clone(),
        })
        .collect();
    let ends: Vec<LinkEnds> = filtered_links
        .iter()
        .map(|l| LinkEnds {
            source: l.source.clone(),
            target: l.target.clone(),
        })
        .collect();
    let ctx = RecolourContext {
        papers: input
            .papers
            .iter()
            .map(|p| {
                (
                    p.id.clone(),
                    GroupPaper {
                        id: p.id.clone(),
                        title: p.title.clone(),
                        status: p.status.clone(),
                        tags: p.tags.clone(),
                    },
                )
            })
            .collect(),
        note_tags: input
            .notes
            .iter()
            .zip(&note_tag_lists)
            .map(|(n, tags)| (n.id.clone(), tags.clone()))
            .collect(),
        membership: input
            .membership
            .iter()
            .map(|(k, v)| (k.clone(), v.iter().cloned().collect::<HashSet<String>>()))
            .collect(),
        lists: input
            .lists
            .iter()
            .map(|l| GroupList {
                id: l.id.clone(),
                name: l.name.clone(),
            })
            .collect(),
    };
    if let Some(colours) = graph_colour::recolour_nodes(
        &colourable,
        &ends,
        color_by_name(settings.color_by),
        &settings.color_groups,
        &ctx,
    ) {
        for (n, colour) in nodes.iter_mut().zip(colours) {
            n.color = colour;
        }
    }

    GraphBuildResult {
        data: GraphData {
            nodes,
            links: filtered_links,
        },
        neighbors,
        tag_to_papers,
        tag_to_notes,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::relations::graph_settings::default_graph_settings;

    fn paper(id: &str, status: &str) -> GraphBuildPaper {
        GraphBuildPaper {
            id: id.to_owned(),
            title: format!("Paper {id}"),
            year: None,
            summary: None,
            status: status.to_owned(),
            tags: Vec::new(),
        }
    }

    fn input(papers: Vec<GraphBuildPaper>) -> GraphBuildInput {
        let mut settings = default_graph_settings();
        settings.hide_orphans = true;
        settings.color_by = ColorBy::Status;
        GraphBuildInput {
            papers,
            relations: Vec::new(),
            settings,
            membership: HashMap::new(),
            lists: Vec::new(),
            notes: Vec::new(),
            sections: Vec::new(),
            experiments: Vec::new(),
        }
    }

    #[test]
    fn orphan_has_no_relation_and_no_tag() {
        assert!(is_orphan(0, 0));
        assert!(!is_orphan(1, 0));
        assert!(!is_orphan(0, 1));
    }

    #[test]
    fn hide_orphans_drops_an_isolated_paper() {
        let result = build_graph_data(&input(vec![paper("a", "read")]));
        assert!(result.data.nodes.is_empty());
    }

    #[test]
    fn paper_node_takes_its_reading_status_colour() {
        let palette = graph_colour::graph_palette();
        let mut data = input(vec![paper("a", "read")]);
        data.settings.hide_orphans = false;
        let result = build_graph_data(&data);
        assert_eq!(result.data.nodes[0].color, palette.reading_status.read);
    }
}
