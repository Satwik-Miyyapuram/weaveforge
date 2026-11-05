//! The two questions a compiler will not answer: which cited keys are undefined,
//! and which defined keys are never cited. Port of
//! `packages/core/src/features/report/domain/bibliography-report.ts`. Pure: no
//! compiler, network or model. Every problem is a finding, never an error.

// Line numbers and counts stay far below 2^53, so `usize` to `f64` is exact.
#![allow(clippy::cast_precision_loss)]

use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};
use std::sync::LazyLock;

use regex_lite::Regex;

use crate::js_collate::locale_compare;
use crate::latex_section_tree::LatexSourceFile;
use crate::reader_analysis::lines::js_trim;
use crate::report::bib_entries::{BibEntry, BibParseResult};
use crate::report::project_path::normalize_project_path;

/// JS `\s` character set body, spliced into regex classes.
const WS: &str = "\t\n\u{0B}\u{0C}\r \u{a0}\u{1680}\u{2000}-\u{200a}\u{2028}\u{2029}\u{202f}\u{205f}\u{3000}\u{feff}";

/// Citation commands, natbib and biblatex together. Group 3 holds the keys.
static CITE_COMMAND: LazyLock<Option<Regex>> = LazyLock::new(|| {
    Regex::new(&format!(
        r"\\([A-Za-z]*[Cc]ite[A-Za-z]*)\*?((?:[{WS}]*\[[^\]]*\])*)[{WS}]*\{{([^{{}}]*)\}}"
    ))
    .ok()
});
/// Where a bibliography file is named. Group 1 holds the names.
static BIB_RESOURCE: LazyLock<Option<Regex>> = LazyLock::new(|| {
    Regex::new(&format!(
        r"\\(?:bibliography|addbibresource)[{WS}]*\{{([^{{}}]*)\}}"
    ))
    .ok()
});
/// `^10\.\d{4,9}/\S+$`: a DOI body, without the resolver.
static DOI_BODY: LazyLock<Option<Regex>> =
    LazyLock::new(|| Regex::new(&format!(r"^10\.\d{{4,9}}/[^{WS}]+$")).ok());
/// `^https?://(?:dx\.)?doi\.org/` with `i`: the resolver in front of a DOI.
static DOI_PREFIX: LazyLock<Option<Regex>> =
    LazyLock::new(|| Regex::new(r"(?i)^https?://(?:dx\.)?doi\.org/").ok());
/// `^(?:https?|ftp)://\S+\.\S+$` with `i`: a URL that can resolve.
static URL_SHAPE: LazyLock<Option<Regex>> =
    LazyLock::new(|| Regex::new(&format!(r"(?i)^(?:https?|ftp)://[^{WS}]+\.[^{WS}]+$")).ok());
/// `\s+and\s+` with `i`: the separator between names in an `author` field.
static AND_SPLIT: LazyLock<Option<Regex>> =
    LazyLock::new(|| Regex::new(&format!(r"(?i)[{WS}]+and[{WS}]+")).ok());

/// Kinds of bibliography finding. The strings match the TS `BibFindingKind`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub enum BibFindingKind {
    /// A key is cited but defined in no `.bib` file.
    #[serde(rename = "cited-not-defined")]
    CitedNotDefined,
    /// An entry is defined but never cited.
    #[serde(rename = "defined-not-cited")]
    DefinedNotCited,
    /// A key is defined more than once; the first definition wins.
    #[serde(rename = "duplicate-key")]
    DuplicateKey,
    /// An entry lacks a field its type needs to render.
    #[serde(rename = "missing-field")]
    MissingField,
    /// A DOI field that is not a DOI.
    #[serde(rename = "malformed-doi")]
    MalformedDoi,
    /// A URL field that will not resolve.
    #[serde(rename = "malformed-url")]
    MalformedUrl,
    /// Authors written the other way round from the rest of the file.
    #[serde(rename = "author-format")]
    AuthorFormat,
    /// A bibliography file is named but not in the project.
    #[serde(rename = "missing-bib-file")]
    MissingBibFile,
    /// A problem found while reading a `.bib`.
    #[serde(rename = "parse-warning")]
    ParseWarning,
}

