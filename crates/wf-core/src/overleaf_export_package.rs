//! Overleaf export package steps (TS `build-overleaf-export.ts`): the section walk that builds the
//! body of `main.tex`, and the `manifest.json` rewrite for figures whose blobs could not be loaded.
//! Pure: no I/O.

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

use crate::overleaf::export_path::missing_figure_warning;
use crate::reader_analysis::lines::js_trim;
use crate::report::markdown_to_latex::{
    MarkdownToLatexOptions, markdown_to_latex, unique_figure_name,
};
use crate::report::report_section::{ReportSection, ReportSectionTreeNode, ReportStatus};

/// Section commands by outline depth; deeper sections reuse the last one.
const SECTION_CMD: [&str; 4] = ["chapter", "section", "subsection", "subsubsection"];

/// A file in the export package: its path inside the package and its text.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ExportFile {
    /// Path inside the package, e.g. `main.tex`.
    pub path: String,
    /// The file's text.
    pub contents: String,
}

/// A binary figure to fetch and place under `figures/`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ExportImage {
    /// Storage path after `reportimg:` (ownerId/sectionId/file).
    pub storage_path: String,
    /// Relative ZIP path, e.g. `figures/uuid.webp`.
    pub zip_path: String,
}

/// What the section walk is asked to do.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct WalkOptions {
    /// Whether section notes are converted into the body.
    pub include_notes: bool,
    /// `normalizeTitleKey(paper.title)` to bib key; when set, `[[wikilinks]]` become `\cite{key}`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(
        feature = "specta",
        specta(type = std::collections::HashMap<String, String>)
    )]
    pub cite_by_title: Option<HashMap<String, String>>,
}

/// Counts the walk adds to the export's stats.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct WalkStats {
    /// Sections visited.
    pub sections: u32,
    /// Dollar signs in the section notes, a rough count of equations.
    pub equations_approx: u32,
    /// Figures found in the notes.
    pub figures: u32,
}

/// The walk's result: body lines for `main.tex`, warnings, figures and counts.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct SectionWalk {
    /// Body lines, joined with newlines by the caller.
    pub out: Vec<String>,
    /// Warnings from converting section notes.
    pub warnings: Vec<String>,
    /// Figures to fetch, with their renamed ZIP paths.
    pub images: Vec<ExportImage>,
    /// Counts for the manifest.
    pub stats: WalkStats,
}

/// The stats block of `manifest.json`, in the builder's key order.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ManifestStats {
    /// Sections exported.
    pub sections: u32,
    /// Approximate equation count.
    pub equations_approx: u32,
    /// Entries in `references.bib`.
    pub bibliography_entries: u32,
    /// Figures exported.
    pub figures: u32,
}

/// `manifest.json` of the Overleaf package. Field order is the file's key order, which is the
/// order `JSON.stringify` wrote the builder's object in; `missingFigures` is appended last.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct OverleafManifest {
    /// Schema version of the package.
    pub schema_version: u32,
    /// ISO export time.
    pub exported_at: String,
    /// Producing app name.
    pub app: String,
    /// Package kind.
    pub kind: String,
    /// Document title.
    pub title: String,
    /// `cited` or `all`; `null` when no bibliography is included.
    pub bibliography_scope: Option<String>,
    /// Paths in the package (files, then figures).
    pub files: Vec<String>,
    /// Counts.
    pub stats: ManifestStats,
    /// Human-readable warnings.
    pub warnings: Vec<String>,
    /// How to use the package.
    pub note: String,
    /// Figures that could not be loaded; absent when none are missing.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub missing_figures: Option<Vec<String>>,
}

