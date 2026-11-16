//! The showcase demo workspace as Rust-planned queries: the port of `seed-showcase.ts`
//! (`resetShowcaseProject`, `seedShowcase`, `seedCollabShowcase`, `seedSuperviseeShowcase`).
//! The data is `showcase_data/*.json`, keyed by the TS export names. The experiment metric
//! curves are formulas and live in [`curve`]. Ids come from [`RepoCall::id`], so every round
//! rebuilds the same plan; the whole plan goes out as one batch and replies are checked for
//! errors in order.

use std::collections::{BTreeMap, HashMap};
use std::sync::OnceLock;

use indexmap::IndexMap;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};

use crate::repo_query::{RepoCall, RepoQuery, RepoStep};
use crate::sync::instant::{format_instant, parse_instant};

/// Bucket for paper figures; paths match what the app writes, so readers need no special case.
pub const PAPER_IMAGE_BUCKET: &str = "paper-images";
/// Bucket for experiment artifacts.
pub const EXPERIMENT_ARTIFACT_BUCKET: &str = "experiment-artifacts";
/// Bucket for wiki and vault figures.
pub const VAULT_ASSET_BUCKET: &str = "vault-assets";
/// The markdown embed prefix for a paper figure (`![alt](paperimg:path)`).
pub const PAPER_IMAGE_PREFIX: &str = "paperimg:";

const DAY_MS: i64 = 86_400_000;
const HOUR_MS: i64 = 3_600_000;
const MINUTE_MS: i64 = 60_000;

/// One PNG the caller must store: the bytes are base64, uploaded to `bucket` at `path`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Upload {
    /// The storage bucket.
    pub bucket: String,
    /// The object path inside the bucket.
    pub path: String,
    /// The PNG bytes, base64-encoded.
    pub base64: String,
}

/// `SeedShowcaseResult` plus the uploads the caller must perform.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SeedResult {
    /// The new project's id.
    pub project_id: String,
    /// Paper title to id.
    pub paper_ids: IndexMap<String, String>,
    /// Counts per kind, as the TS result reports them.
    pub counts: IndexMap<String, usize>,
    /// Milestone title to id.
    pub milestone_ids: IndexMap<String, String>,
    /// Log entry `daysAgo` (as text) to id.
    pub log_ids: IndexMap<String, String>,
    /// Reading list name to id.
    pub list_ids: IndexMap<String, String>,
    /// The PNGs to store, in order.
    pub uploads: Vec<Upload>,
}

/// Options of `seed`: the owner, an optional project name, and the base64 PNG per chart kind.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SeedOptions {
    /// The signed-in user who owns the rows.
    pub user_id: String,
    /// Defaults to the showcase project name.
    #[serde(default)]
    pub project_name: Option<String>,
    /// Base64 PNG per chart kind; a kind without an entry is skipped.
    #[serde(default)]
    pub charts: BTreeMap<String, String>,
}

/// Options of `seedCollab`: the three users and the researcher's ids from `seed`.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CollabOptions {
    /// The researcher, who replies and owns the shared items.
    pub researcher_id: String,
    /// The supervisor, who writes the comment roots.
    pub supervisor_id: String,
    /// A fellow student who shares with the researcher.
    pub peer_id: String,
    /// The researcher's ids, from `seed`.
    pub seeded: Seeded,
}

/// The `seed` result fields that `seedCollab` needs.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Seeded {
    /// Milestone title to id.
    pub milestone_ids: IndexMap<String, String>,
    /// Log entry `daysAgo` (as text) to id.
    pub log_ids: IndexMap<String, String>,
    /// Reading list name to id; the first one is shared.
    pub list_ids: IndexMap<String, String>,
}

/// The item of `list` for `paper`, or the error naming both.
///
/// # Errors
///
/// Fails with `showcase: missing item {list}/{paper}` when no such item was seeded.
pub fn require_item(
    items: &HashMap<(String, String), String>,
    list: &str,
    paper: &str,
) -> Result<String, String> {
    items
        .get(&(list.to_owned(), paper.to_owned()))
        .cloned()
        .ok_or_else(|| format!("showcase: missing item {list}/{paper}"))
}

/// The next step of `method`, or `None` for an unknown method.
#[must_use]
pub fn step(method: &str, call: &RepoCall) -> Option<RepoStep> {
    Some(match method {
        "resetProject" => reset_step(call),
        "seed" => seed_step(call),
        "seedCollab" => collab_step(call),
        "seedSupervisee" => supervisee_step(call),
        "chartKinds" => chart_kinds_step(),
        _ => return None,
    })
}

// ----- data -----------------------------------------------------------------

#[derive(Deserialize)]
struct Paper {
    title: String,
    authors: Vec<String>,
    #[serde(default)]
    year: Value,
    #[serde(default)]
    venue: Option<String>,
    #[serde(default)]
    doi: Option<String>,
    #[serde(default)]
    arxiv_id: Option<String>,
    #[serde(default)]
    url: Option<String>,
    #[serde(default, rename = "abstract")]
    abstract_text: Option<String>,
    summary: String,
    status: String,
    #[serde(default)]
    tags: Vec<String>,
    #[serde(default)]
    rating: Option<Value>,
    #[serde(default, rename = "readDaysAgo")]
    read_days_ago: Option<i64>,
    #[serde(default)]
    bibtex: Option<String>,
}

#[derive(Deserialize)]
struct Experiment {
    name: String,
    #[serde(default)]
    hypothesis: Option<String>,
    status: String,
    #[serde(default)]
    config: Value,
    #[serde(default)]
    metrics: Value,
    #[serde(default)]
    artifacts: Vec<(String, String)>,
    #[serde(default)]
    branch: Option<String>,
    #[serde(default)]
    commit_sha: Option<String>,
    #[serde(default)]
    repo_url: Option<String>,
    #[serde(default)]
    run_command: Option<String>,
    #[serde(default)]
    result_note: Option<String>,
    #[serde(default)]
    related_paper: Option<String>,
    #[serde(default, rename = "startedDaysAgo")]
    started_days_ago: Option<i64>,
    #[serde(default, rename = "finishedDaysAgo")]
    finished_days_ago: Option<i64>,
    /// Metric name to `[steps, null]`; the formula comes from [`curve`].
    #[serde(default)]
    curves: Map<String, Value>,
}

#[derive(Clone, Deserialize)]
struct Milestone {
    title: String,
    #[serde(default)]
    description: Option<String>,
    status: String,
    #[serde(default)]
    target_date: Option<String>,
    #[serde(default)]
    dependencies: Vec<Value>,
    #[serde(default)]
    compute: Vec<Value>,
}