/// Severity of a finding. Errors break the document or bibliography; warnings are untidy.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, serde::Serialize, serde::Deserialize,
)]
#[serde(rename_all = "lowercase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub enum BibSeverity {
    /// Breaks the document or the bibliography.
    Error,
    /// Untidy, but renders.
    Warning,
}

/// One problem found by [`check_bibliography`].
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct BibFinding {
    /// What was found.
    pub kind: BibFindingKind,
    /// How serious it is.
    pub severity: BibSeverity,
    /// Path of the file the finding is in.
    pub file: String,
    /// 1-based.
    pub line: f64,
    /// Human-readable message.
    pub message: String,
    /// The cite key the finding is about, when it is about one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub key: Option<String>,
}

/// Every source file of a project and the parsed bibliography.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct BibliographyInput {
    /// Every text file of the project, `.tex` and `.bib` alike.
    pub sources: Vec<LatexSourceFile>,
    /// Entries and warnings from the `.bib` files.
    pub bibliography: BibParseResult,
}

/// Result of [`check_bibliography`].
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct BibliographyReport {
    /// Errors first, then warnings; by file and line within each.
    pub findings: Vec<BibFinding>,
    /// Distinct keys cited anywhere in the document, sorted.
    pub cited_keys: Vec<String>,
    /// Number of entries read.
    pub entry_count: f64,
    /// True when `\nocite{*}` makes every entry cited by definition.
    pub cites_everything: bool,
}

/// One cite key with where it is cited.
struct Citation {
    key: String,
    file: String,
    line: f64,
}

/// One `\bibliography` or `\addbibresource` name with where it is written.
struct Resource {
    name: String,
    file: String,
    line: f64,
}

/// Everything read from the `.tex` files before the checks run.
struct Collected {
    citations: Vec<Citation>,
    resources: Vec<Resource>,
    cites_everything: bool,
}

/// Check one project's citations against its bibliography.
#[must_use]
pub fn check_bibliography(input: &BibliographyInput) -> BibliographyReport {
    let entries = input.bibliography.entries.as_slice();
    let mut findings: Vec<BibFinding> = input
        .bibliography
        .warnings
        .iter()
        .map(|w| {
            plain_finding(
                BibFindingKind::ParseWarning,
                BibSeverity::Warning,
                &w.file,
                f64::from(w.line),
                w.message.clone(),
            )
        })
        .collect();
    let collected = collect_citations(&input.sources);
    let groups = group_by_key(entries);

    check_duplicates(&groups, &mut findings);
    for entry in entries {
        check_fields(entry, &mut findings);
    }
    check_author_style(entries, &mut findings);
    check_resources(&collected.resources, &input.sources, &mut findings);
    let cited = check_citations(&collected.citations, &groups, &mut findings);
    if !collected.cites_everything {
        check_uncited(entries, &cited, &mut findings);
    }

    findings.sort_by(order);
    let mut cited_keys: Vec<String> = cited.into_iter().collect();
    cited_keys.sort();
    BibliographyReport {
        findings,
        cited_keys,
        entry_count: entries.len() as f64,
        cites_everything: collected.cites_everything,
    }
}

fn plain_finding(
    kind: BibFindingKind,
    severity: BibSeverity,
    file: &str,
    line: f64,
    message: String,
) -> BibFinding {
    BibFinding {
        kind,
        severity,
        file: file.to_owned(),
        line,
        message,
        key: None,
    }
}

fn entry_finding(
    kind: BibFindingKind,
    severity: BibSeverity,
    entry: &BibEntry,
    message: String,
) -> BibFinding {
    BibFinding {
        kind,
        severity,
        file: entry.file.clone(),
        line: f64::from(entry.line),
        message,
        key: Some(entry.key.clone()),
    }
}

fn is_tex(file: &LatexSourceFile) -> bool {
    let path = file.path.to_lowercase();
    path.ends_with(".tex") || path.ends_with(".ltx")
}