/// Walk the outline depth-first and build the body, warnings, figures and counts. Each section
/// gets a sectioning command, a status comment and its converted notes (or a placeholder).
#[must_use]
pub fn walk_sections(tree: &[ReportSectionTreeNode], opts: &WalkOptions) -> SectionWalk {
    let mut walker = Walker {
        include_notes: opts.include_notes,
        md_opts: MarkdownToLatexOptions {
            cite_by_title: opts.cite_by_title.clone(),
        },
        used: HashSet::new(),
        walk: SectionWalk::default(),
    };
    walker.nodes(tree, 0);
    walker.walk
}

/// The files with `manifest.json` rewritten for figures that could not be loaded: they leave the
/// file list, are listed under `missingFigures` and get one warning each. With none missing the
/// files are returned unchanged.
///
/// # Errors
///
/// A `serde_json` error when the manifest is not valid JSON of the expected shape.
pub fn with_missing_figures(
    files: &[ExportFile],
    missing: &[ExportImage],
) -> Result<Vec<ExportFile>, serde_json::Error> {
    if missing.is_empty() {
        return Ok(files.to_vec());
    }
    let mut gone: Vec<String> = Vec::new();
    for m in missing {
        if !gone.contains(&m.zip_path) {
            gone.push(m.zip_path.clone());
        }
    }
    let warnings: Vec<String> = missing
        .iter()
        .map(|m| missing_figure_warning(&m.zip_path, &m.storage_path))
        .collect();
    files
        .iter()
        .map(|f| {
            if f.path != "manifest.json" {
                return Ok(f.clone());
            }
            let mut manifest: OverleafManifest = serde_json::from_str(&f.contents)?;
            manifest.files.retain(|p| !gone.contains(p));
            manifest.missing_figures = Some(gone.clone());
            manifest.warnings.extend(warnings.iter().cloned());
            Ok(ExportFile {
                path: f.path.clone(),
                contents: manifest_contents(&manifest)?,
            })
        })
        .collect()
}

/// The manifest as `JSON.stringify(v, null, 2) + "\n"` writes it.
///
/// # Errors
///
/// A `serde_json` error when serialisation fails (not expected for this shape).
pub fn manifest_contents(manifest: &OverleafManifest) -> Result<String, serde_json::Error> {
    Ok(format!("{}\n", serde_json::to_string_pretty(manifest)?))
}

/// Accumulates the walk; `used` holds the figure names taken so far in the whole package.
struct Walker {
    /// Whether notes are converted.
    include_notes: bool,
    /// Options passed to `markdown_to_latex` for every section.
    md_opts: MarkdownToLatexOptions,
    /// Figure file names already used.
    used: HashSet<String>,
    /// Output so far.
    walk: SectionWalk,
}

impl Walker {
    /// Visit each node and its children, one level deeper.
    fn nodes(&mut self, nodes: &[ReportSectionTreeNode], depth: usize) {
        for node in nodes {
            self.section(&node.section, depth);
            self.nodes(&node.children, depth + 1);
        }
    }

    /// Emit one section's heading, status comment, notes and trailing blank line.
    fn section(&mut self, s: &ReportSection, depth: usize) {
        self.walk.stats.sections += 1;
        let cmd = SECTION_CMD[depth.min(SECTION_CMD.len() - 1)];
        let label = match s.section_no.as_deref().filter(|n| !n.is_empty()) {
            Some(no) => format!("{no} {}", s.title),
            None => s.title.clone(),
        };
        self.walk
            .out
            .push(format!("\\{cmd}{{{}}}", escape_title(&label)));
        let target = match s.target_words {
            Some(t) => format!(" / {}", js_number(t)),
            None => String::new(),
        };
        self.walk.out.push(format!(
            "% status: {}; words: {}{target}",
            status_name(s.status),
            js_number(s.word_count)
        ));

        let notes = s.notes.as_deref().unwrap_or("");
        let has_notes = !js_trim(notes).is_empty();
        if self.include_notes && has_notes {
            self.notes(s, notes);
        } else if !has_notes {
            self.walk.out.push("% (no section notes)".to_owned());
        }
        self.walk.out.push(String::new());
    }