#[derive(Clone, Deserialize)]
struct LogEntry {
    #[serde(rename = "daysAgo")]
    days_ago: i64,
    kind: String,
    body: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReadingList {
    name: String,
    #[serde(default)]
    description: Option<String>,
    color: String,
    #[serde(default)]
    parent: Option<String>,
    papers: Vec<String>,
    #[serde(default)]
    notes: HashMap<String, String>,
}

#[derive(Deserialize)]
struct Screening {
    list: String,
    paper: String,
    stage: String,
    state: String,
    #[serde(default)]
    reason: Option<String>,
}

#[derive(Deserialize)]
struct Comment {
    resource: String,
    /// A milestone title, or a log entry's `days_ago` (a number in the data).
    #[serde(deserialize_with = "string_or_number")]
    target: String,
    body: String,
    replies: Vec<String>,
    #[serde(default)]
    resolved: bool,
}

/// Reads a string, or a number as its decimal text.
fn string_or_number<'de, D: serde::Deserializer<'de>>(de: D) -> Result<String, D::Error> {
    match Value::deserialize(de)? {
        Value::String(text) => Ok(text),
        Value::Number(n) => Ok(n.to_string()),
        other => Err(serde::de::Error::custom(format!(
            "expected a string or number, got {other}"
        ))),
    }
}

#[derive(Deserialize)]
struct ReportSection {
    section_no: String,
    title: String,
    #[serde(default)]
    parent: Option<String>,
    status: String,
    #[serde(default)]
    word_count: Option<Value>,
    #[serde(default)]
    target_words: Option<Value>,
    #[serde(default)]
    deadline: Option<String>,
    #[serde(default)]
    notes: Option<String>,
}

#[derive(Deserialize)]
struct Page {
    title: String,
    body: String,
}

#[derive(Deserialize)]
struct WikiFigure {
    kind: String,
    file: String,
    alt: String,
}

#[derive(Deserialize)]
struct WikiPage {
    title: String,
    body: String,
    #[serde(default)]
    figure: Option<WikiFigure>,
}

#[derive(Deserialize)]
struct Field {
    name: String,
    kind: String,
    #[serde(default)]
    options: Vec<String>,
    #[serde(default)]
    values: Map<String, Value>,
}

#[derive(Deserialize)]
struct Pin {
    #[serde(rename = "type")]
    pin_type: String,
    name: String,
}

/// Every showcase export the seeder reads, loaded once from the JSON files.
struct Data {
    project_name: String,
    project_color: String,
    papers: Vec<Paper>,
    paper_figures: IndexMap<String, Vec<(String, String)>>,
    relations: Vec<Vec<String>>,
    annotations: IndexMap<String, Vec<Value>>,
    annotation_pins: Vec<(String, String, String)>,
    quotation_types: Vec<(String, String, String)>,
    experiments: Vec<Experiment>,
    log: Vec<LogEntry>,
    milestones: Vec<Milestone>,
    reading_lists: Vec<ReadingList>,
    screening: Vec<Screening>,
    supervisor_comments: Vec<Comment>,
    report: Vec<ReportSection>,
    vault: Vec<Page>,
    wiki_root: Page,
    wiki: Vec<WikiPage>,
    fields: Vec<Field>,
    citation_tracks: Vec<String>,
    pins: Vec<Pin>,
}

static DATA: OnceLock<Result<Data, String>> = OnceLock::new();

fn data() -> Result<&'static Data, String> {
    DATA.get_or_init(load_data).as_ref().map_err(Clone::clone)
}

fn load_data() -> Result<Data, String> {
    let papers = parse_file(include_str!("showcase_data/papers.json"), "papers.json")?;
    let parts = parse_file(include_str!("showcase_data/parts.json"), "parts.json")?;
    let report = parse_file(include_str!("showcase_data/report.json"), "report.json")?;
    Ok(Data {
        project_name: take(&papers, "SHOWCASE_PROJECT_NAME")?,
        project_color: take(&papers, "SHOWCASE_PROJECT_COLOR")?,
        papers: take(&papers, "SHOWCASE_PAPERS")?,
        paper_figures: take(&papers, "SHOWCASE_PAPER_FIGURES")?,
        relations: take(&papers, "SHOWCASE_RELATIONS")?,
        annotations: take(&parts, "SHOWCASE_ANNOTATIONS")?,
        annotation_pins: take(&parts, "SHOWCASE_ANNOTATION_PINS")?,
        quotation_types: take(&parts, "SHOWCASE_QUOTATION_TYPES")?,
        experiments: take(&parts, "SHOWCASE_EXPERIMENTS")?,
        log: take(&parts, "SHOWCASE_LOG")?,
        milestones: take(&parts, "SHOWCASE_MILESTONES")?,
        reading_lists: take(&parts, "SHOWCASE_READING_LISTS")?,
        screening: take(&parts, "SHOWCASE_SCREENING")?,
        supervisor_comments: take(&parts, "SHOWCASE_SUPERVISOR_COMMENTS")?,
        report: take(&report, "SHOWCASE_REPORT")?,
        vault: take(&report, "SHOWCASE_VAULT")?,
        wiki_root: take(&report, "SHOWCASE_WIKI_ROOT")?,
        wiki: take(&report, "SHOWCASE_WIKI")?,
        fields: take(&report, "SHOWCASE_FIELDS")?,
        citation_tracks: take(&report, "SHOWCASE_CITATION_TRACKS")?,
        pins: take(&report, "SHOWCASE_PINS")?,
    })
}

fn parse_file(source: &str, file: &str) -> Result<Value, String> {
    serde_json::from_str(source).map_err(|e| format!("{file}: {e}"))
}

fn take<T: DeserializeOwned>(doc: &Value, key: &str) -> Result<T, String> {
    let value = doc
        .get(key)
        .cloned()
        .ok_or_else(|| format!("showcase data: missing {key}"))?;
    serde_json::from_value(value).map_err(|e| format!("showcase data {key}: {e}"))
}

// ----- experiment curves ----------------------------------------------------

/// A metric curve formula; the JSON keeps only each metric's step count.
#[derive(Clone, Copy)]
enum Curve {
    /// `a * exp(-s / tau) + floor`.
    Decay { a: f64, tau: f64, floor: f64 },
    /// `min(cap, start + s * per)`.
    Rise { start: f64, per: f64, cap: f64 },
    /// `a + b * ln(1 + s)`.
    LogGrowth { a: f64, b: f64 },
}

impl Curve {
    fn at(self, s: f64) -> f64 {
        match self {
            Self::Decay { a, tau, floor } => a * (-s / tau).exp() + floor,
            Self::Rise { start, per, cap } => (start + s * per).min(cap),
            Self::LogGrowth { a, b } => a + b * s.ln_1p(),
        }
    }
}

/// The formula of `metric` in experiment `experiment` (TS `curves` in `parts-1.ts`).
#[must_use]
fn curve(experiment: &str, metric: &str) -> Option<Curve> {
    let decay = |a, tau, floor| Curve::Decay { a, tau, floor };
    let rise = |start, per, cap| Curve::Rise { start, per, cap };
    Some(match (experiment, metric) {
        ("exp-01 β-VAE sweep — seed 42", "train_loss") => decay(0.9, 12.0, 0.08),
        ("exp-01 β-VAE sweep — seed 42", "recon_loss") => decay(0.5, 10.0, 0.09),
        ("exp-01 β-VAE sweep — seed 42", "kl") => Curve::LogGrowth { a: 2.0, b: 0.6 },
        ("exp-01 β-VAE sweep — seed 42", "mig") => rise(0.02, 0.0075, 0.23),
        ("exp-02 ResNet-18 encoder baseline", "train_loss") => decay(1.4, 9.0, 0.3),
        ("exp-02 ResNet-18 encoder baseline", "val_loss") => decay(1.5, 10.0, 0.34),
        ("exp-02 ResNet-18 encoder baseline", "accuracy") => rise(0.1, 0.02, 0.912),
        ("exp-03 Graph-prior v1 — seed 1", "train_loss") => decay(1.1, 14.0, 0.5),
        ("exp-03 Graph-prior v1 — seed 1", "mig") => rise(0.03, 0.007, 0.31),
        ("exp-04 Graph-prior v1 — seed 7", "train_loss") => decay(1.1, 14.0, 0.5),
        ("exp-04 Graph-prior v1 — seed 7", "mig") => rise(0.03, 0.006, 0.31),
        ("exp-05 IWAE bound, k=5", "nll") => decay(60.0, 6.0, 98.4),
        ("exp-05 IWAE bound, k=5", "elbo") => decay(62.0, 6.0, 101.9),
        ("exp-06 Graph-prior, mean aggregation", "train_loss") => decay(1.1, 20.0, 0.85),
        ("exp-06 Graph-prior, mean aggregation", "mig") => rise(0.03, 0.002, 0.14),
        _ => return None,
    })
}

/// JS `+x.toFixed(4)`, to four decimals.
fn round4(x: f64) -> f64 {
    (x * 10_000.0).round() / 10_000.0
}

// ----- planning -------------------------------------------------------------

/// The queries of one call, in order, each labelled with the TS error it reports.
struct Plan<'a> {
    call: &'a RepoCall,
    next: usize,
    queries: Vec<(String, RepoQuery)>,
}

impl<'a> Plan<'a> {
    fn new(call: &'a RepoCall) -> Self {
        Self {
            call,
            next: 0,
            queries: Vec::new(),
        }
    }

    /// The next fresh id; the order of calls fixes which id each entity gets.
    fn id(&mut self) -> String {
        let id = self.call.id(self.next);
        self.next += 1;
        id
    }

    fn push(&mut self, label: &str, query: RepoQuery) {
        self.queries.push((label.to_owned(), query.soft()));
    }

    fn insert_one(&mut self, label: &str, table: &str, row: Value) {
        self.push(label, RepoQuery::insert(table, row));
    }