/// Strip comments before looking for citations. `\%` is an escaped percent and starts nothing.
/// `%` is ASCII, so the byte index is a char boundary.
fn without_comment(line: &str) -> &str {
    let bytes = line.as_bytes();
    let at = bytes
        .iter()
        .enumerate()
        .find(|&(i, &b)| b == b'%' && (i == 0 || bytes[i - 1] != b'\\'))
        .map(|(i, _)| i);
    at.map_or(line, |at| &line[..at])
}

fn collect_citations(sources: &[LatexSourceFile]) -> Collected {
    let mut collected = Collected {
        citations: Vec::new(),
        resources: Vec::new(),
        cites_everything: false,
    };
    let (Some(cite), Some(resource)) = (CITE_COMMAND.as_ref(), BIB_RESOURCE.as_ref()) else {
        return collected;
    };
    for file in sources.iter().filter(|file| is_tex(file)) {
        for (index, raw) in file.content.split('\n').enumerate() {
            let line = (index + 1) as f64;
            let text = without_comment(raw);
            collect_line(cite, resource, text, file, line, &mut collected);
        }
    }
    collected
}

fn collect_line(
    cite: &Regex,
    resource: &Regex,
    text: &str,
    file: &LatexSourceFile,
    line: f64,
    out: &mut Collected,
) {
    for caps in cite.captures_iter(text) {
        let group = caps.get(3).map_or("", |m| m.as_str());
        for part in group.split(',') {
            let key = js_trim(part);
            if key.is_empty() {
                continue;
            }
            if key == "*" {
                out.cites_everything = true;
            } else {
                out.citations.push(Citation {
                    key: key.to_owned(),
                    file: file.path.clone(),
                    line,
                });
            }
        }
    }
    for caps in resource.captures_iter(text) {
        let group = caps.get(1).map_or("", |m| m.as_str());
        for part in group.split(',') {
            let name = js_trim(part);
            if !name.is_empty() {
                out.resources.push(Resource {
                    name: name.to_owned(),
                    file: file.path.clone(),
                    line,
                });
            }
        }
    }
}

/// Entries grouped by key, keys in first-seen order, entries in source order.
fn group_by_key(entries: &[BibEntry]) -> Vec<(&str, Vec<&BibEntry>)> {
    let mut groups: Vec<(&str, Vec<&BibEntry>)> = Vec::new();
    let mut slot: HashMap<&str, usize> = HashMap::new();
    for entry in entries {
        match slot.get(entry.key.as_str()) {
            Some(&index) => groups[index].1.push(entry),
            None => {
                let _ = slot.insert(entry.key.as_str(), groups.len());
                groups.push((entry.key.as_str(), vec![entry]));
            }
        }
    }
    groups
}

fn check_duplicates(groups: &[(&str, Vec<&BibEntry>)], findings: &mut Vec<BibFinding>) {
    for (key, group) in groups {
        // The first definition is the one biber keeps; the rest are the problem.
        let Some((first, rest)) = group.split_first() else {
            continue;
        };
        for duplicate in rest {
            findings.push(entry_finding(
                BibFindingKind::DuplicateKey,
                BibSeverity::Error,
                duplicate,
                format!(
                    "'{key}' is already defined at {}:{}; this one is ignored.",
                    first.file, first.line
                ),
            ));
        }
    }
}

/// The value of a field, or `None` when the entry does not carry it. The last
/// definition wins, as in the TS record.
fn field_value<'a>(entry: &'a BibEntry, name: &str) -> Option<&'a str> {
    entry
        .fields
        .iter()
        .rev()
        .find(|field| field.name == name)
        .map(|field| field.value.as_str())
}

/// What each entry type has to carry to render. `|` means either is enough.
fn required_fields(entry_type: &str) -> Option<&'static [&'static str]> {
    match entry_type {
        "article" => Some(&["author", "title", "journal|journaltitle", "year|date"]),
        "book" => Some(&["author|editor", "title", "publisher", "year|date"]),
        "booklet" => Some(&["title"]),
        "inbook" => Some(&[
            "author|editor",
            "title",
            "chapter|pages",
            "publisher",
            "year|date",
        ]),
        "incollection" => Some(&["author", "title", "booktitle", "publisher", "year|date"]),
        "inproceedings" | "conference" => Some(&["author", "title", "booktitle", "year|date"]),
        "manual" => Some(&["title"]),
        "mastersthesis" | "phdthesis" | "thesis" => {
            Some(&["author", "title", "school|institution", "year|date"])
        }
        "proceedings" => Some(&["title", "year|date"]),
        "techreport" | "report" => Some(&["author", "title", "institution", "year|date"]),
        "unpublished" => Some(&["author", "title", "note"]),
        "online" => Some(&["title", "url|doi"]),
        "misc" => Some(&[]),
        _ => None,
    }
}