    /// Convert one section's notes: warnings, equation count, figures and their renamed references.
    fn notes(&mut self, s: &ReportSection, notes: &str) {
        let converted = markdown_to_latex(notes, &self.md_opts);
        self.walk.warnings.extend(
            converted
                .warnings
                .iter()
                .map(|w| format!("Section \"{}\": {w}", s.title)),
        );
        let dollars = u32::try_from(notes.matches('$').count()).unwrap_or(u32::MAX);
        self.walk.stats.equations_approx = self.walk.stats.equations_approx.saturating_add(dollars);

        let mut renamed: HashMap<String, String> = HashMap::new();
        for img in &converted.images {
            let file_name = unique_figure_name(&img.file_name, &mut self.used);
            let _ = renamed.insert(img.file_name.clone(), file_name.clone());
            self.walk.images.push(ExportImage {
                storage_path: img.path.clone(),
                zip_path: format!("figures/{file_name}"),
            });
            self.walk.stats.figures += 1;
        }
        let latex = rename_figure_refs(&converted.latex, &renamed);
        if !latex.is_empty() {
            self.walk.out.push(latex);
        }
    }
}

/// Rewrite each whole `{figures/NAME}` reference by `renamed`, in one left-to-right pass, so a
/// rename never re-renames an earlier one or rewrites inside a longer name. Unknown names stay.
fn rename_figure_refs(latex: &str, renamed: &HashMap<String, String>) -> String {
    const OPEN: &str = "{figures/";
    let mut out = String::with_capacity(latex.len());
    let mut rest = latex;
    while let Some(at) = rest.find(OPEN) {
        out.push_str(&rest[..at]);
        let after = &rest[at + OPEN.len()..];
        match after.find('}') {
            Some(end) if end > 0 => {
                let name = &after[..end];
                match renamed.get(name) {
                    Some(next) => {
                        out.push_str(OPEN);
                        out.push_str(next);
                        out.push('}');
                    }
                    None => out.push_str(&rest[at..at + OPEN.len() + end + 1]),
                }
                rest = &after[end + 1..];
            }
            _ => {
                out.push_str(OPEN);
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

/// Escape the LaTeX specials JS `escapeTitle` escapes: `{ } $ & # ^ _ % \`. Kept private here,
/// because `escape_latex_text` escapes differently (`~`, backslash text).
fn escape_title(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        if matches!(c, '{' | '}' | '$' | '&' | '#' | '^' | '_' | '%' | '\\') {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

/// A status as its snake_case name, as the TS template printed it.
fn status_name(status: ReportStatus) -> &'static str {
    match status {
        ReportStatus::NotStarted => "not_started",
        ReportStatus::Drafting => "drafting",
        ReportStatus::Review => "review",
        ReportStatus::Done => "done",
    }
}

/// A number as JavaScript's template literal prints it (`NaN`, `Infinity`, `0` for -0).
fn js_number(n: f64) -> String {
    if n.is_nan() {
        "NaN".to_owned()
    } else if n.is_infinite() {
        if n > 0.0 { "Infinity" } else { "-Infinity" }.to_owned()
    } else if n == 0.0 {
        "0".to_owned()
    } else {
        format!("{n}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::report::report_section::ReportSection;

    fn section(id: &str, title: &str, notes: Option<&str>) -> ReportSection {
        ReportSection {
            id: id.to_owned(),
            title: title.to_owned(),
            section_no: None,
            parent_id: None,
            status: ReportStatus::Drafting,
            word_count: 0.0,
            target_words: None,
            deadline: None,
            draft_url: None,
            notes: notes.map(str::to_owned),
            sort_order: 0.0,
            created_at: "2026-01-01T00:00:00.000Z".to_owned(),
            updated_at: None,
        }
    }

    fn node(section: ReportSection, children: Vec<ReportSectionTreeNode>) -> ReportSectionTreeNode {
        ReportSectionTreeNode { section, children }
    }

    fn opts() -> WalkOptions {
        WalkOptions {
            include_notes: true,
            cite_by_title: None,
        }
    }

    #[test]
    fn depth_is_clamped_to_the_last_section_command() {
        let deep = node(
            section("1", "A", None),
            vec![node(
                section("2", "B", None),
                vec![node(
                    section("3", "C", None),
                    vec![node(section("4", "D", None), vec![])],
                )],
            )],
        );
        let walk = walk_sections(&[deep], &opts());
        assert!(walk.out.contains(&"\\chapter{A}".to_owned()));
        assert!(walk.out.contains(&"\\section{B}".to_owned()));
        assert!(walk.out.contains(&"\\subsection{C}".to_owned()));
        assert!(walk.out.contains(&"\\subsubsection{D}".to_owned()));
    }

    #[test]
    fn empty_notes_get_the_placeholder_and_a_blank_line() {
        let walk = walk_sections(&[node(section("1", "A", Some("   ")), vec![])], &opts());
        assert_eq!(
            walk.out,
            vec![
                "\\chapter{A}".to_owned(),
                "% status: drafting; words: 0".to_owned(),
                "% (no section notes)".to_owned(),
                String::new(),
            ]
        );
    }

    #[test]
    fn section_number_prefixes_the_label_only_when_non_empty() {
        let mut numbered = section("1", "Intro", None);
        numbered.section_no = Some("1.2".to_owned());
        let mut blank = section("2", "Lit_review", None);
        blank.section_no = Some(String::new());
        let walk = walk_sections(&[node(numbered, vec![]), node(blank, vec![])], &opts());
        assert_eq!(walk.out[0], "\\chapter{1.2 Intro}");
        assert_eq!(walk.out[4], "\\chapter{Lit\\_review}");
    }

    #[test]
    fn target_words_and_stats_are_reported() {
        let mut s = section("1", "A", Some("cost $x$"));
        s.word_count = 120.0;
        s.target_words = Some(500.0);
        s.status = ReportStatus::Review;
        let walk = walk_sections(&[node(s, vec![])], &opts());
        assert_eq!(walk.out[1], "% status: review; words: 120 / 500");
        assert_eq!(walk.stats.sections, 1);
        assert_eq!(walk.stats.equations_approx, 2);
    }

    #[test]
    fn a_repeated_figure_name_is_renamed_and_its_reference_follows() {
        let a = section("1", "A", Some("![a](reportimg:u/1/fig.png)"));
        let b = section("2", "B", Some("![b](reportimg:u/2/fig.png)"));
        let walk = walk_sections(&[node(a, vec![]), node(b, vec![])], &opts());
        let zips: Vec<&str> = walk.images.iter().map(|i| i.zip_path.as_str()).collect();
        assert_eq!(zips, ["figures/fig.png", "figures/fig_2.png"]);
        assert!(walk.out.iter().any(|l| l.contains("{figures/fig_2.png}")));
    }

    #[test]
    fn rename_pass_skips_longer_names_and_unknown_refs() {
        let mut renamed = HashMap::new();
        let _ = renamed.insert("a.png".to_owned(), "a_2.png".to_owned());
        assert_eq!(
            rename_figure_refs("{figures/a.png} {figures/a.png.png} {figures/}", &renamed),
            "{figures/a_2.png} {figures/a.png.png} {figures/}"
        );
    }

    #[test]
    fn notes_are_skipped_when_disabled_but_placeholder_only_for_empty() {
        let no_notes = WalkOptions {
            include_notes: false,
            cite_by_title: None,
        };
        let walk = walk_sections(&[node(section("1", "A", Some("text")), vec![])], &no_notes);
        assert_eq!(
            walk.out,
            vec!["\\chapter{A}", "% status: drafting; words: 0", ""]
        );
    }

    #[test]
    fn js_number_matches_template_output() {
        assert_eq!(js_number(120.0), "120");
        assert_eq!(js_number(0.5), "0.5");
        assert_eq!(js_number(-0.0), "0");
        assert_eq!(js_number(f64::NAN), "NaN");
        assert_eq!(js_number(f64::NEG_INFINITY), "-Infinity");
    }

    fn fixed_manifest(files: Vec<String>, missing: Option<Vec<String>>) -> OverleafManifest {
        OverleafManifest {
            schema_version: 1,
            exported_at: "2026-11-10T00:00:00.000Z".to_owned(),
            app: "WeaveForge".to_owned(),
            kind: "overleaf-export-package".to_owned(),
            title: "T".to_owned(),
            bibliography_scope: Some("all".to_owned()),
            files,
            stats: ManifestStats {
                sections: 1,
                equations_approx: 0,
                bibliography_entries: 0,
                figures: 1,
            },
            warnings: Vec::new(),
            note: "N".to_owned(),
            missing_figures: missing,
        }
    }

    #[test]
    fn manifest_bytes_match_json_stringify_with_two_space_indent() {
        let expected = concat!(
            "{\n",
            "  \"schemaVersion\": 1,\n",
            "  \"exportedAt\": \"2026-11-10T00:00:00.000Z\",\n",
            "  \"app\": \"WeaveForge\",\n",
            "  \"kind\": \"overleaf-export-package\",\n",
            "  \"title\": \"T\",\n",
            "  \"bibliographyScope\": \"all\",\n",
            "  \"files\": [\n",
            "    \"main.tex\",\n",
            "    \"figures/a.png\"\n",
            "  ],\n",
            "  \"stats\": {\n",
            "    \"sections\": 1,\n",
            "    \"equationsApprox\": 0,\n",
            "    \"bibliographyEntries\": 0,\n",
            "    \"figures\": 1\n",
            "  },\n",
            "  \"warnings\": [],\n",
            "  \"note\": \"N\"\n",
            "}\n",
        );
        let text = manifest_contents(&fixed_manifest(
            vec!["main.tex".to_owned(), "figures/a.png".to_owned()],
            None,
        ))
        .expect("manifest serialises");
        assert_eq!(text, expected);
    }

    #[test]
    fn missing_figures_is_appended_after_note_and_drops_the_file() {
        let manifest = fixed_manifest(
            vec![
                "main.tex".to_owned(),
                "figures/a.png".to_owned(),
                "figures/b.png".to_owned(),
            ],
            None,
        );
        let files = vec![
            ExportFile {
                path: "main.tex".to_owned(),
                contents: "x".to_owned(),
            },
            ExportFile {
                path: "manifest.json".to_owned(),
                contents: manifest_contents(&manifest).expect("serialises"),
            },
        ];
        let missing = [ExportImage {
            storage_path: "u/1/b.png".to_owned(),
            zip_path: "figures/b.png".to_owned(),
        }];
        let out = with_missing_figures(&files, &missing).expect("rewrites");
        assert_eq!(out[0], files[0]);

        let mut expected = fixed_manifest(
            vec!["main.tex".to_owned(), "figures/a.png".to_owned()],
            Some(vec!["figures/b.png".to_owned()]),
        );
        expected
            .warnings
            .push(missing_figure_warning("figures/b.png", "u/1/b.png"));
        assert_eq!(
            out[1].contents,
            manifest_contents(&expected).expect("serialises")
        );
        let note_at = out[1].contents.find("\"note\"").expect("note key");
        let missing_at = out[1]
            .contents
            .find("\"missingFigures\"")
            .expect("missing key");
        assert!(missing_at > note_at);
    }

    #[test]
    fn no_missing_figures_returns_the_files_unchanged() {
        let files = vec![ExportFile {
            path: "manifest.json".to_owned(),
            contents: "not json".to_owned(),
        }];
        assert_eq!(with_missing_figures(&files, &[]).expect("clone"), files);
    }
}