    /// One bulk insert, labelled `insert {table}`; nothing is sent for no rows.
    fn insert(&mut self, table: &str, rows: Vec<Value>) {
        if rows.is_empty() {
            return;
        }
        self.insert_one(&format!("insert {table}"), table, Value::Array(rows));
    }

    fn update(&mut self, label: &str, table: &str, body: Value, id: &str) {
        self.push(label, RepoQuery::update(table, body).eq("id", id));
    }
}

/// Drops any earlier showcase copy of the project, then inserts the new one (TS `resetShowcaseProject`).
fn reset_project(plan: &mut Plan<'_>, user_id: &str, name: &str, color: &str) -> String {
    plan.push(
        "delete project",
        RepoQuery::delete("projects")
            .eq("user_id", user_id)
            .eq("name", name)
            .eq("is_showcase", true),
    );
    let id = plan.id();
    plan.insert_one(
        "insert project",
        "projects",
        json!({ "id": id, "user_id": user_id, "name": name, "color": color, "is_showcase": true }),
    );
    id
}

/// The result of a plan: the queries it needs, or the error its build found.
type Built<T> = Result<(Vec<(String, RepoQuery)>, T), String>;

/// The first step: send the whole plan, then finish with `result` once every reply is clean.
fn finish<T: Serialize>(
    queries: Vec<(String, RepoQuery)>,
    call: &RepoCall,
    result: &T,
) -> RepoStep {
    if queries.is_empty() {
        return RepoStep::done(result);
    }
    if call.replies.is_empty() {
        return RepoStep::Send {
            queries: queries.into_iter().map(|(_, query)| query).collect(),
        };
    }
    if call.replies.len() < queries.len() {
        return RepoStep::fail("showcase: replies out of step");
    }
    for ((label, _), reply) in queries.iter().zip(&call.replies) {
        if let Some(message) = reply_error(reply) {
            return RepoStep::fail(format!("{label}: {message}"));
        }
    }
    RepoStep::done(result)
}

fn reply_error(reply: &Value) -> Option<String> {
    let error = reply.get("error")?;
    Some(
        error
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned(),
    )
}

fn now_ms(call: &RepoCall) -> Result<i64, String> {
    parse_instant(call.now()).ok_or_else(|| "showcase: missing or bad clock".to_owned())
}

/// The seed's state while its plan is built.
struct Seed<'a> {
    plan: Plan<'a>,
    user_id: String,
    project_id: String,
    now_ms: i64,
    charts: &'a BTreeMap<String, String>,
    uploads: Vec<Upload>,
    counts: IndexMap<String, usize>,
    papers: IndexMap<String, String>,
    milestone_ids: IndexMap<String, String>,
    log_ids: IndexMap<String, String>,
    list_ids: IndexMap<String, String>,
    experiment_ids: IndexMap<String, String>,
    section_ids: IndexMap<String, String>,
    items: HashMap<(String, String), String>,
}

impl<'a> Seed<'a> {
    fn new(
        call: &'a RepoCall,
        user_id: &str,
        now_ms: i64,
        charts: &'a BTreeMap<String, String>,
    ) -> Self {
        Self {
            plan: Plan::new(call),
            user_id: user_id.to_owned(),
            project_id: String::new(),
            now_ms,
            charts,
            uploads: Vec::new(),
            counts: IndexMap::new(),
            papers: IndexMap::new(),
            milestone_ids: IndexMap::new(),
            log_ids: IndexMap::new(),
            list_ids: IndexMap::new(),
            experiment_ids: IndexMap::new(),
            section_ids: IndexMap::new(),
            items: HashMap::new(),
        }
    }

    fn start(&mut self, name: &str, color: &str) {
        self.project_id = reset_project(&mut self.plan, &self.user_id, name, color);
    }

    /// The fields every project-scoped row carries, merged into `fields`.
    fn owned(&self, fields: Value) -> Value {
        let mut row = match fields {
            Value::Object(map) => map,
            _ => Map::new(),
        };
        let _ = row.insert("user_id".into(), json!(self.user_id));
        let _ = row.insert("project_id".into(), json!(self.project_id));
        Value::Object(row)
    }

    fn iso_days_ago(&self, days: i64) -> String {
        format_instant(self.now_ms - days * DAY_MS)
    }

    fn date_days_ago(&self, days: i64) -> String {
        let iso = self.iso_days_ago(days);
        iso.get(..10).unwrap_or(&iso).to_owned()
    }

    fn paper_id(&self, title: &str) -> Result<String, String> {
        self.papers
            .get(title)
            .cloned()
            .ok_or_else(|| format!("showcase: unknown paper \"{title}\""))
    }

    fn count(&mut self, key: &str, n: usize) {
        let _ = self.counts.insert(key.to_owned(), n);
    }

    fn papers(&mut self, d: &Data) {
        let mut rows = Vec::new();
        for p in &d.papers {
            let id = self.plan.id();
            let _ = self.papers.insert(p.title.clone(), id.clone());
            let read_at = p.read_days_ago.map(|n| self.date_days_ago(n));
            let metadata = d
                .annotations
                .get(&p.title)
                .map_or_else(|| json!({}), |a| json!({ "annotations": a }));
            rows.push(self.owned(json!({
                "id": id,
                "title": p.title,
                "authors": p.authors,
                "year": p.year,
                "venue": p.venue,
                "doi": p.doi,
                "arxiv_id": p.arxiv_id,
                "url": p.url,
                "abstract": p.abstract_text,
                "summary": p.summary,
                "status": p.status,
                "tags": p.tags,
                "rating": p.rating,
                "read_at": read_at,
                "bibtex": p.bibtex,
                "metadata": metadata,
            })));
        }
        self.plan.insert("papers", rows);
        self.count("papers", d.papers.len());
    }

    /// Uploads each chart and appends a `paperimg:` block to the paper's summary.
    fn figures(&mut self, d: &Data) -> Result<(), String> {
        let mut figures = 0;
        for (title, list) in &d.paper_figures {
            let paper_id = self.paper_id(title)?;
            let mut blocks = Vec::new();
            for (kind, alt) in list {
                let Some(base64) = self.charts.get(kind) else {
                    continue;
                };
                let path = format!("{}/{paper_id}/{kind}.png", self.user_id);
                self.uploads.push(Upload {
                    bucket: PAPER_IMAGE_BUCKET.to_owned(),
                    path: path.clone(),
                    base64: base64.clone(),
                });
                blocks.push(format!("![{alt}]({PAPER_IMAGE_PREFIX}{path})"));
                figures += 1;
            }
            if blocks.is_empty() {
                continue;
            }
            let Some(paper) = d.papers.iter().find(|p| &p.title == title) else {
                return Err(format!("showcase: unknown paper \"{title}\""));
            };
            let summary = format!("{}\n\n{}", paper.summary, blocks.join("\n\n"));
            self.plan.update(
                "update paper figures",
                "papers",
                json!({ "summary": summary }),
                &paper_id,
            );
        }
        self.count("figures", figures);
        Ok(())
    }

    fn relations(&mut self, d: &Data) -> Result<(), String> {
        let mut rows = Vec::new();
        for row in &d.relations {
            rows.push(self.owned(json!({
                "from_paper": self.paper_id(&row[0])?,
                "to_paper": self.paper_id(&row[1])?,
                "relation": &row[2],
                "source": "manual",
                "note": row.get(3),
            })));
        }
        self.plan.insert("paper_relations", rows);
        self.count("relations", d.relations.len());
        Ok(())
    }