fn has_field(entry: &BibEntry, requirement: &str) -> bool {
    requirement
        .split('|')
        .any(|name| field_value(entry, name).is_some_and(|value| !js_trim(value).is_empty()))
}

fn check_fields(entry: &BibEntry, findings: &mut Vec<BibFinding>) {
    check_required(entry, findings);
    check_doi(entry, findings);
    check_url(entry, findings);
}

fn check_required(entry: &BibEntry, findings: &mut Vec<BibFinding>) {
    // An unknown entry type is somebody's local style, not a mistake to report.
    let Some(required) = required_fields(&entry.entry_type) else {
        return;
    };
    for requirement in required {
        if has_field(entry, requirement) {
            continue;
        }
        let names = requirement.replace('|', "' or '");
        findings.push(entry_finding(
            BibFindingKind::MissingField,
            BibSeverity::Error,
            entry,
            format!("@{} '{}' has no '{names}'.", entry.entry_type, entry.key),
        ));
    }
}

fn is_doi(doi: &str) -> bool {
    let body = DOI_PREFIX
        .as_ref()
        .map_or_else(|| doi.to_owned(), |re| re.replace(doi, "").into_owned());
    DOI_BODY.as_ref().is_some_and(|re| re.is_match(&body))
}

fn check_doi(entry: &BibEntry, findings: &mut Vec<BibFinding>) {
    let Some(doi) = field_value(entry, "doi")
        .map(js_trim)
        .filter(|doi| !doi.is_empty())
    else {
        return;
    };
    if is_doi(doi) {
        return;
    }
    findings.push(entry_finding(
        BibFindingKind::MalformedDoi,
        BibSeverity::Warning,
        entry,
        format!("'{}' has a DOI that is not one: {doi}", entry.key),
    ));
}

fn check_url(entry: &BibEntry, findings: &mut Vec<BibFinding>) {
    let Some(url) = field_value(entry, "url")
        .map(js_trim)
        .filter(|url| !url.is_empty())
    else {
        return;
    };
    if URL_SHAPE.as_ref().is_some_and(|re| re.is_match(url)) {
        return;
    }
    findings.push(entry_finding(
        BibFindingKind::MalformedUrl,
        BibSeverity::Warning,
        entry,
        format!("'{}' has a URL that will not resolve: {url}", entry.key),
    ));
}

/// Names in an `author` field, minus empty ones and BibTeX's `others` (et al.).
fn split_names(authors: &str) -> Vec<&str> {
    let names: Vec<&str> = match AND_SPLIT.as_ref() {
        Some(re) => re.split(authors).collect(),
        None => vec![authors],
    };
    names
        .into_iter()
        .filter(|name| !name.is_empty() && js_trim(name).to_lowercase() != "others")
        .collect()
}

/// Whether authors are written "Last, First" or "First Last", and whether the file has settled on one.
fn check_author_style(entries: &[BibEntry], findings: &mut Vec<BibFinding>) {
    let mut comma_style: Vec<&BibEntry> = Vec::new();
    let mut plain_style: Vec<&BibEntry> = Vec::new();
    for entry in entries {
        let Some(authors) = field_value(entry, "author")
            .map(js_trim)
            .filter(|authors| !authors.is_empty())
        else {
            continue;
        };
        let named = split_names(authors);
        if named.is_empty() {
            continue;
        }
        if named.iter().all(|name| name.contains(',')) {
            comma_style.push(entry);
        } else {
            plain_style.push(entry);
        }
    }
    if comma_style.is_empty() || plain_style.is_empty() {
        return;
    }

    // On a tie the plain style is the minority, as in the TS.
    let minority_is_comma = comma_style.len() < plain_style.len();
    let (minority, majority_style) = if minority_is_comma {
        (&comma_style, "First Last")
    } else {
        (&plain_style, "Last, First")
    };
    for entry in minority {
        findings.push(entry_finding(
            BibFindingKind::AuthorFormat,
            BibSeverity::Warning,
            entry,
            format!(
                "'{}' writes its authors the other way round; the rest of this bibliography uses '{majority_style}'.",
                entry.key
            ),
        ));
    }
}