    /// Reading lists, parents first; each pass numbers its lists from zero.
    fn reading_lists(&mut self, d: &Data) -> Result<(), String> {
        let roots: Vec<&ReadingList> = d
            .reading_lists
            .iter()
            .filter(|l| l.parent.is_none())
            .collect();
        let children: Vec<&ReadingList> = d
            .reading_lists
            .iter()
            .filter(|l| l.parent.is_some())
            .collect();
        let mut items_total = 0;
        for pass in [roots, children] {
            for (i, l) in pass.into_iter().enumerate() {
                let list_id = self.plan.id();
                let parent_id = l
                    .parent
                    .as_ref()
                    .and_then(|p| self.list_ids.get(p))
                    .cloned();
                self.plan.insert_one(
                    &format!("insert reading list {}", l.name),
                    "reading_lists",
                    self.owned(json!({
                        "id": list_id,
                        "name": l.name,
                        "description": l.description,
                        "color": l.color,
                        "sort_order": i,
                        "parent_id": parent_id,
                    })),
                );
                let _ = self.list_ids.insert(l.name.clone(), list_id.clone());
                let mut rows = Vec::new();
                for (j, title) in l.papers.iter().enumerate() {
                    let item_id = self.plan.id();
                    rows.push(json!({
                        "id": item_id,
                        "list_id": list_id,
                        "paper_id": self.paper_id(title)?,
                        "sort_order": j,
                        "note": l.notes.get(title),
                    }));
                    let _ = self.items.insert((l.name.clone(), title.clone()), item_id);
                }
                items_total += rows.len();
                self.plan.insert("reading_list_items", rows);
            }
        }
        self.count("readingLists", d.reading_lists.len());
        self.count("readingListItems", items_total);
        Ok(())
    }

    fn screening(&mut self, d: &Data) -> Result<(), String> {
        let mut rows = Vec::new();
        for s in &d.screening {
            rows.push(json!({
                "item_id": require_item(&self.items, &s.list, &s.paper)?,
                "reviewer_id": self.user_id,
                "stage": s.stage,
                "state": s.state,
                "reason": s.reason,
            }));
        }
        self.plan.insert("screening_decisions", rows);
        self.count("screeningDecisions", d.screening.len());
        Ok(())
    }

    /// Milestones (with dependency `refId`s resolved by title) and the logbook.
    fn milestones_and_log(&mut self, milestones: &[Milestone], log: &[LogEntry]) {
        let mut ids: IndexMap<String, String> = IndexMap::new();
        for m in milestones {
            let _ = ids.insert(m.title.clone(), self.plan.id());
        }
        let mut rows = Vec::new();
        for m in milestones {
            let dependencies: Vec<Value> = m
                .dependencies
                .iter()
                .map(|dep| resolve_dependency(dep, &ids))
                .collect();
            rows.push(self.owned(json!({
                "id": ids.get(&m.title),
                "title": m.title,
                "description": m.description,
                "status": m.status,
                "target_date": m.target_date,
                "dependencies": dependencies,
                "compute": m.compute,
            })));
        }
        self.plan.insert("milestones", rows);
        let mut entries = Vec::new();
        for e in log {
            let id = self.plan.id();
            entries.push(self.owned(json!({
                "id": id,
                "entry_date": self.date_days_ago(e.days_ago),
                "kind": e.kind,
                "body": e.body,
                "links": [],
            })));
            let _ = self.log_ids.insert(e.days_ago.to_string(), id);
        }
        self.plan.insert("log_entries", entries);
        self.count("milestones", milestones.len());
        self.count("logEntries", log.len());
        self.milestone_ids = ids;
    }

    /// Experiments, then each one's artifacts and metric curves.
    fn experiments(&mut self, d: &Data) -> Result<(), String> {
        let mut artifacts_total = 0;
        let mut points_total = 0;
        for e in &d.experiments {
            let id = self.plan.id();
            let related = match &e.related_paper {
                Some(title) => Some(self.paper_id(title)?),
                None => None,
            };
            let started_at = e.started_days_ago.map(|n| self.iso_days_ago(n));
            let finished_at = e.finished_days_ago.map(|n| self.iso_days_ago(n));
            self.plan.insert_one(
                &format!("insert experiment {}", e.name),
                "experiments",
                self.owned(json!({
                    "id": id,
                    "name": e.name,
                    "hypothesis": e.hypothesis,
                    "status": e.status,
                    "config": e.config,
                    "metrics": e.metrics,
                    "artifacts": [],
                    "branch": e.branch,
                    "commit_sha": e.commit_sha,
                    "repo_url": e.repo_url,
                    "run_command": e.run_command,
                    "result_note": e.result_note,
                    "related_paper": related,
                    "started_at": started_at,
                    "finished_at": finished_at,
                })),
            );
            let _ = self.experiment_ids.insert(e.name.clone(), id.clone());
            artifacts_total += self.artifacts(e, &id);
            points_total += self.metrics(e, &id)?;
        }
        self.count("experiments", d.experiments.len());
        self.count("artifacts", artifacts_total);
        self.count("metricPoints", points_total);
        Ok(())
    }

    fn artifacts(&mut self, e: &Experiment, id: &str) -> usize {
        let mut paths = Vec::new();
        for (kind, file) in &e.artifacts {
            let Some(base64) = self.charts.get(kind) else {
                continue;
            };
            let path = format!("{}/{id}/{file}", self.user_id);
            self.uploads.push(Upload {
                bucket: EXPERIMENT_ARTIFACT_BUCKET.to_owned(),
                path: path.clone(),
                base64: base64.clone(),
            });
            paths.push(path);
        }
        if paths.is_empty() {
            return 0;
        }
        let n = paths.len();
        self.plan.update(
            "update experiment artifacts",
            "experiments",
            json!({ "artifacts": paths }),
            id,
        );
        n
    }

    /// Metric points, one minute apart from the start (a day ago when the start is unset).
    fn metrics(&mut self, e: &Experiment, id: &str) -> Result<usize, String> {
        let started = match e.started_days_ago {
            Some(n) => self.now_ms - n * DAY_MS,
            None => self.now_ms - DAY_MS,
        };
        let mut rows = Vec::new();
        for (metric, spec) in &e.curves {
            let steps = spec
                .get(0)
                .and_then(Value::as_u64)
                .and_then(|n| u32::try_from(n).ok())
                .ok_or_else(|| format!("showcase: bad curve {metric} in {}", e.name))?;
            let formula = curve(&e.name, metric)
                .ok_or_else(|| format!("showcase: no curve {metric} for {}", e.name))?;
            for s in 0..steps {
                rows.push(json!({
                    "experiment_id": id,
                    "user_id": self.user_id,
                    "metric": metric,
                    "step": s,
                    "value": round4(formula.at(f64::from(s))),
                    "wall_time": format_instant(started + i64::from(s) * MINUTE_MS),
                }));
            }
        }
        let n = rows.len();
        if n > 0 {
            self.plan.insert_one(
                &format!("insert metrics for {}", e.name),
                "experiment_metrics",
                Value::Array(rows),
            );
        }
        Ok(n)
    }

    /// Report outline, parents before children, in the order listed.
    fn report(&mut self, d: &Data) -> Result<(), String> {
        for (i, s) in d.report.iter().enumerate() {
            let id = self.plan.id();
            let parent_id = s
                .parent
                .as_ref()
                .and_then(|p| self.section_ids.get(p))
                .cloned();
            self.plan.insert_one(
                &format!("insert section {}", s.section_no),
                "report_sections",
                self.owned(json!({
                    "id": id,
                    "section_no": s.section_no,
                    "title": s.title,
                    "parent_id": parent_id,
                    "status": s.status,
                    "word_count": s.word_count.clone().unwrap_or(json!(0)),
                    "target_words": s.target_words,
                    "deadline": s.deadline,
                    "notes": s.notes,
                    "sort_order": i,
                })),
            );
            let _ = self.section_ids.insert(s.section_no.clone(), id);
        }
        self.count("reportSections", d.report.len());
        Ok(())
    }

    /// Annotations pinned to report sections, and their quotation types.
    fn annotation_links(&mut self, d: &Data) -> Result<(), String> {
        let mut pins = Vec::new();
        for (title, key, section_no) in &d.annotation_pins {
            pins.push(self.owned(json!({
                "paper_id": self.paper_id(title)?,
                "annotation_key": key,
                "report_section_id": self.section_ids.get(section_no),
            })));
        }
        self.plan.insert("annotation_pins", pins);
        let mut quotes = Vec::new();
        for (title, key, quotation_type) in &d.quotation_types {
            quotes.push(self.owned(json!({
                "paper_id": self.paper_id(title)?,
                "annotation_key": key,
                "quotation_type": quotation_type,
            })));
        }
        self.plan.insert("annotation_quotation_types", quotes);
        self.count("annotationPins", d.annotation_pins.len());
        Ok(())
    }

    fn vault(&mut self, d: &Data) {
        let rows: Vec<Value> = d
            .vault
            .iter()
            .enumerate()
            .map(|(i, v)| self.owned(json!({ "title": v.title, "body": v.body, "sort_order": i })))
            .collect();
        self.plan.insert("vault_pages", rows);
        self.count("vaultPages", d.vault.len());
        self.wiki(d);
    }

    /// A "Wiki" root with concept pages under it; a page's figure is uploaded and embedded when its chart is present.
    fn wiki(&mut self, d: &Data) {
        let root_id = self.plan.id();
        let root = self.owned(json!({
            "id": root_id,
            "title": d.wiki_root.title,
            "body": d.wiki_root.body,
            "sort_order": d.vault.len(),
        }));
        self.plan.insert("vault_pages", vec![root]);
        let mut ids = Vec::new();
        let mut rows = Vec::new();
        for (i, w) in d.wiki.iter().enumerate() {
            let id = self.plan.id();
            // Without the figure until it is uploaded, so a skipped chart leaves no broken embed.
            rows.push(self.owned(json!({
                "id": id,
                "title": w.title,
                "body": w.body.replacen("\n\n{{figure}}", "", 1),
                "parent_id": root_id,
                "sort_order": i,
            })));
            ids.push(id);
        }
        self.plan.insert("vault_pages", rows);
        for (w, page_id) in d.wiki.iter().zip(&ids) {
            let Some(figure) = &w.figure else {
                continue;
            };
            let Some(base64) = self.charts.get(&figure.kind) else {
                continue;
            };
            let path = format!("{}/{page_id}/{}", self.user_id, figure.file);
            self.uploads.push(Upload {
                bucket: VAULT_ASSET_BUCKET.to_owned(),
                path: path.clone(),
                base64: base64.clone(),
            });
            let body =
                w.body
                    .replacen("{{figure}}", &format!("![{}](vault:{path})", figure.alt), 1);
            self.plan.update(
                "update wiki figure",
                "vault_pages",
                json!({ "body": body }),
                page_id,
            );
        }
        self.count("wikiPages", d.wiki.len());
    }

    /// Custom paper fields and their values.
    fn fields(&mut self, d: &Data) -> Result<(), String> {
        let mut values_total = 0;
        for (i, f) in d.fields.iter().enumerate() {
            let def_id = self.plan.id();
            self.plan.insert_one(
                &format!("insert field {}", f.name),
                "paper_field_defs",
                self.owned(json!({
                    "id": def_id,
                    "name": f.name,
                    "kind": f.kind,
                    "options": f.options,
                    "sort_order": i,
                })),
            );
            let mut rows = Vec::new();
            for (title, value) in &f.values {
                rows.push(self.owned(json!({
                    "paper_id": self.paper_id(title)?,
                    "field_id": def_id,
                    "value": value,
                })));
            }
            values_total += rows.len();
            self.plan.insert("paper_field_values", rows);
        }
        self.count("fieldDefs", d.fields.len());
        self.count("fieldValues", values_total);
        Ok(())
    }

    fn citation_tracks(&mut self, d: &Data) -> Result<(), String> {
        let mut rows = Vec::new();
        for (i, title) in d.citation_tracks.iter().enumerate() {
            let back = 20 - i64::try_from(i).unwrap_or_default();
            rows.push(self.owned(json!({
                "paper_id": self.paper_id(title)?,
                "tracked_at": self.iso_days_ago(back),
                "last_checked_at": self.iso_days_ago(1),
                "seen_citing_ids": [],
            })));
        }
        self.plan.insert("citation_alert_tracks", rows);
        self.count("citationTracks", d.citation_tracks.len());
        Ok(())
    }

    /// Library pins, each resolved by type to an id seeded above; unknown names are skipped.
    fn pins(&mut self, d: &Data) {
        let mut rows = Vec::new();
        for p in &d.pins {
            let id = match p.pin_type.as_str() {
                "milestone" => self.milestone_ids.get(&p.name),
                "experiment" => self.experiment_ids.get(&p.name),
                "report_section" => self.section_ids.get(&p.name),
                "reading_list" => self.list_ids.get(&p.name),
                "paper" => self.papers.get(&p.name),
                _ => None,
            };
            if let Some(id) = id {
                rows.push(self.owned(json!({
                    "owner_id": self.user_id,
                    "resource_type": p.pin_type,
                    "resource_id": id,
                })));
            }
        }
        self.plan.insert("library_pins", rows);
        self.count("libraryPins", d.pins.len());
    }
}

/// A milestone dependency whose `label` names a milestone of this seed gets that milestone's `refId`.
fn resolve_dependency(dep: &Value, ids: &IndexMap<String, String>) -> Value {
    let has_ref = dep.get("refId").is_some_and(|v| !v.is_null());
    let is_milestone = dep.get("kind").and_then(Value::as_str) == Some("milestone");
    let target = dep
        .get("label")
        .and_then(Value::as_str)
        .and_then(|l| ids.get(l));
    match (has_ref, is_milestone, target) {
        (false, true, Some(id)) => {
            let mut out = dep.clone();
            if let Value::Object(map) = &mut out {
                let _ = map.insert("refId".into(), json!(id));
            }
            out
        }
        _ => dep.clone(),
    }
}

/// Builds the full seed plan and its result (TS `seedShowcase`).
fn build_seed(call: &RepoCall, opts: &SeedOptions) -> Built<SeedResult> {
    let d = data()?;
    let now = now_ms(call)?;
    let name = opts
        .project_name
        .clone()
        .unwrap_or_else(|| d.project_name.clone());
    let mut s = Seed::new(call, &opts.user_id, now, &opts.charts);
    s.start(&name, &d.project_color);
    s.papers(d);
    s.figures(d)?;
    s.relations(d)?;
    s.reading_lists(d)?;
    s.screening(d)?;
    s.milestones_and_log(&d.milestones, &d.log);
    s.experiments(d)?;
    s.report(d)?;
    s.annotation_links(d)?;
    s.vault(d);
    s.fields(d)?;
    s.citation_tracks(d)?;
    s.pins(d);
    let result = SeedResult {
        project_id: s.project_id.clone(),
        paper_ids: s.papers.clone(),
        counts: s.counts.clone(),
        milestone_ids: s.milestone_ids.clone(),
        log_ids: s.log_ids.clone(),
        list_ids: s.list_ids.clone(),
        uploads: s.uploads.clone(),
    };
    Ok((s.plan.queries, result))
}

fn seed_step(call: &RepoCall) -> RepoStep {
    let opts = match call.parse::<SeedOptions>(0) {
        Ok(opts) => opts,
        Err(message) => return RepoStep::fail(message),
    };
    match build_seed(call, &opts) {
        Ok((queries, result)) => finish(queries, call, &result),
        Err(message) => RepoStep::fail(message),
    }
}

/// `resetProject(userId, name)`: the new project's id.
fn reset_step(call: &RepoCall) -> RepoStep {
    let d = match data() {
        Ok(d) => d,
        Err(message) => return RepoStep::fail(message),
    };
    let mut plan = Plan::new(call);
    let id = reset_project(&mut plan, call.text(0), call.text(1), &d.project_color);
    finish(plan.queries, call, &id)
}

/// `seedSupervisee(userId, label)`: a supervisee's project with milestones and a logbook.
fn supervisee_step(call: &RepoCall) -> RepoStep {
    let d = match data() {
        Ok(d) => d,
        Err(message) => return RepoStep::fail(message),
    };
    let now = match now_ms(call) {
        Ok(now) => now,
        Err(message) => return RepoStep::fail(message),
    };
    let label = call.text(1);
    let (milestones, log) = supervisee_data(label);
    let charts = BTreeMap::new();
    let mut s = Seed::new(call, call.text(0), now, &charts);
    s.start(&d.project_name, &d.project_color);
    s.milestones_and_log(&milestones, &log);
    let project_id = s.project_id.clone();
    finish(s.plan.queries, call, &project_id)
}