/// Whether `name` (lower-cased, normalized) names one of the `present` project paths.
fn names_a_present_file(name: &str, present: &[String]) -> bool {
    let with_ext = if name.ends_with(".bib") {
        name.to_owned()
    } else {
        format!("{name}.bib")
    };
    // A path may be written relative to the file that names it or to the root.
    [name, with_ext.as_str()].iter().any(|candidate| {
        let suffix = format!("/{candidate}");
        present
            .iter()
            .any(|path| path.as_str() == *candidate || path.ends_with(&suffix))
    })
}

fn check_resources(
    resources: &[Resource],
    sources: &[LatexSourceFile],
    findings: &mut Vec<BibFinding>,
) {
    let present: Vec<String> = sources
        .iter()
        .map(|file| normalize_project_path(&file.path.to_lowercase()).unwrap_or_default())
        .collect();
    for resource in resources {
        // `./refs.bib` and `sub/../refs` name `refs.bib`; a path out of the project names nothing.
        let name = normalize_project_path(&resource.name.to_lowercase());
        let found = name
            .as_deref()
            .is_some_and(|name| !name.is_empty() && names_a_present_file(name, &present));
        if found {
            continue;
        }
        findings.push(plain_finding(
            BibFindingKind::MissingBibFile,
            BibSeverity::Error,
            &resource.file,
            resource.line,
            format!(
                "No '{}' in this project, so none of its entries will print.",
                resource.name
            ),
        ));
    }
}

/// Errors before warnings, then by file and line, so the list reads top-down.
fn order(a: &BibFinding, b: &BibFinding) -> Ordering {
    a.severity
        .cmp(&b.severity)
        .then_with(|| locale_compare(&a.file, &b.file))
        .then_with(|| a.line.total_cmp(&b.line))
}

/// Records each citation and reports the ones defined in no entry, once per key per file.
fn check_citations(
    citations: &[Citation],
    groups: &[(&str, Vec<&BibEntry>)],
    findings: &mut Vec<BibFinding>,
) -> HashSet<String> {
    let defined: HashSet<&str> = groups.iter().map(|(key, _)| *key).collect();
    let mut cited: HashSet<String> = HashSet::new();
    let mut reported: HashSet<String> = HashSet::new();
    for citation in citations {
        let _ = cited.insert(citation.key.clone());
        if defined.contains(citation.key.as_str()) {
            continue;
        }
        // Once per key per file: a key cited forty times is one thing to fix.
        if !reported.insert(format!("{}\u{0}{}", citation.key, citation.file)) {
            continue;
        }
        findings.push(BibFinding {
            kind: BibFindingKind::CitedNotDefined,
            severity: BibSeverity::Error,
            file: citation.file.clone(),
            line: citation.line,
            message: format!(
                "'{}' is cited here but defined in no .bib file.",
                citation.key
            ),
            key: Some(citation.key.clone()),
        });
    }
    cited
}