/// The milestones and logbook of a supervisee account (TS `superviseeShowcase`).
fn supervisee_data(label: &str) -> (Vec<Milestone>, Vec<LogEntry>) {
    let milestone =
        |title: &str, description: Option<String>, status: &str, target: &str| Milestone {
            title: title.to_owned(),
            description,
            status: status.to_owned(),
            target_date: Some(target.to_owned()),
            dependencies: Vec::new(),
            compute: Vec::new(),
        };
    let entry = |days_ago: i64, body: String| LogEntry {
        days_ago,
        kind: "daily".to_owned(),
        body,
    };
    (
        vec![
            milestone(
                "Proposal submitted",
                Some(format!("{label}: ethics + proposal signed off")),
                "done",
                "2026-02-01",
            ),
            milestone(
                "Pilot user study",
                Some("Recruit 12 participants; pre-register analysis plan".to_owned()),
                "in_progress",
                "2026-07-01",
            ),
            milestone("Write-up", None, "planned", "2026-08-15"),
        ],
        vec![
            entry(
                1,
                format!("{label}: Collected 4/12 pilot sessions. Uploading notes to vault."),
            ),
            entry(
                4,
                format!("{label}: Literature skim — added 3 papers to reading list."),
            ),
        ],
    )
}

/// `seedCollab`: supervision threads and shares on top of the researcher's workspace (TS `seedCollabShowcase`).
#[allow(
    clippy::too_many_lines,
    reason = "one linear script of demo rows; splitting hides the order"
)]
fn build_collab(call: &RepoCall, opts: &CollabOptions) -> Built<()> {
    let d = data()?;
    let now = now_ms(call)?;
    let mut plan = Plan::new(call);
    let threads = &d.supervisor_comments;
    let n = threads.len();
    // Oldest thread first, six hours apart; replies two hours after the comment before them.
    let at = |i: usize, step: i64| {
        format_instant(
            now - i64::try_from(n - i).unwrap_or_default() * 6 * HOUR_MS + step * 2 * HOUR_MS,
        )
    };
    let mut resource_ids = Vec::new();
    for t in threads {
        let key = t.target.clone();
        let found = if t.resource == "milestone" {
            opts.seeded.milestone_ids.get(&key)
        } else {
            opts.seeded.log_ids.get(&key)
        };
        let Some(id) = found else {
            return Err(format!(
                "showcase: comment target {} \"{key}\" was not seeded",
                t.resource
            ));
        };
        resource_ids.push(id.clone());
    }
    let root_ids: Vec<String> = threads.iter().map(|_| plan.id()).collect();
    let roots: Vec<Value> = threads
        .iter()
        .enumerate()
        .map(|(i, t)| {
            json!({
                "id": root_ids[i],
                "author_id": opts.supervisor_id,
                "resource_type": t.resource,
                "resource_id": resource_ids[i],
                "body": t.body,
                "created_at": at(i, 0),
            })
        })
        .collect();
    // Roots first: the insert trigger (0133) checks a reply's parent exists.
    plan.insert("comments", roots);
    let mut replies = Vec::new();
    for (i, t) in threads.iter().enumerate() {
        for (j, body) in t.replies.iter().enumerate() {
            replies.push(json!({
                "author_id": opts.researcher_id,
                "resource_type": t.resource,
                "resource_id": resource_ids[i],
                "parent_id": root_ids[i],
                "body": body,
                "created_at": at(i, i64::try_from(j + 1).unwrap_or_default()),
            }));
        }
    }
    plan.insert("comments", replies);
    // The trigger clears resolved_at on insert, so closing is a separate update.
    for (i, t) in threads.iter().enumerate() {
        if t.resolved {
            let step = i64::try_from(t.replies.len() + 1).unwrap_or_default();
            plan.update(
                "resolve comment",
                "comments",
                json!({ "resolved_at": at(i, step) }),
                &root_ids[i],
            );
        }
    }
    let first_list = opts
        .seeded
        .list_ids
        .values()
        .next()
        .cloned()
        .ok_or_else(|| "showcase: no reading list to share".to_owned())?;
    let shares = [
        (
            &opts.researcher_id,
            &opts.supervisor_id,
            "milestone",
            None,
            "comment",
        ),
        (
            &opts.peer_id,
            &opts.researcher_id,
            "milestone",
            None,
            "comment",
        ),
        (
            &opts.researcher_id,
            &opts.peer_id,
            "reading_list",
            Some(first_list),
            "view",
        ),
    ];
    for (owner, recipient, resource_type, resource_id, access) in shares {
        plan.push(
            "delete share",
            RepoQuery::delete("shares")
                .eq("owner_id", owner.as_str())
                .eq("recipient_id", recipient.as_str())
                .eq("resource_type", resource_type),
        );
        plan.insert(
            "shares",
            vec![json!({
                "owner_id": owner,
                "recipient_id": recipient,
                "resource_type": resource_type,
                "resource_id": resource_id,
                "access": access,
            })],
        );
    }
    Ok((plan.queries, ()))
}

fn collab_step(call: &RepoCall) -> RepoStep {
    let opts = match call.parse::<CollabOptions>(0) {
        Ok(opts) => opts,
        Err(message) => return RepoStep::fail(message),
    };
    match build_collab(call, &opts) {
        Ok((queries, ())) => finish(queries, call, &()),
        Err(message) => RepoStep::fail(message),
    }
}

/// The experiment artifact and figure kinds the caller must render (TS `chartKinds`).
fn chart_kinds() -> Result<Vec<String>, String> {
    let d = data()?;
    let mut kinds: Vec<String> = Vec::new();
    let mut add = |kind: &str| {
        if !kinds.iter().any(|k| k == kind) {
            kinds.push(kind.to_owned());
        }
    };
    for list in d.paper_figures.values() {
        for (kind, _) in list {
            add(kind.as_str());
        }
    }
    for e in &d.experiments {
        for (kind, _) in &e.artifacts {
            add(kind.as_str());
        }
    }
    for w in &d.wiki {
        if let Some(figure) = &w.figure {
            add(figure.kind.as_str());
        }
    }
    Ok(kinds)
}

fn chart_kinds_step() -> RepoStep {
    match chart_kinds() {
        Ok(kinds) => RepoStep::done(&kinds),
        Err(message) => RepoStep::fail(message),
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;

    use super::*;
    use crate::repo_query::{RepoAction, RepoCtx};

    const NOW: &str = "2026-06-30T12:00:00.000Z";

    fn call(args: Vec<Value>, replies: Vec<Value>) -> RepoCall {
        RepoCall {
            args,
            replies,
            ctx: RepoCtx {
                project_id: Some("p1".into()),
                user_id: Some("u1".into()),
                id_seed: Some("seed".into()),
                now: Some(NOW.into()),
            },
        }
    }

    fn seed_with(charts: BTreeMap<String, String>) -> (Vec<(String, RepoQuery)>, SeedResult) {
        let c = call(vec![], vec![]);
        let opts = SeedOptions {
            user_id: "u1".into(),
            project_name: None,
            charts,
        };
        build_seed(&c, &opts).expect("seed plan builds")
    }

    fn all_charts() -> BTreeMap<String, String> {
        chart_kinds()
            .expect("chart kinds")
            .into_iter()
            .map(|k| (k, "AAAA".to_owned()))
            .collect()
    }

    /// The rows of every insert into `table`, in plan order.
    fn inserted(queries: &[(String, RepoQuery)], table: &str) -> Vec<Value> {
        queries
            .iter()
            .filter(|(_, q)| q.table == table && matches!(q.action, RepoAction::Insert))
            .flat_map(|(_, q)| match &q.body {
                Some(Value::Array(rows)) => rows.clone(),
                Some(row) => vec![row.clone()],
                None => vec![],
            })
            .collect()
    }

    /// The bodies of every update of `table`, in plan order.
    fn updates(queries: &[(String, RepoQuery)], table: &str) -> Vec<Value> {
        queries
            .iter()
            .filter(|(_, q)| q.table == table && matches!(q.action, RepoAction::Update))
            .filter_map(|(_, q)| q.body.clone())
            .collect()
    }

    fn fail_message(step: RepoStep) -> String {
        match step {
            RepoStep::Fail { message, .. } => message,
            other => panic!("expected fail, got {other:?}"),
        }
    }

    #[test]
    fn seed_reports_counts_and_uploads_every_chart() {
        let d = data().expect("data");
        let (queries, result) = seed_with(all_charts());
        assert!(d.papers.len() >= 100);
        assert_eq!(inserted(&queries, "papers").len(), d.papers.len());
        assert_eq!(result.counts["papers"], d.papers.len());
        assert_eq!(result.counts["readingLists"], d.reading_lists.len());
        assert_eq!(result.counts["logEntries"], d.log.len());
        assert_eq!(result.counts["experiments"], d.experiments.len());

        let figures: usize = d.paper_figures.values().map(Vec::len).sum();
        let artifacts: usize = d.experiments.iter().map(|e| e.artifacts.len()).sum();
        let wiki_figures = d.wiki.iter().filter(|w| w.figure.is_some()).count();
        assert_eq!(result.counts["figures"], figures);
        assert_eq!(result.counts["artifacts"], artifacts);
        assert_eq!(result.uploads.len(), figures + artifacts + wiki_figures);
        assert!(
            result
                .uploads
                .iter()
                .any(|u| u.bucket == PAPER_IMAGE_BUCKET)
        );
        assert!(
            result
                .uploads
                .iter()
                .any(|u| u.bucket == EXPERIMENT_ARTIFACT_BUCKET)
        );
        assert!(
            result
                .uploads
                .iter()
                .any(|u| u.bucket == VAULT_ASSET_BUCKET)
        );
    }

    #[test]
    fn screening_answers_link_to_seeded_items() {
        let d = data().expect("data");
        let (queries, _) = seed_with(all_charts());
        let items: Vec<String> = inserted(&queries, "reading_list_items")
            .iter()
            .filter_map(|r| r["id"].as_str().map(str::to_owned))
            .collect();
        let screening = inserted(&queries, "screening_decisions");
        assert_eq!(screening.len(), d.screening.len());
        for row in &screening {
            let item = row["item_id"].as_str().unwrap_or_default();
            assert!(
                items.iter().any(|i| i.as_str() == item),
                "orphan screening item {item}"
            );
        }
    }

    #[test]
    fn milestone_dependencies_resolve_to_seeded_milestones() {
        let (queries, _) = seed_with(all_charts());
        let rows = inserted(&queries, "milestones");
        let ids: Vec<&str> = rows.iter().filter_map(|r| r["id"].as_str()).collect();
        let mut resolved = 0;
        for row in &rows {
            for dep in row["dependencies"].as_array().into_iter().flatten() {
                if dep["kind"] == "milestone" && dep.get("label").is_some_and(|l| !l.is_null()) {
                    let target = dep["refId"].as_str().unwrap_or_default();
                    assert!(ids.contains(&target), "dangling dependency {dep}");
                    resolved += 1;
                }
            }
        }
        assert!(resolved > 0);
    }

    #[test]
    fn library_pins_count_matches_seed_data() {
        let d = data().expect("data");
        let (queries, result) = seed_with(all_charts());
        assert_eq!(result.counts["libraryPins"], d.pins.len());
        assert_eq!(inserted(&queries, "library_pins").len(), d.pins.len());
    }

    #[test]
    fn wiki_root_pages_and_figure_upload() {
        let d = data().expect("data");
        let (queries, result) = seed_with(all_charts());
        let pages = inserted(&queries, "vault_pages");
        let root = pages
            .iter()
            .find(|p| p["title"] == d.wiki_root.title.as_str())
            .expect("wiki root");
        assert!(root["parent_id"].is_null());
        let children: Vec<&Value> = pages
            .iter()
            .filter(|p| d.wiki.iter().any(|w| p["title"] == w.title.as_str()))
            .collect();
        assert_eq!(children.len(), d.wiki.len());
        for child in &children {
            assert_eq!(child["parent_id"], root["id"]);
        }
        let wiki_figures = d.wiki.iter().filter(|w| w.figure.is_some()).count();
        let vault_uploads = result
            .uploads
            .iter()
            .filter(|u| u.bucket == VAULT_ASSET_BUCKET)
            .count();
        assert_eq!(vault_uploads, wiki_figures);
        assert!(
            updates(&queries, "vault_pages")
                .iter()
                .any(|b| b["body"].as_str().unwrap_or_default().contains("](vault:"))
        );
    }

    #[test]
    fn no_charts_still_seeds_without_dangling_embeds() {
        let d = data().expect("data");
        let (queries, result) = seed_with(BTreeMap::new());
        assert!(result.uploads.is_empty());
        assert_eq!(result.counts["figures"], 0);
        assert_eq!(result.counts["wikiPages"], d.wiki.len());
        let bodies: Vec<String> = inserted(&queries, "vault_pages")
            .iter()
            .chain(updates(&queries, "vault_pages").iter())
            .filter_map(|r| r["body"].as_str().map(str::to_owned))
            .collect();
        for body in &bodies {
            assert!(!body.contains("{{figure}}"));
            assert!(!body.contains("](vault:"));
        }
        assert!(updates(&queries, "papers").is_empty());
    }

    #[test]
    fn require_item_names_the_missing_list_and_paper() {
        let mut items = HashMap::new();
        let _ = items.insert(("A".to_owned(), "p1".to_owned()), "id1".to_owned());
        assert_eq!(require_item(&items, "A", "p1"), Ok("id1".to_owned()));
        assert_eq!(
            require_item(&items, "A", "p2"),
            Err("showcase: missing item A/p2".to_owned())
        );
        assert_eq!(
            require_item(&items, "B", "p1"),
            Err("showcase: missing item B/p1".to_owned())
        );
    }

    #[test]
    fn reset_touches_only_the_callers_showcase() {
        let c = call(vec![json!("u1"), json!("MSc Thesis (Showcase)")], vec![]);
        let RepoStep::Send { queries } = reset_step(&c) else {
            panic!("expected a send");
        };
        assert!(matches!(queries[0].action, RepoAction::Delete));
        assert_eq!(queries[0].filters.len(), 3);
        let insert = queries[1].body.clone().expect("insert body");
        assert_eq!(insert["is_showcase"], json!(true));
        assert_eq!(insert["user_id"], json!("u1"));
    }

    #[test]
    fn reset_done_returns_the_project_id_after_replies() {
        let c = call(
            vec![json!("u1"), json!("MSc Thesis (Showcase)")],
            vec![json!(null), json!(null)],
        );
        match reset_step(&c) {
            RepoStep::Done { value } => assert!(value.is_string()),
            other => panic!("expected done, got {other:?}"),
        }
    }

    #[test]
    fn a_reply_error_fails_with_the_ts_label() {
        let c = call(
            vec![json!("u1"), json!("MSc Thesis (Showcase)")],
            vec![
                json!(null),
                json!({"error": {"code": "23505", "message": "dup"}}),
            ],
        );
        assert_eq!(fail_message(reset_step(&c)), "insert project: dup");
    }

    #[test]
    fn chart_kinds_cover_figures_artifacts_and_wiki() {
        let d = data().expect("data");
        let kinds = chart_kinds().expect("chart kinds");
        let mut seen = kinds.clone();
        seen.sort();
        seen.dedup();
        assert_eq!(seen.len(), kinds.len());
        for list in d.paper_figures.values() {
            for (kind, _) in list {
                assert!(kinds.contains(kind));
            }
        }
        for w in &d.wiki {
            if let Some(figure) = &w.figure {
                assert!(kinds.contains(&figure.kind));
            }
        }
    }

    #[test]
    fn curve_formulas_match_the_ts_shapes() {
        let decay = curve("exp-05 IWAE bound, k=5", "nll").expect("curve");
        assert!((decay.at(0.0) - 158.4).abs() < 1e-9);
        let rise = curve("exp-02 ResNet-18 encoder baseline", "accuracy").expect("curve");
        assert!((rise.at(1_000.0) - 0.912).abs() < 1e-9);
        assert_eq!(round4(1.234_567), 1.2346);
    }

    fn collab_call(result: &SeedResult) -> RepoCall {
        let opts = json!({
            "researcherId": "researcher",
            "supervisorId": "supervisor",
            "peerId": "peer",
            "seeded": {
                "milestoneIds": result.milestone_ids,
                "logIds": result.log_ids,
                "listIds": result.list_ids,
            },
        });
        call(vec![opts], vec![])
    }

    fn collab_plan(result: &SeedResult) -> Vec<(String, RepoQuery)> {
        let c = collab_call(result);
        let opts = c.parse::<CollabOptions>(0).expect("collab options");
        build_collab(&c, &opts).expect("collab plan").0
    }

    #[test]
    fn collab_roots_come_before_replies_and_replies_follow_their_root() {
        let d = data().expect("data");
        let (_, result) = seed_with(all_charts());
        let queries = collab_plan(&result);
        let comments = inserted(&queries, "comments");
        let roots: Vec<&Value> = comments
            .iter()
            .filter(|c| c.get("parent_id").is_none())
            .collect();
        let replies: Vec<&Value> = comments
            .iter()
            .filter(|c| c.get("parent_id").is_some())
            .collect();
        assert_eq!(roots.len(), d.supervisor_comments.len());
        let reply_count: usize = d.supervisor_comments.iter().map(|t| t.replies.len()).sum();
        assert_eq!(replies.len(), reply_count);
        let first_reply = comments.iter().position(|c| c.get("parent_id").is_some());
        let last_root = comments.iter().rposition(|c| c.get("parent_id").is_none());
        assert!(last_root < first_reply);
        for reply in replies {
            let root = roots
                .iter()
                .find(|r| r["id"] == reply["parent_id"])
                .expect("reply has a root");
            assert!(reply["created_at"].as_str() > root["created_at"].as_str());
        }
    }

    #[test]
    fn collab_resolves_closed_threads_only() {
        let d = data().expect("data");
        let (_, result) = seed_with(all_charts());
        let queries = collab_plan(&result);
        let closed = updates(&queries, "comments");
        let resolved = d.supervisor_comments.iter().filter(|t| t.resolved).count();
        assert!(resolved > 0);
        assert_eq!(closed.len(), resolved);
        assert!(closed.iter().all(|b| b.get("resolved_at").is_some()));
    }

    #[test]
    fn collab_deletes_each_share_before_inserting_it() {
        let (_, result) = seed_with(all_charts());
        let queries = collab_plan(&result);
        let shares: Vec<&(String, RepoQuery)> = queries
            .iter()
            .filter(|(_, q)| q.table == "shares")
            .collect();
        assert_eq!(shares.len(), 6);
        for pair in shares.chunks(2) {
            assert!(matches!(pair[0].1.action, RepoAction::Delete));
            assert!(matches!(pair[1].1.action, RepoAction::Insert));
        }
    }

    #[test]
    fn showcase_data_papers_are_unique_and_full() {
        let d = data().expect("data");
        assert!(d.papers.len() >= 100);
        let mut titles: Vec<&str> = d.papers.iter().map(|p| p.title.as_str()).collect();
        titles.sort_unstable();
        let before = titles.len();
        titles.dedup();
        assert_eq!(titles.len(), before);
        let statuses: BTreeSet<&str> = d.papers.iter().map(|p| p.status.as_str()).collect();
        for status in ["to_read", "reading", "read"] {
            assert!(statuses.contains(status), "missing status {status}");
        }
        assert!(d.papers.iter().any(|p| p.authors.len() >= 12));
        assert!(d.papers.iter().any(|p| p.title.chars().count() >= 90));
    }

    #[test]
    fn showcase_data_arxiv_ids_are_well_formed_and_unique() {
        let d = data().expect("data");
        let ids: Vec<&str> = d
            .papers
            .iter()
            .filter_map(|p| p.arxiv_id.as_deref())
            .collect();
        for id in &ids {
            let parts: Vec<&str> = id.split('.').collect();
            assert_eq!(parts.len(), 2, "{id}");
            assert!(
                parts[0].len() == 4 && parts[0].bytes().all(|b| b.is_ascii_digit()),
                "{id}"
            );
            assert!(
                (4..=5).contains(&parts[1].len()) && parts[1].bytes().all(|b| b.is_ascii_digit()),
                "{id}"
            );
        }
        let mut sorted = ids.clone();
        sorted.sort_unstable();
        let before = sorted.len();
        sorted.dedup();
        assert_eq!(sorted.len(), before);
    }

    #[test]
    fn showcase_data_relations_name_seeded_papers() {
        let d = data().expect("data");
        let titles: Vec<&str> = d.papers.iter().map(|p| p.title.as_str()).collect();
        for row in &d.relations {
            assert!(row.len() >= 3);
            for name in &row[..2] {
                assert!(titles.contains(&name.as_str()), "unknown {name}");
            }
        }
    }

    #[test]
    fn showcase_data_logbook_is_long_and_varied() {
        let d = data().expect("data");
        assert!(d.log.len() >= 30);
        let mut days: Vec<i64> = d.log.iter().map(|e| e.days_ago).collect();
        days.sort_unstable();
        let before = days.len();
        days.dedup();
        assert_eq!(days.len(), before);
        assert!(d.log.iter().map(|e| e.days_ago).max().unwrap_or_default() >= 55);
        assert!(d.log.iter().any(|e| e.body.chars().count() >= 1500));
        assert!(d.log.iter().any(|e| e.kind == "weekly"));
    }

    #[test]
    fn showcase_data_notes_link_only_to_real_pages() {
        let d = data().expect("data");
        assert!(d.vault.len() >= 25);
        let mut titles: Vec<&str> = d.vault.iter().map(|p| p.title.as_str()).collect();
        titles.sort_unstable();
        let before = titles.len();
        titles.dedup();
        assert_eq!(titles.len(), before);
        let known: Vec<&str> = d.vault.iter().map(|p| p.title.as_str()).collect();
        let mut pages_with_links = 0;
        for page in &d.vault {
            let mut any = false;
            for part in page.body.split("[[").skip(1) {
                let Some((target, _)) = part.split_once("]]") else {
                    continue;
                };
                any = true;
                assert!(known.contains(&target), "dangling link {target}");
            }
            if any {
                pages_with_links += 1;
            }
        }
        assert!(pages_with_links >= 8);
    }

    #[test]
    fn showcase_data_supervisor_threads_point_at_seeded_work() {
        let d = data().expect("data");
        let milestone_titles: Vec<&str> = d.milestones.iter().map(|m| m.title.as_str()).collect();
        let days: Vec<i64> = d.log.iter().map(|e| e.days_ago).collect();
        assert!(d.supervisor_comments.len() >= 4);
        for t in &d.supervisor_comments {
            if t.resource == "milestone" {
                assert!(
                    milestone_titles.contains(&t.target.as_str()),
                    "target {}",
                    t.target
                );
            } else {
                assert!(
                    t.target.parse::<i64>().is_ok_and(|n| days.contains(&n)),
                    "target {}",
                    t.target
                );
            }
        }
        assert!(d.supervisor_comments.iter().any(|t| !t.replies.is_empty()));
        assert!(d.supervisor_comments.iter().any(|t| t.replies.is_empty()));
        assert!(d.supervisor_comments.iter().any(|t| t.resolved));
    }

    #[test]
    fn showcase_data_milestones_cover_statuses_and_dependencies() {
        let d = data().expect("data");
        assert!(d.milestones.len() >= 12);
        let statuses: BTreeSet<&str> = d.milestones.iter().map(|m| m.status.as_str()).collect();
        for status in ["done", "in_progress", "planned", "blocked"] {
            assert!(statuses.contains(status), "missing status {status}");
        }
        let open: Vec<&Milestone> = d
            .milestones
            .iter()
            .filter(|m| matches!(m.status.as_str(), "planned" | "in_progress" | "blocked"))
            .collect();
        let cutoff = "2026-10-25";
        assert!(
            open.iter()
                .any(|m| m.target_date.as_deref().is_some_and(|t| t < cutoff))
        );
        let later = open
            .iter()
            .filter(|m| m.target_date.as_deref().is_some_and(|t| t > cutoff))
            .count();
        assert!(later >= 2);
        let titles: Vec<&str> = d.milestones.iter().map(|m| m.title.as_str()).collect();
        for m in &d.milestones {
            for dep in &m.dependencies {
                if dep.get("kind").and_then(Value::as_str) == Some("milestone")
                    && let Some(label) = dep.get("label").and_then(Value::as_str)
                {
                    assert!(titles.contains(&label), "dependency label {label}");
                }
            }
        }
    }

    #[test]
    fn supervisee_data_has_three_milestones_and_two_log_entries() {
        let (milestones, log) = supervisee_data("Ada");
        assert_eq!(milestones.len(), 3);
        assert_eq!(log.len(), 2);
    }
}