fn check_uncited(entries: &[BibEntry], cited: &HashSet<String>, findings: &mut Vec<BibFinding>) {
    for entry in entries.iter().filter(|entry| !cited.contains(&entry.key)) {
        findings.push(entry_finding(
            BibFindingKind::DefinedNotCited,
            BibSeverity::Warning,
            entry,
            format!(
                "'{}' is never cited, so it will not appear in the bibliography.",
                entry.key
            ),
        ));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::report::bib_entries::parse_bib_entries;

    const COMPLETE: &str = "@article{ok,\n  author = {Smith, Jane},\n  title = {T},\n  journal = {J},\n  year = {2020}\n}";

    fn src(path: &str, content: &str) -> LatexSourceFile {
        LatexSourceFile {
            path: path.to_owned(),
            content: content.to_owned(),
        }
    }

    fn report(files: &[LatexSourceFile]) -> BibliographyReport {
        let input = BibliographyInput {
            sources: files.to_vec(),
            bibliography: parse_bib_entries(files),
        };
        check_bibliography(&input)
    }

    fn of_kind(findings: &[BibFinding], kind: BibFindingKind) -> Vec<&BibFinding> {
        findings.iter().filter(|f| f.kind == kind).collect()
    }

    #[test]
    fn cited_key_with_no_entry_is_an_error_once_per_file() {
        let result = report(&[
            src(
                "main.tex",
                "\\cite{ghost} and \\citep{ghost} again.\n\\bibliography{refs}",
            ),
            src("refs.bib", COMPLETE),
        ]);
        let missing = of_kind(&result.findings, BibFindingKind::CitedNotDefined);
        assert_eq!(missing.len(), 1);
        assert_eq!(missing[0].key.as_deref(), Some("ghost"));
        assert_eq!(missing[0].severity, BibSeverity::Error);
        assert_eq!(missing[0].line, 1.0);
    }

    #[test]
    fn uncited_entry_is_a_warning_and_nocite_star_settles_it() {
        let files = [
            src("main.tex", "Nothing cited here.\n\\bibliography{refs}"),
            src("refs.bib", COMPLETE),
        ];
        assert_eq!(
            of_kind(&report(&files).findings, BibFindingKind::DefinedNotCited).len(),
            1
        );

        let everything = report(&[
            src("main.tex", "\\nocite{*}\n\\bibliography{refs}"),
            src("refs.bib", COMPLETE),
        ]);
        assert!(everything.cites_everything);
        assert!(of_kind(&everything.findings, BibFindingKind::DefinedNotCited).is_empty());
    }

    #[test]
    fn commented_out_citation_does_not_keep_an_entry_alive() {
        let result = report(&[
            src(
                "main.tex",
                "% \\cite{ok} was here\n100\\% done\n\\bibliography{refs}",
            ),
            src("refs.bib", COMPLETE),
        ]);
        assert_eq!(
            of_kind(&result.findings, BibFindingKind::DefinedNotCited).len(),
            1
        );
        assert!(result.cited_keys.is_empty());
    }

    #[test]
    fn duplicate_key_names_the_definition_that_wins() {
        let result = report(&[
            src("main.tex", "\\cite{ok}\n\\bibliography{refs}"),
            src(
                "refs.bib",
                &format!("{COMPLETE}\n@misc{{ok, title = {{Second}}}}"),
            ),
        ]);
        let duplicate = of_kind(&result.findings, BibFindingKind::DuplicateKey);
        assert_eq!(duplicate.len(), 1);
        assert_eq!(duplicate[0].severity, BibSeverity::Error);
        assert!(
            duplicate[0]
                .message
                .contains("already defined at refs.bib:1")
        );
    }

    #[test]
    fn required_fields_follow_the_entry_type_and_biblatex_spellings_count() {
        let result = report(&[
            src(
                "main.tex",
                "\\cite{a}\\cite{b}\\cite{c}\n\\bibliography{refs}",
            ),
            src(
                "refs.bib",
                "@article{a, author = {X, Y}, title = {T}, journaltitle = {J}, date = {2021}}\n\
                 @inproceedings{b, author = {X, Y}, title = {T}, year = {2021}}\n\
                 @misc{c}",
            ),
        ]);
        let missing = of_kind(&result.findings, BibFindingKind::MissingField);
        assert_eq!(missing.len(), 1);
        assert!(missing[0].message.contains("'b' has no 'booktitle'"));
    }

    #[test]
    fn clean_project_reports_nothing() {
        let result = report(&[
            src("main.tex", "\\cite{ok}\n\\bibliography{refs}"),
            src("refs.bib", COMPLETE),
        ]);
        assert!(result.findings.is_empty());
        assert_eq!(result.cited_keys, vec!["ok".to_owned()]);
        assert_eq!(result.entry_count, 1.0);
    }
}
